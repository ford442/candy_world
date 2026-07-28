/**
 * @file presence.ts
 * @brief Opt-in multiplayer presence via Supabase Realtime (presence + broadcast).
 *
 * Room key = world seed. Publishes camera pose at ~10 Hz. No accounts — ephemeral session ids.
 * Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. Networking stays off until join().
 */

import * as THREE from 'three';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { CONFIG, FEATURE_FLAGS } from '../../core/config.ts';
import { getWorldSeed } from '../../world/world-seed.ts';
import { getBiomeAtPosition } from './biome-at-position.ts';
import { remoteAvatars } from './remote-avatars.ts';
import {
    PRESENCE_BROADCAST_EVENT,
    type PresenceMeta,
    type PresencePose,
    type RemotePeer,
} from './presence-types.ts';

const PRESENCE_OPT_IN_KEY = 'candy_presence_opt_in';
const STALE_PEER_MS = 15_000;
const MAX_SNAPSHOTS = 8;

const _scratchQuat = new THREE.Quaternion();

type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;

function getSupabaseConfig(): { url: string; anonKey: string } | null {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (typeof url !== 'string' || url.length === 0) return null;
    if (typeof anonKey !== 'string' || anonKey.length === 0) return null;
    return { url, anonKey };
}

export function isPresenceBackendConfigured(): boolean {
    return getSupabaseConfig() !== null;
}

export function isPresenceOptedIn(): boolean {
    try {
        if (new URLSearchParams(window.location.search).has('presence')) return true;
        return localStorage.getItem(PRESENCE_OPT_IN_KEY) === '1';
    } catch {
        return false;
    }
}

export function setPresenceOptIn(enabled: boolean): void {
    try {
        if (enabled) {
            localStorage.setItem(PRESENCE_OPT_IN_KEY, '1');
        } else {
            localStorage.removeItem(PRESENCE_OPT_IN_KEY);
        }
    } catch {
        /* ignore */
    }
}

const EMOJI_POOL = ['🍬', '🌸', '🦋', '⭐', '🍭', '🫧', '🌙', '✨'];

function randomEmoji(): string {
    return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

function randomLabel(): string {
    const n = Math.floor(Math.random() * 900) + 100;
    return `Explorer-${n}`;
}

export class PresenceSystem {
    private static _instance: PresenceSystem | null = null;

    private _client: SupabaseClient | null = null;
    private _channel: RealtimeChannel | null = null;
    private _sessionId = '';
    private _label = '';
    private _emoji = '';
    private _joined = false;
    private _lastPublish = 0;
    private _peers = new Map<string, RemotePeer>();
    private _localPos = new THREE.Vector3();
    private _shareDiscoveryGlow = false;

    static getInstance(): PresenceSystem {
        if (!PresenceSystem._instance) {
            PresenceSystem._instance = new PresenceSystem();
        }
        return PresenceSystem._instance;
    }

    get joined(): boolean {
        return this._joined;
    }

    get peerCount(): number {
        return this._peers.size;
    }

    /** Future seam: mirror save-system shareDiscoveryGlowWithPeers */
    setShareDiscoveryGlow(enabled: boolean): void {
        this._shareDiscoveryGlow = enabled;
    }

    bindScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.Renderer): void {
        remoteAvatars.init(scene, camera, renderer);
    }

    async join(opts?: { label?: string; emoji?: string; seed?: number }): Promise<boolean> {
        if (!FEATURE_FLAGS.presence) {
            console.warn('[Presence] Feature flag disabled (?presence=1 to enable UI)');
            return false;
        }

        const cfg = getSupabaseConfig();
        if (!cfg) {
            console.warn(
                '[Presence] Supabase not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)'
            );
            return false;
        }

        if (this._joined) return true;

        const { createClient } = await import('@supabase/supabase-js');
        this._client = createClient(cfg.url, cfg.anonKey, {
            realtime: { params: { eventsPerSecond: CONFIG.presence?.tickHz ?? 10 } },
        });

        this._sessionId = crypto.randomUUID();
        this._label = opts?.label?.trim() || randomLabel();
        this._emoji = opts?.emoji?.trim() || randomEmoji();

        const seed = opts?.seed ?? getWorldSeed();
        const room = `candy:${seed}`;

        const meta: PresenceMeta = {
            id: this._sessionId,
            label: this._label,
            emoji: this._emoji,
            shareDiscoveryGlow: this._shareDiscoveryGlow,
        };

        this._channel = this._client.channel(room, {
            config: {
                presence: { key: this._sessionId },
                broadcast: { self: false },
            },
        });

        this._channel.on('presence', { event: 'sync' }, () => {
            this._mergePresenceState();
        });
        this._channel.on('presence', { event: 'join' }, () => {
            this._mergePresenceState();
        });
        this._channel.on('presence', { event: 'leave' }, ({ key }) => {
            if (key) this._removePeer(key);
        });
        this._channel.on('broadcast', { event: PRESENCE_BROADCAST_EVENT }, ({ payload }) => {
            this._ingestPose(payload as PresencePose);
        });

        const subscribed = await new Promise<boolean>((resolve) => {
            this._channel!.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await this._channel!.track(meta);
                    this._joined = true;
                    setPresenceOptIn(true);
                    console.log(`[Presence] Joined room ${room} as ${this._emoji} ${this._label}`);
                    resolve(true);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('[Presence] Channel subscription failed:', status);
                    resolve(false);
                }
            });
        });

        if (!subscribed) {
            await this.leave();
        }
        return subscribed;
    }

    async leave(): Promise<void> {
        if (this._channel) {
            try {
                await this._channel.untrack();
                await this._client?.removeChannel(this._channel);
            } catch (err) {
                console.warn('[Presence] Teardown error:', err);
            }
        }
        this._channel = null;
        this._client = null;
        this._joined = false;
        this._peers.clear();
        remoteAvatars.syncPeers(this._peers, this._localPos);
        console.log('[Presence] Left room');
    }

    update(
        _delta: number,
        camera: THREE.PerspectiveCamera,
        fallbackPosition?: THREE.Vector3
    ): void {
        if (!this._joined || !this._channel) return;

        const tickMs = 1000 / (CONFIG.presence?.tickHz ?? 10);
        const now = performance.now();

        camera.getWorldPosition(this._localPos);
        if (fallbackPosition) {
            this._localPos.y = fallbackPosition.y;
        }

        this._pruneStalePeers(now);

        if (now - this._lastPublish >= tickMs) {
            this._lastPublish = now;
            camera.getWorldQuaternion(_scratchQuat);
            const biome = getBiomeAtPosition(this._localPos.x, this._localPos.z);
            const pose: PresencePose = {
                id: this._sessionId,
                pos: [this._localPos.x, this._localPos.y, this._localPos.z],
                quat: [_scratchQuat.x, _scratchQuat.y, _scratchQuat.z, _scratchQuat.w],
                biome,
                ts: now,
            };
            void this._channel.send({
                type: 'broadcast',
                event: PRESENCE_BROADCAST_EVENT,
                payload: pose,
            });
        }

        remoteAvatars.syncPeers(this._peers, this._localPos);
        remoteAvatars.updateTags();
    }

    dispose(): void {
        void this.leave();
        remoteAvatars.dispose();
    }

    private _mergePresenceState(): void {
        if (!this._channel) return;
        const state = this._channel.presenceState<PresenceMeta>();
        for (const key of Object.keys(state)) {
            if (key === this._sessionId) continue;
            const entries = state[key];
            if (!entries || entries.length === 0) continue;
            const meta = entries[entries.length - 1];
            this._upsertPeerMeta(key, meta);
        }
    }

    private _upsertPeerMeta(id: string, meta: PresenceMeta): void {
        let peer = this._peers.get(id);
        if (!peer) {
            peer = {
                id,
                label: meta.label ?? 'Explorer',
                emoji: meta.emoji ?? '🍬',
                shareDiscoveryGlow: meta.shareDiscoveryGlow ?? false,
                snapshots: [],
                lastSeen: performance.now(),
            };
            this._peers.set(id, peer);
        } else {
            peer.label = meta.label ?? peer.label;
            peer.emoji = meta.emoji ?? peer.emoji;
            peer.shareDiscoveryGlow = meta.shareDiscoveryGlow ?? peer.shareDiscoveryGlow;
            peer.lastSeen = performance.now();
        }

        const maxPeers = CONFIG.presence?.maxPeers ?? 16;
        if (this._peers.size > maxPeers) {
            const sorted = [...this._peers.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
            while (this._peers.size > maxPeers) {
                const [dropId] = sorted.shift()!;
                this._peers.delete(dropId);
            }
        }
    }

    private _ingestPose(payload: PresencePose | null | undefined): void {
        if (!payload?.id || payload.id === this._sessionId) return;
        if (!Array.isArray(payload.pos) || payload.pos.length < 3) return;
        if (!Array.isArray(payload.quat) || payload.quat.length < 4) return;

        let peer = this._peers.get(payload.id);
        if (!peer) {
            peer = {
                id: payload.id,
                label: 'Explorer',
                emoji: '🍬',
                shareDiscoveryGlow: false,
                snapshots: [],
                lastSeen: performance.now(),
            };
            this._peers.set(payload.id, peer);
        }

        peer.lastSeen = performance.now();
        peer.snapshots.push({
            id: payload.id,
            pos: payload.pos,
            quat: payload.quat,
            biome: payload.biome ?? 'global',
            ts: payload.ts ?? performance.now(),
            action: payload.action,
        });
        if (peer.snapshots.length > MAX_SNAPSHOTS) {
            peer.snapshots.splice(0, peer.snapshots.length - MAX_SNAPSHOTS);
        }
    }

    private _removePeer(id: string): void {
        this._peers.delete(id);
    }

    private _pruneStalePeers(now: number): void {
        for (const [id, peer] of this._peers) {
            if (now - peer.lastSeen > STALE_PEER_MS) {
                this._peers.delete(id);
            }
        }
    }
}

export const presenceSystem = PresenceSystem.getInstance();

export function initPresenceFromOptIn(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.Renderer
): void {
    if (!FEATURE_FLAGS.presence || !isPresenceOptedIn()) return;
    presenceSystem.bindScene(scene, camera, renderer);
    void presenceSystem.join();
}

export function updatePresenceSystem(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition?: THREE.Vector3
): void {
    if (!presenceSystem.joined) return;
    presenceSystem.update(delta, camera, playerPosition);
}

export function teardownPresence(): void {
    void presenceSystem.leave();
}

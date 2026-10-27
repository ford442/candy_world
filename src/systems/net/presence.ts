/**
 * @file presence.ts
 * @brief Opt-in multiplayer presence via Supabase Realtime (presence + broadcast).
 *
 * Room key = world seed. Publishes camera pose at ~10 Hz. No accounts — ephemeral session ids.
 * Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. Networking stays off until join().
 *
 * A shared world (#1975) joins the private room `world:<uuid>` instead, on the
 * signed-in shared client, and carries its `progress` events here too
 * (`shared-world-session.ts`).
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import * as THREE from 'three';
import type { Renderer } from 'three/webgpu';
import { CONFIG, FEATURE_FLAGS } from '../../core/config.ts';
import type { ImpactType } from '../../foliage/impacts.ts';
import { announce } from '../../ui/announcer.ts';
import { getWorldSeed, readSharedWorldIdFromURL } from '../../world/world-seed.ts';
import { getBiomeAtPosition } from './biome-at-position.ts';
import {
    BIOME_DISPLAY_NAMES,
    detectPeerBiomeEntry,
    ingestPose,
    mergePresenceMeta,
    pruneStalePeers,
} from './presence-protocol.ts';
import {
    PRESENCE_BROADCAST_EVENT,
    type PresenceMeta,
    type PresencePose,
    type RemotePeer,
} from './presence-types.ts';
import { remoteAvatars } from './remote-avatars.ts';
import { getSupabaseClient } from './supabase-client.ts';
import { getSupabaseConfig, isSupabaseConfigured } from './supabase-config.ts';

export type PresenceSpawnImpact = (
    pos: { x: number; y: number; z: number },
    type?: ImpactType,
    color?: number
) => void;

export interface PresenceInitHooks {
    spawnImpact?: PresenceSpawnImpact;
}

const PRESENCE_OPT_IN_KEY = 'candy_presence_opt_in';
const STALE_PEER_MS = 15_000;
const MAX_SNAPSHOTS = 8;

const _scratchQuat = new THREE.Quaternion();

export function isPresenceBackendConfigured(): boolean {
    return isSupabaseConfigured();
}

export interface PresenceJoinOptions {
    label?: string;
    emoji?: string;
    seed?: number;
    /** Topic to join instead of `candy:<seed>` (a shared world's `world:<uuid>`). */
    room?: string;
    /** Realtime Authorization: the room's RLS policies decide who may join. */
    privateChannel?: boolean;
    /** Use this session id (a shared world reuses its co-editing peer id). */
    sessionId?: string;
    /** Merged into the tracked presence meta (role, join time). */
    meta?: Record<string, unknown>;
    /** Extra broadcast events on the room, registered before subscribing. */
    broadcast?: Record<string, (payload: unknown) => void>;
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
    private _room = '';
    private _kickHandler: ((peerId: string) => void) | null = null;
    private _sessionId = '';
    private _label = '';
    private _emoji = '';
    private _joined = false;
    private _lastPublish = 0;
    private _peers = new Map<string, RemotePeer>();
    private _localPos = new THREE.Vector3();
    private _shareDiscoveryGlow = false;
    private _hideSelf = false;
    private _mutedPeerIds = new Set<string>();
    /** Kicked from a shared world: never shown again this session. */
    private _blockedPeerIds = new Set<string>();
    private _peersDirty = false;
    private _spawnImpact: PresenceSpawnImpact | null = null;
    private _scene: THREE.Scene | null = null;

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

    get peers(): ReadonlyMap<string, RemotePeer> {
        return this._peers;
    }

    get sessionId(): string {
        return this._sessionId;
    }

    get room(): string {
        return this._room;
    }

    /** Send a broadcast on the joined room (shared-world progress events). */
    broadcast(event: string, payload: unknown): void {
        if (!this._joined || !this._channel) return;
        void this._channel.send({ type: 'broadcast', event, payload });
    }

    /** The world owner can remove peers: the peer list shows a Remove button while set. */
    setKickHandler(handler: ((peerId: string) => void) | null): void {
        this._kickHandler = handler;
        this._peersDirty = true;
    }

    /** Drop a peer from this room for good (a kick): hidden and ignored. */
    blockPeer(peerId: string): void {
        this._blockedPeerIds.add(peerId);
        this.mutePeer(peerId);
        this._removePeer(peerId);
    }

    isPeerBlocked(peerId: string): boolean {
        return this._blockedPeerIds.has(peerId);
    }

    setHideSelf(hide: boolean): void {
        this._hideSelf = hide;
    }

    get hideSelf(): boolean {
        return this._hideSelf;
    }

    mutePeer(peerId: string): void {
        this._mutedPeerIds.add(peerId);
        remoteAvatars.setMutedPeers(this._mutedPeerIds);
        this._peersDirty = true;
    }

    unmutePeer(peerId: string): void {
        this._mutedPeerIds.delete(peerId);
        remoteAvatars.setMutedPeers(this._mutedPeerIds);
        this._peersDirty = true;
    }

    isPeerMuted(peerId: string): boolean {
        return this._mutedPeerIds.has(peerId);
    }

    /** Future seam: mirror save-system shareDiscoveryGlowWithPeers */
    setShareDiscoveryGlow(enabled: boolean): void {
        this._shareDiscoveryGlow = enabled;
    }

    bindScene(
        scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        renderer: Renderer,
        hooks?: PresenceInitHooks
    ): void {
        if (hooks?.spawnImpact) this._spawnImpact = hooks.spawnImpact;
        this._scene = scene;
        remoteAvatars.init(scene, camera, renderer);
    }

    /** The scene bound at init (shared-world build cursors draw into it). */
    get scene(): THREE.Scene | null {
        return this._scene;
    }

    async join(opts: PresenceJoinOptions = {}): Promise<boolean> {
        if (!FEATURE_FLAGS.presence) {
            console.warn('[Presence] Feature flag disabled (?presence=1 to enable UI)');
            return false;
        }

        if (!getSupabaseConfig()) {
            console.warn(
                '[Presence] Supabase not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)'
            );
            return false;
        }

        if (this._joined) return true;

        this._client = getSupabaseClient();
        if (!this._client) return false;

        this._sessionId = opts.sessionId ?? crypto.randomUUID();
        this._label = opts.label?.trim() || randomLabel();
        this._emoji = opts.emoji?.trim() || randomEmoji();

        const seed = opts.seed ?? getWorldSeed();
        const room = opts.room ?? `candy:${seed}`;
        this._room = room;

        const meta: PresenceMeta = {
            ...opts.meta,
            id: this._sessionId,
            label: this._label,
            emoji: this._emoji,
            shareDiscoveryGlow: this._shareDiscoveryGlow,
        };

        this._channel = this._client.channel(room, {
            config: {
                private: opts.privateChannel ?? false,
                presence: { key: this._sessionId },
                broadcast: { self: false },
            },
        });

        for (const [event, handler] of Object.entries(opts.broadcast ?? {})) {
            this._channel.on('broadcast', { event }, ({ payload }) => {
                const sender = (payload as { author?: unknown } | null)?.author;
                if (typeof sender === 'string' && this._mutedPeerIds.has(sender)) return;
                handler(payload);
            });
        }
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
                    this._peersDirty = true;
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
        this._room = '';
        this._kickHandler = null;
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

        if (now - this._lastPublish >= tickMs && !this._hideSelf) {
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

        remoteAvatars.setMutedPeers(this._mutedPeerIds);
        remoteAvatars.syncPeers(this._peers, this._localPos);
        remoteAvatars.updateTags();

        // ⚡ OPTIMIZATION: Bypassed per-frame array allocation and UI DOM updates by dirty-flagging peer list emits
        if (this._peersDirty) {
            this._emitPeerListUpdate();
            this._peersDirty = false;
        }
    }

    private _emitPeerListUpdate(): void {
        if (typeof window === 'undefined') return;

        // ⚡ OPTIMIZATION: Bypassed array spread and .map() to prevent GC spikes in peer list emits.
        const mappedPeers = [];
        for (const p of this._peers.values()) {
            mappedPeers.push({
                id: p.id,
                label: p.label,
                emoji: p.emoji,
                muted: this._mutedPeerIds.has(p.id),
                kickable: this._kickHandler !== null,
            });
        }

        window.dispatchEvent(
            new CustomEvent('candy:presence-peers', {
                detail: {
                    peers: mappedPeers,
                    peerCount: this._peers.size,
                    maxPeers: CONFIG.presence?.maxPeers ?? 16,
                },
            })
        );
    }

    private _onPeerBiomeEntry(peer: RemotePeer, biome: string): void {
        const name = BIOME_DISPLAY_NAMES[biome] ?? biome.replace(/_/g, ' ');
        announce(`An explorer entered the ${name}`, 'polite');
        if (peer.snapshots.length > 0) {
            const snap = peer.snapshots[peer.snapshots.length - 1];
            this._spawnImpact?.(
                { x: snap.pos[0], y: snap.pos[1], z: snap.pos[2] },
                'spore',
                0xffb6e8
            );
        }
    }

    dispose(): void {
        void this.leave();
        remoteAvatars.dispose();
    }

    private _mergePresenceState(): void {
        if (!this._channel) return;
        const state = this._channel.presenceState<PresenceMeta>();
        mergePresenceMeta(this._peers, state, this._sessionId, CONFIG.presence?.maxPeers ?? 16);
        for (const id of this._blockedPeerIds) this._peers.delete(id);
        this._peersDirty = true;
        this._emitPeerListUpdate();
    }

    /** Called by the peer list's Remove button. */
    kickPeer(peerId: string): void {
        this._kickHandler?.(peerId);
    }

    private _ingestPose(payload: PresencePose | null | undefined): void {
        if (payload && this._blockedPeerIds.has(payload.id)) return;
        if (!ingestPose(this._peers, this._sessionId, payload)) return;
        const peer = this._peers.get(payload!.id);
        if (!peer) return;
        const entered = detectPeerBiomeEntry(peer);
        if (entered) this._onPeerBiomeEntry(peer, entered);
    }

    private _removePeer(id: string): void {
        if (this._peers.has(id)) {
            this._peers.delete(id);
            this._peersDirty = true;
        }
    }

    private _pruneStalePeers(now: number): void {
        const removed = pruneStalePeers(this._peers, now, STALE_PEER_MS);
        if (removed.length > 0) {
            this._peersDirty = true;
        }
        if (removed.length > 0) this._emitPeerListUpdate();
    }
}

export const presenceSystem = PresenceSystem.getInstance();

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        teardownPresence();
    });
}

export function initPresenceFromOptIn(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: Renderer,
    hooks?: PresenceInitHooks
): void {
    if (!FEATURE_FLAGS.presence) return;
    presenceSystem.bindScene(scene, camera, renderer, hooks);
    // A shared world link joins that world's room (shared-worlds.ts), not the seed's.
    if (!isPresenceOptedIn() || readSharedWorldIdFromURL()) return;
    void presenceSystem.join();
}

export function updatePresenceSystem(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition?: THREE.Vector3
): void {
    if (!FEATURE_FLAGS.presence || !presenceSystem.joined) return;
    presenceSystem.update(delta, camera, playerPosition);
}

export function teardownPresence(): void {
    void presenceSystem.leave();
}

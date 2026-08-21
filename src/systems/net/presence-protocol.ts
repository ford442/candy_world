/**
 * Pure presence protocol helpers — unit-tested without live Supabase.
 */

import type { PresenceMeta, PresencePose, RemotePeer } from './presence-types.ts';

export const PRESENCE_STALE_MS = 15_000;
/** Consecutive poses required before a biome-entry cue fires (~300ms at 10Hz). */
export const BIOME_ENTRY_CONFIRM = 3;

export function isValidPose(payload: unknown): payload is PresencePose {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as PresencePose;
    if (!p.id || typeof p.id !== 'string') return false;
    if (!Array.isArray(p.pos) || p.pos.length < 3) return false;
    if (!Array.isArray(p.quat) || p.quat.length < 4) return false;
    if (typeof p.ts !== 'number') return false;
    return true;
}

export function pruneStalePeers(
    peers: Map<string, RemotePeer>,
    now: number,
    staleMs: number = PRESENCE_STALE_MS
): string[] {
    const removed: string[] = [];
    for (const [id, peer] of peers) {
        if (now - peer.lastSeen > staleMs) {
            peers.delete(id);
            removed.push(id);
        }
    }
    return removed;
}

export function mergePresenceMeta(
    peers: Map<string, RemotePeer>,
    state: Record<string, PresenceMeta[]>,
    sessionId: string,
    maxPeers: number
): void {
    for (const key in state) {
        if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
        if (key === sessionId) continue;
        const entries = state[key];
        if (!entries || entries.length === 0) continue;
        const meta = entries[entries.length - 1];
        let peer = peers.get(key);
        if (!peer) {
            peer = {
                id: key,
                label: meta.label ?? 'Explorer',
                emoji: meta.emoji ?? '🍬',
                shareDiscoveryGlow: meta.shareDiscoveryGlow ?? false,
                snapshots: [],
                lastSeen: performance.now(),
                lastBiome: 'global',
            };
            peers.set(key, peer);
        } else {
            peer.label = meta.label ?? peer.label;
            peer.emoji = meta.emoji ?? peer.emoji;
            peer.shareDiscoveryGlow = meta.shareDiscoveryGlow ?? peer.shareDiscoveryGlow;
            peer.lastSeen = performance.now();
        }
    }

    if (peers.size > maxPeers) {
        const sorted = [...peers.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
        while (peers.size > maxPeers) {
            const [dropId] = sorted.shift()!;
            peers.delete(dropId);
        }
    }
}

export function ingestPose(
    peers: Map<string, RemotePeer>,
    sessionId: string,
    payload: unknown
): boolean {
    if (!isValidPose(payload)) return false;
    if (payload.id === sessionId) return false;

    let peer = peers.get(payload.id);
    if (!peer) {
        peer = {
            id: payload.id,
            label: 'Explorer',
            emoji: '🍬',
            shareDiscoveryGlow: false,
            snapshots: [],
            lastSeen: performance.now(),
            lastBiome: payload.biome ?? 'global',
        };
        peers.set(payload.id, peer);
    }

    peer.lastSeen = performance.now();
    peer.snapshots.push({
        id: payload.id,
        pos: payload.pos,
        quat: payload.quat,
        biome: payload.biome ?? 'global',
        ts: payload.ts,
        action: payload.action,
    });
    const maxSnaps = 8;
    if (peer.snapshots.length > maxSnaps) {
        peer.snapshots.splice(0, peer.snapshots.length - maxSnaps);
    }
    return true;
}

/**
 * Returns biome id when a peer enters a new region (for announcer / VFX).
 * Debounces boundary noise: BIOME_ENTRY_CONFIRM consecutive poses in the new
 * biome are required. Skips 'global' (no announcement when leaving a region).
 */
export function detectPeerBiomeEntry(peer: RemotePeer): string | null {
    if (peer.snapshots.length === 0) return null;
    const latest = peer.snapshots[peer.snapshots.length - 1].biome ?? 'global';
    if (!peer.lastBiome) {
        peer.lastBiome = latest;
        return null;
    }
    if (peer.lastBiome === latest) {
        peer.pendingBiome = undefined;
        peer.pendingBiomeCount = 0;
        return null;
    }
    if (peer.pendingBiome !== latest) {
        peer.pendingBiome = latest;
        peer.pendingBiomeCount = 1;
        return null;
    }
    peer.pendingBiomeCount = (peer.pendingBiomeCount ?? 0) + 1;
    if (peer.pendingBiomeCount < BIOME_ENTRY_CONFIRM) return null;
    peer.lastBiome = latest;
    peer.pendingBiome = undefined;
    peer.pendingBiomeCount = 0;
    return latest === 'global' ? null : latest;
}

export const BIOME_DISPLAY_NAMES: Record<string, string> = {
    arpeggio_grove: 'Arpeggio Grove',
    gem_canopy: 'Gem Canopy',
    sky_islands: 'Sky Islands',
    sugar_caves: 'Sugar Caves',
    crystalline_nebula: 'Crystalline Nebula',
    luminous_plants: 'Luminous Plants',
    lake_features: 'Melody Lake',
};

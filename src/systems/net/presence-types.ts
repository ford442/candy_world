/**
 * Presence networking types — pose snapshots and peer metadata.
 */

export interface PresencePose {
    id: string;
    pos: [number, number, number];
    quat: [number, number, number, number];
    biome: string;
    ts: number;
    /** Optional ability / action bit for future VFX sync */
    action?: number;
}

export interface PresenceMeta {
    id: string;
    label: string;
    emoji: string;
    /** Reserved: peer-visible discovery glow (wired later via save system) */
    shareDiscoveryGlow?: boolean;
}

export interface RemotePeer {
    id: string;
    label: string;
    emoji: string;
    shareDiscoveryGlow: boolean;
    snapshots: PresencePose[];
    lastSeen: number;
}

export const PRESENCE_BROADCAST_EVENT = 'pose';

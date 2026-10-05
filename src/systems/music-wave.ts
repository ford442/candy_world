/**
 * Thin sky-wave types + accessors shared by music-reactivity and foliage batchers.
 *
 * Kept free of foliage / MusicReactivitySystem imports so Rollup can separate
 * systems↔foliage without circular *chunk* dependencies (#1361).
 */
import * as THREE from 'three';

export interface ActiveWave {
    color: THREE.Color;
    timestamp: number;
    origin?: THREE.Vector3;
    speed?: number;
}

/** Concurrent waves in flight; 4 covers ~180 BPM with an 800 ms propagation window. */
export const WAVE_SLOT_COUNT = 4;

export interface WaveSlot extends ActiveWave {
    active: boolean;
}

/**
 * Fixed-size ring of in-flight waves. Every slot (and its Color) is allocated once,
 * so pushing a beat or expiring a wave never allocates. `head` is the next slot to
 * write, which is also the oldest slot — iterate from `head` to visit oldest→newest.
 */
export class WaveRing {
    readonly slots: WaveSlot[] = Array.from({ length: WAVE_SLOT_COUNT }, () => ({
        active: false,
        color: new THREE.Color(),
        timestamp: 0,
        speed: 25.0,
    }));
    head = 0;

    /** Claim the next slot for a wave that starts at `now` and return it. */
    push(color: THREE.Color, now: number): WaveSlot {
        const slot = this.slots[this.head];
        this.head = (this.head + 1) % WAVE_SLOT_COUNT;
        slot.active = true;
        slot.timestamp = now;
        slot.color.copy(color);
        return slot;
    }

    /** Deactivate slots older than `lifetimeMs`; returns true while any wave remains. */
    expire(now: number, lifetimeMs: number): boolean {
        let anyActive = false;
        for (let i = 0; i < WAVE_SLOT_COUNT; i++) {
            const slot = this.slots[i];
            if (!slot.active) continue;
            if (now - slot.timestamp >= lifetimeMs) slot.active = false;
            else anyActive = true;
        }
        return anyActive;
    }

    clear(): void {
        for (let i = 0; i < WAVE_SLOT_COUNT; i++) this.slots[i].active = false;
    }

    /** The most recently pushed slot, or null if none is active. */
    newestActive(): WaveSlot | null {
        const slot = this.slots[(this.head + WAVE_SLOT_COUNT - 1) % WAVE_SLOT_COUNT];
        return slot.active ? slot : null;
    }
}

/** Shared zero vector for wave origin fallbacks (hot-path safe). */
export const _zeroVec = new THREE.Vector3();

/** Module-scoped active wave — written by MusicReactivitySystem, read by batchers. */
let _activeWave: ActiveWave | null = null;

export function getActiveWave(): ActiveWave | null {
    return _activeWave;
}

export function setActiveWave(wave: ActiveWave | null): void {
    _activeWave = wave;
}

/** Squared distance from plant to wave origin (avoids sqrt in pose hot path). */
export function computeWaveDistSq(
    plantWorldPos: THREE.Vector3,
    activeWave: ActiveWave | null,
    cameraPosition?: THREE.Vector3
): number {
    if (!activeWave) return -1;
    const origin = activeWave.origin || cameraPosition || _zeroVec;
    const dx = plantWorldPos.x - origin.x;
    const dy = plantWorldPos.y - origin.y;
    const dz = plantWorldPos.z - origin.z;
    return dx * dx + dy * dy + dz * dz;
}

/** Seconds since the wave front arrived at plantWorldPos (negative = not yet). */
export function computeWaveTimeSinceArrival(
    plantWorldPos: THREE.Vector3,
    activeWave: ActiveWave | null,
    cameraPosition?: THREE.Vector3
): number {
    if (!activeWave) return -999;
    const origin = activeWave.origin || cameraPosition || _zeroVec;
    const speed = activeWave.speed || 25.0;
    const dx = plantWorldPos.x - origin.x;
    const dy = plantWorldPos.y - origin.y;
    const dz = plantWorldPos.z - origin.z;

    // ⚡ OPTIMIZATION: Deferred Math.sqrt(). Early-out if the wave front hasn't reached the plant yet.
    const distSq = dx * dx + dy * dy + dz * dz;
    const elapsed = (performance.now() - activeWave.timestamp) / 1000;
    const waveRadius = elapsed * speed;

    if (waveRadius <= 0 || distSq > waveRadius * waveRadius) {
        return -1;
    }

    const distance = Math.sqrt(distSq);
    const arrivalTime = activeWave.timestamp + (distance / speed) * 1000;
    return (performance.now() - arrivalTime) / 1000;
}

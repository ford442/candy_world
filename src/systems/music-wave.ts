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
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const arrivalTime = activeWave.timestamp + (distance / speed) * 1000;
    return (performance.now() - arrivalTime) / 1000;
}

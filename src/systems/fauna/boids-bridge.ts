/**
 * WASM ↔ JS bridge for assembly/boids.ts updateBoids.
 * JS fallback mirrors the WASM spatial-grid boids when AS is unavailable.
 */

import { wasmMemory, wasmInstance, wasmUpdateBoids } from '../../utils/wasm-loader-core.ts';
import type { WasmExports } from '../../utils/wasm-loader-types.ts';
import { FAUNA_BOID_STRIDE } from './types.ts';

const MAX_BOIDS = 256;
const GRID_DIM = 32;
const CELL_SIZE = 8;
const WORLD_MIN = -128;
const WORLD_MAX = 128;

const SEP_RADIUS_SQ = 4;
const ALIGN_RADIUS_SQ = 25;
const COH_RADIUS_SQ = 64;
const PLAYER_AVOID_RADIUS_SQ = 100;

const _gridHeads = new Int32Array(GRID_DIM * GRID_DIM);
const _gridNext = new Int32Array(MAX_BOIDS);

function cellIndex(x: number, z: number): number {
    const cx = Math.floor((x - WORLD_MIN) / CELL_SIZE);
    const cz = Math.floor((z - WORLD_MIN) / CELL_SIZE);
    if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) return -1;
    return cz * GRID_DIM + cx;
}

function getGroundHeightJS(x: number, z: number): number {
    if (Number.isNaN(x) || Number.isNaN(z)) return 0;
    return (
        Math.sin(x * 0.05) * 2 +
        Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 +
        Math.cos(z * 0.15) * 0.3
    );
}

function maxSpeedForSpecies(species: number): number {
    if (species === 1) return 3.5;
    if (species === 2) return 2.0;
    return 1.8;
}

function groundOffsetForSpecies(species: number): number {
    if (species === 1) return 0.22;
    if (species === 2) return 0;
    return 0.14;
}

function applyGroundFollow(
    species: number,
    x: number,
    z: number,
    time: number,
    phase: number
): number {
    const ground = getGroundHeightJS(x, z);
    if (species === 2) {
        return ground + 2.5 + Math.sin(time * 1.2 + phase) * 0.6;
    }
    if (species === 1) {
        return (
            ground + groundOffsetForSpecies(species) + Math.abs(Math.sin(time * 4 + phase)) * 0.35
        );
    }
    return ground + groundOffsetForSpecies(species);
}

function rebuildGrid(heap: Float32Array, byteOffset: number, count: number): void {
    _gridHeads.fill(-1);
    const base = byteOffset >> 2;
    for (let i = 0; i < count; i++) {
        const b = base + i * FAUNA_BOID_STRIDE;
        const x = heap[b];
        const z = heap[b + 2];
        const idx = cellIndex(x, z);
        if (idx < 0) continue;
        _gridNext[i] = _gridHeads[idx];
        _gridHeads[idx] = i;
    }
}

/** JS fallback — same algorithm as assembly/boids.ts */
export function updateBoidsJS(
    heap: Float32Array,
    byteOffset: number,
    count: number,
    dt: number,
    playerX: number,
    playerZ: number,
    time: number
): void {
    const n = Math.min(count, MAX_BOIDS);
    const clampedDt = Math.max(0, Math.min(dt, 0.1));
    const base = byteOffset >> 2;

    rebuildGrid(heap, byteOffset, n);

    for (let i = 0; i < n; i++) {
        const b = base + i * FAUNA_BOID_STRIDE;
        let x = heap[b];
        let y = heap[b + 1];
        let z = heap[b + 2];
        let vx = heap[b + 3];
        let vy = heap[b + 4];
        let vz = heap[b + 5];
        const phase = heap[b + 6];
        const species = heap[b + 7] | 0;

        let sepX = 0,
            sepY = 0,
            sepZ = 0;
        let aliX = 0,
            aliY = 0,
            aliZ = 0;
        let cohX = 0,
            cohY = 0,
            cohZ = 0;
        let aliCount = 0;
        let cohCount = 0;

        const homeCell = cellIndex(x, z);
        if (homeCell >= 0) {
            const cx0 = homeCell % GRID_DIM;
            const cz0 = (homeCell / GRID_DIM) | 0;
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cx = cx0 + dx;
                    const cz = cz0 + dz;
                    if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) continue;
                    const cell = cz * GRID_DIM + cx;
                    let j = _gridHeads[cell];
                    while (j >= 0) {
                        if (j !== i) {
                            const ob = base + j * FAUNA_BOID_STRIDE;
                            const ox = heap[ob];
                            const oy = heap[ob + 1];
                            const oz = heap[ob + 2];
                            const ovx = heap[ob + 3];
                            const ovy = heap[ob + 4];
                            const ovz = heap[ob + 5];
                            const ddx = ox - x;
                            const ddy = oy - y;
                            const ddz = oz - z;
                            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;

                            if (d2 < SEP_RADIUS_SQ && d2 > 0.0001) {
                                const inv = 1 / d2;
                                sepX += (x - ox) * inv;
                                sepY += (y - oy) * inv;
                                sepZ += (z - oz) * inv;
                            }
                            if (d2 < ALIGN_RADIUS_SQ) {
                                aliX += ovx;
                                aliY += ovy;
                                aliZ += ovz;
                                aliCount++;
                            }
                            if (d2 < COH_RADIUS_SQ) {
                                cohX += ox;
                                cohY += oy;
                                cohZ += oz;
                                cohCount++;
                            }
                        }
                        j = _gridNext[j];
                    }
                }
            }
        }

        const pdx = x - playerX;
        const pdz = z - playerZ;
        const pd2 = pdx * pdx + pdz * pdz;
        if (pd2 < PLAYER_AVOID_RADIUS_SQ && pd2 > 0.01) {
            const push = (1 - pd2 / PLAYER_AVOID_RADIUS_SQ) * 4;
            sepX += (pdx / pd2) * push;
            sepZ += (pdz / pd2) * push;
        }

        const wanderX = Math.sin(time * 0.7 + phase * 3.1) * 0.4;
        const wanderZ = Math.cos(time * 0.6 + phase * 2.7) * 0.4;

        let ax = sepX * 2.5 + wanderX;
        let ay = sepY;
        let az = sepZ * 2.5 + wanderZ;

        if (aliCount > 0) {
            const inv = 1 / aliCount;
            ax += (aliX * inv - vx) * 0.5;
            ay += (aliY * inv - vy) * 0.3;
            az += (aliZ * inv - vz) * 0.5;
        }
        if (cohCount > 0) {
            const inv = 1 / cohCount;
            ax += (cohX * inv - x) * 0.15;
            ay += (cohY * inv - y) * 0.05;
            az += (cohZ * inv - z) * 0.15;
        }

        vx += ax * clampedDt;
        vy += ay * clampedDt;
        vz += az * clampedDt;

        const damp = 0.92;
        vx *= damp;
        vy *= damp;
        vz *= damp;

        const maxSpd = maxSpeedForSpecies(species);
        const spd2 = vx * vx + vy * vy + vz * vz;
        if (spd2 > maxSpd * maxSpd) {
            const scale = maxSpd / Math.sqrt(spd2);
            vx *= scale;
            vy *= scale;
            vz *= scale;
        }

        x += vx * clampedDt;
        z += vz * clampedDt;

        if (x < WORLD_MIN) {
            x = WORLD_MIN;
            vx = Math.abs(vx);
        }
        if (x > WORLD_MAX) {
            x = WORLD_MAX;
            vx = -Math.abs(vx);
        }
        if (z < WORLD_MIN) {
            z = WORLD_MIN;
            vz = Math.abs(vz);
        }
        if (z > WORLD_MAX) {
            z = WORLD_MAX;
            vz = -Math.abs(vz);
        }

        y = applyGroundFollow(species, x, z, time, phase);
        if (species !== 2) vy *= 0.5;

        heap[b] = x;
        heap[b + 1] = y;
        heap[b + 2] = z;
        heap[b + 3] = vx;
        heap[b + 4] = vy;
        heap[b + 5] = vz;
    }
}

export function bindBoidsWasm(): void {
    // wasmUpdateBoids is populated by wasm-loader-core cacheWasmFunctions at boot.
}

export function updateBoidsBatch(
    heap: Float32Array,
    byteOffset: number,
    count: number,
    dt: number,
    playerX: number,
    playerZ: number,
    time: number
): void {
    if (wasmUpdateBoids && wasmMemory) {
        wasmUpdateBoids(byteOffset, count, dt, playerX, playerZ, time);
        return;
    }
    updateBoidsJS(heap, byteOffset, count, dt, playerX, playerZ, time);
}

export function allocateBoidsBuffer(count: number): { ptr: number; view: Float32Array } | null {
    if (!wasmInstance || !wasmMemory) return null;
    const malloc = (wasmInstance.exports as WasmExports).malloc as
        ((n: number) => number) | undefined;
    if (!malloc) return null;
    const bytes = count * FAUNA_BOID_STRIDE * 4;
    const ptr = malloc(bytes);
    if (!ptr) return null;
    const view = new Float32Array(wasmMemory.buffer, ptr, count * FAUNA_BOID_STRIDE);
    return { ptr, view };
}

export function freeBoidsBuffer(ptr: number): void {
    if (!wasmInstance || !ptr) return;
    const free = (wasmInstance.exports as WasmExports).free as ((p: number) => void) | undefined;
    free?.(ptr);
}

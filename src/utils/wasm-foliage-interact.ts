/**
 * WASM bridge for batch foliage ↔ player interactions.
 * JS fallbacks mirror physics-updates.ts exactly.
 */

import {
    cppBatchGeyserLaunch,
    cppBatchPadForces,
    cppBatchVineInteraction,
    getEmscriptenInstance,
    isEmscriptenReady,
} from './wasm-loader-core.ts';

// -----------------------------------------------------------------------------
// Packed layout constants
// -----------------------------------------------------------------------------

export const GEYSER_STRIDE = 5; // x, y, z, eruptionStrength, maxHeight
export const PAD_STRIDE = 6;    // x, y, z, scaleX, scaleY, currentBob
export const VINE_STRIDE = 4;   // anchorX, anchorY, anchorZ, length

const MAX_BATCH = 64;

const _geyserIn = new Float32Array(MAX_BATCH * GEYSER_STRIDE);
const _geyserOut = new Float32Array(4);
const _padIn = new Float32Array(MAX_BATCH * PAD_STRIDE);
const _padOut = new Float32Array(5);
const _vineIn = new Float32Array(MAX_BATCH * VINE_STRIDE);
const _vineOut = new Float32Array(3);

// Persistent C++ pointers
let _geyserInPtr: number | null = null;
let _geyserOutPtr: number | null = null;
let _padInPtr: number | null = null;
let _padOutPtr: number | null = null;
let _vineInPtr: number | null = null;
let _vineOutPtr: number | null = null;

function ensurePtr(
    inPtr: number | null,
    outPtr: number | null,
    inBytes: number,
    outBytes: number
): { inPtr: number; outPtr: number } | null {
    const em = getEmscriptenInstance();
    if (!em?._malloc || !em._free) return null;
    let ip = inPtr;
    let op = outPtr;
    if (!ip) ip = em._malloc(inBytes);
    if (!op) op = em._malloc(outBytes);
    if (!ip || !op) return null;
    return { inPtr: ip, outPtr: op };
}

// -----------------------------------------------------------------------------
// JS fallbacks (mirror physics-updates.ts)
// -----------------------------------------------------------------------------

export interface GeyserLaunchResult {
    hit: boolean;
    vy: number;
    airJump: boolean;
    unground: boolean;
}

export function geyserLaunchJS(
    px: number,
    py: number,
    pz: number,
    pvy: number,
    delta: number,
    geysers: Float32Array,
    count: number
): GeyserLaunchResult {
    let vy = pvy;
    let hit = false;
    const radiusSq = 2.25;
    const baseHeight = 0.5;

    for (let i = 0; i < count; i++) {
        const base = i * GEYSER_STRIDE;
        const gx = geysers[base];
        const gy = geysers[base + 1];
        const gz = geysers[base + 2];
        const eruption = geysers[base + 3];
        const maxHeight = geysers[base + 4];

        const dx = px - gx;
        const dz = pz - gz;
        const distSq = dx * dx + dz * dz;
        if (distSq >= radiusSq) continue;

        const activeHeight = maxHeight * eruption;
        const minY = gy + baseHeight - 0.5;
        const maxY = gy + activeHeight + 1.0;
        if (py < minY || py > maxY) continue;
        if (eruption <= 0.1) continue;

        const targetVel = 15.0 * eruption;
        if (vy < targetVel) {
            vy += (targetVel - vy) * 5.0 * delta;
        }
        hit = true;
    }

    return {
        hit,
        vy,
        airJump: hit,
        unground: hit,
    };
}

export type PadAction = 'none' | 'snap' | 'launch';

export interface PadForceResult {
    hit: boolean;
    action: PadAction;
    vy: number;
    snapY: number;
    padIndex: number;
}

export function padForcesJS(
    px: number,
    py: number,
    pz: number,
    pvy: number,
    pads: Float32Array,
    count: number
): PadForceResult {
    const none: PadForceResult = { hit: false, action: 'none', vy: pvy, snapY: py, padIndex: -1 };

    for (let i = 0; i < count; i++) {
        const base = i * PAD_STRIDE;
        const padX = pads[base];
        const padY = pads[base + 1];
        const padZ = pads[base + 2];
        const scaleX = pads[base + 3];
        const scaleY = pads[base + 4];
        const currentBob = pads[base + 5];

        const dx = px - padX;
        const dz = pz - padZ;
        const distSq = dx * dx + dz * dz;
        const radius = 1.5 * scaleX;
        if (distSq >= radius * radius) continue;

        const topY = padY + 0.1 * scaleY;
        if (pvy > 0) continue;
        if (py < topY - 0.2 || py > topY + 0.5) continue;

        if (currentBob > 0.5) {
            return { hit: true, action: 'launch', vy: 20.0, snapY: py, padIndex: i };
        }
        return { hit: true, action: 'snap', vy: 0, snapY: topY, padIndex: i };
    }
    return none;
}

export interface VineProximityResult {
    candidateIndex: number;
    distHSq: number;
    inAttachZone: boolean;
}

export function vineProximityJS(
    px: number,
    py: number,
    pz: number,
    vines: Float32Array,
    count: number
): VineProximityResult {
    let bestIndex = -1;
    let bestDistHSq = Number.POSITIVE_INFINITY;
    let inAttachZone = false;

    for (let i = 0; i < count; i++) {
        const base = i * VINE_STRIDE;
        const ax = vines[base];
        const ay = vines[base + 1];
        const az = vines[base + 2];
        const length = vines[base + 3];

        const dx = px - ax;
        const dz = pz - az;
        const distHSq = dx * dx + dz * dz;
        const tipY = ay - length;

        if (distHSq >= 4.0) continue;
        if (py >= ay || py <= tipY) continue;

        if (distHSq < bestDistHSq) {
            bestDistHSq = distHSq;
            bestIndex = i;
            inAttachZone = distHSq < 1.0;
        }
    }

    return { candidateIndex: bestIndex, distHSq: bestDistHSq, inAttachZone };
}

// -----------------------------------------------------------------------------
// Pack helpers (zero alloc when count fits scratch)
// -----------------------------------------------------------------------------

export function packGeysers(
    nearby: Array<{ position: { x: number; y: number; z: number }; userData: Record<string, unknown> }>,
    out: Float32Array = _geyserIn
): { data: Float32Array; count: number } {
    const count = Math.min(nearby.length, MAX_BATCH);
    for (let i = 0; i < count; i++) {
        const g = nearby[i];
        const base = i * GEYSER_STRIDE;
        out[base] = g.position.x;
        out[base + 1] = g.position.y;
        out[base + 2] = g.position.z;
        out[base + 3] = typeof g.userData.eruptionStrength === 'number' ? g.userData.eruptionStrength : 0;
        out[base + 4] = typeof g.userData.maxHeight === 'number' ? g.userData.maxHeight : 5.0;
    }
    return { data: out, count };
}

export function packPads(
    nearby: Array<{ position: { x: number; y: number; z: number }; scale: { x: number; y: number }; userData: Record<string, unknown> }>,
    out: Float32Array = _padIn
): { data: Float32Array; count: number } {
    const count = Math.min(nearby.length, MAX_BATCH);
    for (let i = 0; i < count; i++) {
        const p = nearby[i];
        const base = i * PAD_STRIDE;
        out[base] = p.position.x;
        out[base + 1] = p.position.y;
        out[base + 2] = p.position.z;
        out[base + 3] = p.scale.x || 1.0;
        out[base + 4] = p.scale.y || 1.0;
        out[base + 5] = typeof p.userData.currentBob === 'number' ? p.userData.currentBob : 0;
    }
    return { data: out, count };
}

export function packVines(
    vines: Array<{ anchorPoint?: { x: number; y: number; z: number }; length?: number; attach?: (player: unknown, velocity: unknown) => void }>,
    out: Float32Array = _vineIn,
    managersOut: unknown[] = []
): { data: Float32Array; count: number; managers: unknown[] } {
    let written = 0;
    managersOut.length = 0;
    for (let i = 0; i < vines.length && written < MAX_BATCH; i++) {
        const v = vines[i];
        const a = v.anchorPoint;
        if (!a || typeof a.x !== 'number' || typeof a.y !== 'number' || typeof a.z !== 'number') continue;
        const base = written * VINE_STRIDE;
        out[base] = a.x;
        out[base + 1] = a.y;
        out[base + 2] = a.z;
        out[base + 3] = typeof v.length === 'number' ? v.length : 0;
        managersOut.push(v);
        written++;
    }
    return { data: out, count: written, managers: managersOut };
}

// -----------------------------------------------------------------------------
// Native batch entry points
// -----------------------------------------------------------------------------

export function batchGeyserLaunch(
    px: number,
    py: number,
    pz: number,
    pvy: number,
    delta: number,
    geysers: Float32Array,
    count: number
): GeyserLaunchResult {
    if (count === 0) {
        return { hit: false, vy: pvy, airJump: false, unground: false };
    }

    if (cppBatchGeyserLaunch && isEmscriptenReady()) {
        const em = getEmscriptenInstance();
        const ptrs = ensurePtr(_geyserInPtr, _geyserOutPtr, MAX_BATCH * GEYSER_STRIDE * 4, 16);
        if (ptrs && em?.HEAPF32) {
            _geyserInPtr = ptrs.inPtr;
            _geyserOutPtr = ptrs.outPtr;
            em.HEAPF32.set(geysers.subarray(0, count * GEYSER_STRIDE), _geyserInPtr >> 2);
            cppBatchGeyserLaunch(px, py, pz, pvy, delta, _geyserInPtr, count, _geyserOutPtr);
            const out = em.HEAPF32.subarray(_geyserOutPtr >> 2, (_geyserOutPtr >> 2) + 4);
            return {
                hit: out[0] > 0.5,
                vy: out[1],
                airJump: out[2] > 0.5,
                unground: out[3] > 0.5,
            };
        }
    }

    return geyserLaunchJS(px, py, pz, pvy, delta, geysers, count);
}

export function batchPadForces(
    px: number,
    py: number,
    pz: number,
    pvy: number,
    pads: Float32Array,
    count: number
): PadForceResult {
    if (count === 0) {
        return { hit: false, action: 'none', vy: pvy, snapY: py, padIndex: -1 };
    }

    if (cppBatchPadForces && isEmscriptenReady()) {
        const em = getEmscriptenInstance();
        const ptrs = ensurePtr(_padInPtr, _padOutPtr, MAX_BATCH * PAD_STRIDE * 4, 20);
        if (ptrs && em?.HEAPF32) {
            _padInPtr = ptrs.inPtr;
            _padOutPtr = ptrs.outPtr;
            em.HEAPF32.set(pads.subarray(0, count * PAD_STRIDE), _padInPtr >> 2);
            cppBatchPadForces(px, py, pz, pvy, _padInPtr, count, _padOutPtr);
            const out = em.HEAPF32.subarray(_padOutPtr >> 2, (_padOutPtr >> 2) + 5);
            const actionCode = out[1];
            return {
                hit: out[0] > 0.5,
                action: actionCode > 1.5 ? 'launch' : actionCode > 0.5 ? 'snap' : 'none',
                vy: out[2],
                snapY: out[3],
                padIndex: out[4] | 0,
            };
        }
    }

    return padForcesJS(px, py, pz, pvy, pads, count);
}

export function batchVineInteraction(
    px: number,
    py: number,
    pz: number,
    vines: Float32Array,
    count: number
): VineProximityResult {
    if (count === 0) {
        return { candidateIndex: -1, distHSq: Number.POSITIVE_INFINITY, inAttachZone: false };
    }

    if (cppBatchVineInteraction && isEmscriptenReady()) {
        const em = getEmscriptenInstance();
        const ptrs = ensurePtr(_vineInPtr, _vineOutPtr, MAX_BATCH * VINE_STRIDE * 4, 12);
        if (ptrs && em?.HEAPF32) {
            _vineInPtr = ptrs.inPtr;
            _vineOutPtr = ptrs.outPtr;
            em.HEAPF32.set(vines.subarray(0, count * VINE_STRIDE), _vineInPtr >> 2);
            cppBatchVineInteraction(px, py, pz, _vineInPtr, count, _vineOutPtr);
            const out = em.HEAPF32.subarray(_vineOutPtr >> 2, (_vineOutPtr >> 2) + 3);
            return {
                candidateIndex: out[0] | 0,
                distHSq: out[1],
                inAttachZone: out[2] > 0.5,
            };
        }
    }

    return vineProximityJS(px, py, pz, vines, count);
}

export function isNativeFoliageInteractReady(): boolean {
    return cppBatchGeyserLaunch !== null && isEmscriptenReady();
}

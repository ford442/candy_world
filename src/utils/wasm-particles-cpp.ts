/**
 * @file wasm-particles-cpp.ts
 * @description Emscripten batch update for CPU particle fallback systems.
 */

import {
    emscriptenMemory,
    getEmscriptenInstance,
    getNativeFuncVoid,
    isEmscriptenReady,
} from './wasm-loader-core.ts';
import {
    CPU_PARTICLE_TYPE_ID,
    type CpuParticleBuffers,
    type CpuParticleSimParams,
} from '../particles/cpu-particle-simulate.ts';

let cachedUpdateCpuParticles: ((...args: number[]) => void) | null = null;

function getUpdateCpuParticlesFn(): ((...args: number[]) => void) | null {
    if (cachedUpdateCpuParticles !== null) return cachedUpdateCpuParticles;
    cachedUpdateCpuParticles = getNativeFuncVoid('updateCpuParticlesWASM');
    return cachedUpdateCpuParticles;
}

/**
 * Run the native CPU particle simulation when Emscripten is available.
 * @returns true if the native path ran, false if caller should use TS fallback.
 */
export function updateCpuParticlesNative(
    buffers: CpuParticleBuffers,
    params: CpuParticleSimParams
): boolean {
    if (!isEmscriptenReady()) return false;

    const fn = getUpdateCpuParticlesFn();
    const emModule = getEmscriptenInstance();
    if (!fn || !emscriptenMemory || !emModule?._malloc || !emModule._free) {
        return false;
    }

    const { count } = params;
    const posBytes = count * 3 * 4;
    const velBytes = count * 3 * 4;
    const lifeBytes = count * 4;
    const sizeBytes = count * 4;
    const colorBytes = count * 4 * 4;
    const seedBytes = count * 4;

    const ptrPos = emModule._malloc(posBytes);
    const ptrVel = emModule._malloc(velBytes);
    const ptrLife = emModule._malloc(lifeBytes);
    const ptrSize = emModule._malloc(sizeBytes);
    const ptrColor = emModule._malloc(colorBytes);
    const ptrSeed = emModule._malloc(seedBytes);

    if (!ptrPos || !ptrVel || !ptrLife || !ptrSize || !ptrColor || !ptrSeed) {
        if (ptrPos) emModule._free(ptrPos);
        if (ptrVel) emModule._free(ptrVel);
        if (ptrLife) emModule._free(ptrLife);
        if (ptrSize) emModule._free(ptrSize);
        if (ptrColor) emModule._free(ptrColor);
        if (ptrSeed) emModule._free(ptrSeed);
        return false;
    }

    const heap = new Float32Array(emscriptenMemory.buffer);
    const posOff = ptrPos >> 2;
    const velOff = ptrVel >> 2;
    const lifeOff = ptrLife >> 2;
    const sizeOff = ptrSize >> 2;
    const colorOff = ptrColor >> 2;
    const seedOff = ptrSeed >> 2;

    heap.set(buffers.positions, posOff);
    heap.set(buffers.velocities, velOff);
    heap.set(buffers.lives, lifeOff);
    heap.set(buffers.sizes, sizeOff);
    heap.set(buffers.colors, colorOff);
    heap.set(buffers.seeds, seedOff);

    try {
        fn(
            ptrPos,
            ptrVel,
            ptrLife,
            ptrSize,
            ptrColor,
            ptrSeed,
            count,
            CPU_PARTICLE_TYPE_ID[params.type],
            params.deltaTime,
            params.centerX,
            params.centerY,
            params.centerZ,
            params.boundsX,
            params.boundsY,
            params.boundsZ,
            params.sizeMin,
            params.sizeMax,
            params.playerX,
            params.playerY,
            params.playerZ,
            params.audioLow,
            params.audioHigh,
            params.windX,
            params.windZ,
            params.timeOffsetFirefly,
            params.timeOffsetPollen,
            params.timeSec
        );

        buffers.positions.set(heap.subarray(posOff, posOff + count * 3));
        buffers.velocities.set(heap.subarray(velOff, velOff + count * 3));
        buffers.lives.set(heap.subarray(lifeOff, lifeOff + count));
        buffers.sizes.set(heap.subarray(sizeOff, sizeOff + count));
        buffers.colors.set(heap.subarray(colorOff, colorOff + count * 4));
        buffers.seeds.set(heap.subarray(seedOff, seedOff + count));
        return true;
    } finally {
        emModule._free(ptrPos);
        emModule._free(ptrVel);
        emModule._free(ptrLife);
        emModule._free(ptrSize);
        emModule._free(ptrColor);
        emModule._free(ptrSeed);
    }
}

export function isCpuParticlesNativeAvailable(): boolean {
    return isEmscriptenReady() && getUpdateCpuParticlesFn() !== null;
}

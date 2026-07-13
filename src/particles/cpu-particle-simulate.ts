/**
 * @file cpu-particle-simulate.ts
 * @description Pure simulation kernel for CPU particle systems.
 * Shared by the TS fallback and the Emscripten native batch path.
 */

import type { ComputeParticleType } from './compute-particles-types.ts';

/** World bounds — keep in sync with assembly/constants.ts and tests/wasm.mjs */
export const PARTICLE_WORLD_BOUNDS = {
    minX: -128.0,
    maxX: 128.0,
    minY: -100.0,
    maxY: 500.0,
    minZ: -128.0,
    maxZ: 128.0,
} as const;

/** Numeric ids passed to the C++ batch update */
export const CPU_PARTICLE_TYPE_ID: Record<ComputeParticleType, number> = {
    fireflies: 0,
    pollen: 1,
    berries: 2,
    rain: 3,
    sparks: 4,
    gem_sparks: 5,
};

export interface CpuParticleBuffers {
    positions: Float32Array;
    velocities: Float32Array;
    lives: Float32Array;
    sizes: Float32Array;
    colors: Float32Array;
    seeds: Float32Array;
}

export interface CpuParticleSimParams {
    type: ComputeParticleType;
    count: number;
    deltaTime: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    boundsX: number;
    boundsY: number;
    boundsZ: number;
    sizeMin: number;
    sizeMax: number;
    playerX: number;
    playerY: number;
    playerZ: number;
    audioLow: number;
    audioHigh: number;
    windX: number;
    windZ: number;
    timeOffsetFirefly: number;
    timeOffsetPollen: number;
    timeSec: number;
}

function wrapAxis(pos: number, center: number, extent: number): number {
    const half = extent * 0.5;
    let rel = pos - center;
    if (rel > half) rel -= extent;
    else if (rel < -half) rel += extent;
    return center + rel;
}

function isOutOfWorldBounds(px: number, py: number, pz: number): boolean {
    const b = PARTICLE_WORLD_BOUNDS;
    return px < b.minX || px > b.maxX ||
        py < b.minY || py > b.maxY ||
        pz < b.minZ || pz > b.maxZ;
}

function setParticleColor(
    type: ComputeParticleType,
    colors: Float32Array,
    seeds: Float32Array,
    i: number
): void {
    const idx = i * 4;
    switch (type) {
        case 'fireflies':
            colors[idx] = 0.88;
            colors[idx + 1] = 1.0;
            colors[idx + 2] = 0.0;
            colors[idx + 3] = 1.0;
            break;
        case 'pollen':
            colors[idx] = 0.0;
            colors[idx + 1] = 1.0;
            colors[idx + 2] = 1.0;
            colors[idx + 3] = 0.8;
            break;
        case 'berries':
            colors[idx] = 1.0;
            colors[idx + 1] = 0.4;
            colors[idx + 2] = 0.0;
            colors[idx + 3] = 1.0;
            break;
        case 'rain':
            colors[idx] = 0.6;
            colors[idx + 1] = 0.8;
            colors[idx + 2] = 1.0;
            colors[idx + 3] = 0.5;
            break;
        case 'sparks':
            colors[idx] = 1.0;
            colors[idx + 1] = 1.0;
            colors[idx + 2] = 0.5;
            colors[idx + 3] = 1.0;
            break;
        case 'gem_sparks': {
            const huePick = Math.sin(seeds[i] * 12.9898) * 0.5 + 0.5;
            const ruby = [0.88, 0.07, 0.37];
            const sapphire = [0.06, 0.32, 0.73];
            const amethyst = [0.60, 0.40, 0.80];
            colors[idx] = ruby[0] * (1 - huePick) + sapphire[0] * huePick;
            colors[idx + 1] = ruby[1] * (1 - huePick) + amethyst[1] * huePick * huePick;
            colors[idx + 2] = ruby[2] * (1 - huePick) + amethyst[2] * huePick;
            colors[idx + 3] = 0.85;
            break;
        }
    }
}

export function respawnCpuParticle(
    buffers: CpuParticleBuffers,
    params: Pick<CpuParticleSimParams, 'type' | 'centerX' | 'centerY' | 'centerZ' | 'boundsX' | 'boundsY' | 'boundsZ' | 'sizeMin' | 'sizeMax'>,
    i: number,
    initial = false
): void {
    const { positions, velocities, lives, sizes, seeds, colors } = buffers;
    const idx = i * 3;

    positions[idx] = (Math.random() - 0.5) * params.boundsX + params.centerX;
    positions[idx + 1] = initial
        ? Math.random() * params.boundsY + params.centerY
        : params.centerY + params.boundsY;
    positions[idx + 2] = (Math.random() - 0.5) * params.boundsZ + params.centerZ;

    switch (params.type) {
        case 'fireflies':
            velocities[idx] = (Math.random() - 0.5) * 2;
            velocities[idx + 1] = (Math.random() - 0.5) * 0.5;
            velocities[idx + 2] = (Math.random() - 0.5) * 2;
            lives[i] = 2 + Math.random() * 4;
            break;
        case 'pollen':
            velocities[idx] = (Math.random() - 0.5) * 0.5;
            velocities[idx + 1] = (Math.random() - 0.5) * 0.2;
            velocities[idx + 2] = (Math.random() - 0.5) * 0.5;
            lives[i] = 2 + Math.random() * 4;
            break;
        case 'berries':
            velocities[idx] = (Math.random() - 0.5) * 3;
            velocities[idx + 1] = Math.random() * 2;
            velocities[idx + 2] = (Math.random() - 0.5) * 3;
            lives[i] = 3 + Math.random() * 5;
            break;
        case 'rain':
            velocities[idx] = (Math.random() - 0.5) * 0.5;
            velocities[idx + 1] = -5 - Math.random() * 3;
            velocities[idx + 2] = (Math.random() - 0.5) * 0.5;
            lives[i] = 5;
            break;
        case 'sparks': {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 5;
            velocities[idx] = Math.cos(angle) * speed;
            velocities[idx + 1] = Math.random() * speed;
            velocities[idx + 2] = Math.sin(angle) * speed;
            lives[i] = 0.3 + Math.random() * 0.5;
            break;
        }
        case 'gem_sparks':
            velocities[idx] = (Math.random() - 0.5) * 0.12;
            velocities[idx + 1] = (Math.random() - 0.5) * 0.06;
            velocities[idx + 2] = (Math.random() - 0.5) * 0.12;
            lives[i] = 10 + Math.random() * 14;
            break;
    }

    sizes[i] = params.sizeMin + Math.random() * (params.sizeMax - params.sizeMin);
    seeds[i] = Math.random() * 1000;
    setParticleColor(params.type, colors, seeds, i);
}

function updateFirefly(
    buffers: CpuParticleBuffers,
    params: CpuParticleSimParams,
    i: number
): void {
    const { positions, velocities, seeds } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;

    const noiseX = Math.sin(positions[idx] * 0.1 + seeds[i]) * params.timeOffsetFirefly;
    const noiseY = Math.sin(positions[idx + 1] * 0.1 + seeds[i] + 10) * params.timeOffsetFirefly;
    const noiseZ = Math.sin(positions[idx + 2] * 0.1 + seeds[i] + 20) * params.timeOffsetFirefly;

    const springX = (params.centerX - positions[idx]) * 0.5;
    const springZ = (params.centerZ - positions[idx + 2]) * 0.5;

    const toPlayerX = positions[idx] - params.playerX;
    const toPlayerY = positions[idx + 1] - params.playerY;
    const toPlayerZ = positions[idx + 2] - params.playerZ;
    const distToPlayerSq = toPlayerX * toPlayerX + toPlayerY * toPlayerY + toPlayerZ * toPlayerZ;

    let repelX = 0;
    let repelY = 0;
    let repelZ = 0;
    if (distToPlayerSq < 25.0 && distToPlayerSq > 0.0001) {
        const distToPlayerSqInv = 1.0 / distToPlayerSq;
        const repelStrength = (25.0 - distToPlayerSq) * 2.0;
        repelX = toPlayerX * distToPlayerSqInv * repelStrength;
        repelY = toPlayerY * distToPlayerSqInv * repelStrength;
        repelZ = toPlayerZ * distToPlayerSqInv * repelStrength;
    }

    velocities[idx] += (noiseX * 2 + springX + repelX + params.audioLow * 5) * dt;
    velocities[idx + 1] += (noiseY * 2 + repelY) * dt;
    velocities[idx + 2] += (noiseZ * 2 + springZ + repelZ) * dt;

    velocities[idx] *= 0.95;
    velocities[idx + 1] *= 0.95;
    velocities[idx + 2] *= 0.95;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    if (positions[idx + 1] < 0.5) {
        positions[idx + 1] = 0.5;
        velocities[idx + 1] = Math.abs(velocities[idx + 1]) * 0.3;
    }
}

function updatePollen(
    buffers: CpuParticleBuffers,
    params: CpuParticleSimParams,
    i: number
): void {
    const { positions, velocities } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;

    velocities[idx] += params.windX * 0.05 * dt;
    velocities[idx + 2] += params.windZ * 0.05 * dt;

    const noiseScale = 0.2;
    const noiseX = Math.sin(positions[idx] * noiseScale + params.timeOffsetPollen);
    const noiseY = Math.sin(positions[idx + 1] * noiseScale + params.timeOffsetPollen + 10);
    const noiseZ = Math.sin(positions[idx + 2] * noiseScale + params.timeOffsetPollen + 20);

    const toPlayerX = positions[idx] - params.playerX;
    const toPlayerZ = positions[idx + 2] - params.playerZ;
    const distToPlayerSq = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ;

    let repelX = 0;
    let repelZ = 0;
    if (distToPlayerSq < 25.0 && distToPlayerSq > 0.0001) {
        const distToPlayerSqInv = 1.0 / distToPlayerSq;
        const repelFactor = (25.0 - distToPlayerSq) * 0.4;
        repelX = toPlayerX * distToPlayerSqInv * repelFactor;
        repelZ = toPlayerZ * distToPlayerSqInv * repelFactor;
    }

    const toCenterX = params.centerX - positions[idx];
    const toCenterZ = params.centerZ - positions[idx + 2];
    const distToCenterSq = toCenterX * toCenterX + toCenterZ * toCenterZ;

    let pullX = 0;
    let pullZ = 0;
    if (distToCenterSq > 225.0 && distToCenterSq > 0.0001) {
        const distToCenterSqInv = 1.0 / distToCenterSq;
        const pullStrength = (distToCenterSq - 225.0) * 0.003;
        pullX = toCenterX * distToCenterSqInv * pullStrength;
        pullZ = toCenterZ * distToCenterSqInv * pullStrength;
    }

    velocities[idx] += (noiseX * 0.5 + params.audioLow * 2 + repelX + pullX) * dt;
    velocities[idx + 1] += noiseY * 0.5 * dt;
    velocities[idx + 2] += (noiseZ * 0.5 + params.audioLow * 2 + repelZ + pullZ) * dt;

    velocities[idx] *= 0.98;
    velocities[idx + 1] *= 0.98;
    velocities[idx + 2] *= 0.98;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    if (positions[idx + 1] < 1.8) {
        positions[idx + 1] = 1.8;
        velocities[idx + 1] = Math.abs(velocities[idx + 1]) * 0.3;
    }
}

function updateBerry(buffers: CpuParticleBuffers, params: CpuParticleSimParams, i: number): void {
    const { positions, velocities } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;

    velocities[idx + 1] -= 9.8 * dt;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    if (positions[idx + 1] < 0.3) {
        positions[idx + 1] = 0.3;
        velocities[idx + 1] = Math.abs(velocities[idx + 1]) * 0.5;
        velocities[idx] *= 0.8;
        velocities[idx + 2] *= 0.8;
    }
}

function updateRain(buffers: CpuParticleBuffers, params: CpuParticleSimParams, i: number): void {
    const { positions, velocities, lives } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;

    velocities[idx] = params.windX * 0.1;
    velocities[idx + 2] = params.windZ * 0.1;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    if (positions[idx + 1] < 0.5) {
        lives[i] = 0;
    }
}

function updateSpark(buffers: CpuParticleBuffers, params: CpuParticleSimParams, i: number): void {
    const { positions, velocities } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;

    velocities[idx + 1] -= 4.9 * dt;

    velocities[idx] *= 0.99;
    velocities[idx + 1] *= 0.99;
    velocities[idx + 2] *= 0.99;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;
}

function updateGemSpark(buffers: CpuParticleBuffers, params: CpuParticleSimParams, i: number): void {
    const { positions, velocities, seeds } = buffers;
    const idx = i * 3;
    const dt = params.deltaTime;
    const seed = seeds[i];
    const timeSec = params.timeSec;

    const noiseX = Math.sin(positions[idx] * 0.12 + timeSec * 0.11 + seed) * 0.35;
    const noiseY = Math.sin(positions[idx + 1] * 0.12 + timeSec * 0.07 + seed * 1.3) * 0.2;
    const noiseZ = Math.sin(positions[idx + 2] * 0.12 + timeSec * 0.09 + seed * 0.7) * 0.35;
    const bobY = Math.sin(timeSec * 0.85 + seed) * 0.14;
    const audioLift = params.audioHigh * 0.25;

    velocities[idx] += noiseX * 0.55 * dt;
    velocities[idx + 1] += (noiseY * 0.08 + bobY * 0.08 + audioLift) * dt;
    velocities[idx + 2] += noiseZ * 0.55 * dt;

    velocities[idx] *= 0.92;
    velocities[idx + 1] *= 0.92;
    velocities[idx + 2] *= 0.92;

    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    positions[idx] = wrapAxis(positions[idx], params.centerX, params.boundsX);
    positions[idx + 1] = wrapAxis(positions[idx + 1], params.centerY, params.boundsY);
    positions[idx + 2] = wrapAxis(positions[idx + 2], params.centerZ, params.boundsZ);
}

function updateParticleByType(
    buffers: CpuParticleBuffers,
    params: CpuParticleSimParams,
    i: number
): void {
    switch (params.type) {
        case 'fireflies':
            updateFirefly(buffers, params, i);
            break;
        case 'pollen':
            updatePollen(buffers, params, i);
            break;
        case 'berries':
            updateBerry(buffers, params, i);
            break;
        case 'rain':
            updateRain(buffers, params, i);
            break;
        case 'sparks':
            updateSpark(buffers, params, i);
            break;
        case 'gem_sparks':
            updateGemSpark(buffers, params, i);
            break;
    }
}

/**
 * Simulate one frame of CPU particle physics (pos/vel/life/size/color + bounds recycle).
 * Quad vertex expansion is intentionally left to the caller.
 */
export function simulateCpuParticles(
    buffers: CpuParticleBuffers,
    params: CpuParticleSimParams
): void {
    const { lives } = buffers;
    const respawnParams = params;

    for (let i = 0; i < params.count; i++) {
        lives[i] -= params.deltaTime;

        if (lives[i] <= 0) {
            respawnCpuParticle(buffers, respawnParams, i);
        } else {
            updateParticleByType(buffers, params, i);

            const idx = i * 3;
            const { positions } = buffers;
            if (isOutOfWorldBounds(positions[idx], positions[idx + 1], positions[idx + 2])) {
                respawnCpuParticle(buffers, respawnParams, i);
            }
        }
    }
}

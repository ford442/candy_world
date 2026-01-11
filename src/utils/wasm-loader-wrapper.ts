import * as wasm from './wasm-loader.js';

export type SpawnCandidate = { x: number; y: number; z: number; colorIndex: number };

export const AnimationType = wasm.AnimationType as {
  readonly BOUNCE: number;
  readonly SWAY: number;
  readonly WOBBLE: number;
  readonly HOP: number;
};

export async function initWasm(): Promise<boolean> { return wasm.initWasm(); }
export function isWasmReady(): boolean { return wasm.isWasmReady(); }
export function isEmscriptenReady(): boolean { return wasm.isEmscriptenReady(); }

export function getGroundHeight(x: number, z: number): number { return wasm.getGroundHeight(x, z); }
export function freqToHue(freq: number): number { return wasm.freqToHue(freq); }
export function lerp(a: number, b: number, t: number): number { return wasm.lerp(a, b, t); }
export function lerpColor(color1: number, color2: number, t: number): number { return wasm.lerpColor(color1, color2, t); }

export function uploadPositions(objects: Array<{ x: number; y?: number; z: number; radius?: number }>): void {
  return wasm.uploadPositions(objects);
}
export function copySharedPositions(sharedView: Float32Array, objectCount: number): void {
  return wasm.copySharedPositions(sharedView, objectCount);
}
export function uploadAnimationData(animData: Array<{ offset: number; type: number; originalY: number; colorIndex?: number }>): void {
  return wasm.uploadAnimationData(animData);
}

export function batchDistanceCull(cameraX: number, cameraY: number, cameraZ: number, maxDistance: number, objectCount: number): { visibleCount: number; flags: Float32Array | null } {
  return wasm.batchDistanceCull(cameraX, cameraY, cameraZ, maxDistance, objectCount);
}

export function batchMushroomSpawnCandidates(time: number, windX: number, windZ: number, windSpeed: number, objectCount: number, spawnThreshold: number, minDistance: number, maxDistance: number): number {
  return wasm.batchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance);
}

export function readSpawnCandidates(candidateCount: number): SpawnCandidate[] { return wasm.readSpawnCandidates(candidateCount); }

export function batchAnimationCalc(time: number, intensity: number, kick: number, objectCount: number): Float32Array | null { return wasm.batchAnimationCalc(time, intensity, kick, objectCount); }

export function calcBounceY(time: number, offset: number, intensity: number, kick: number): number { return wasm.calcBounceY(time, offset, intensity, kick); }
export function calcSwayRotZ(time: number, offset: number, intensity: number): number { return wasm.calcSwayRotZ(time, offset, intensity); }
export function calcWobble(time: number, offset: number, intensity: number): { rotX: number; rotZ: number } { return wasm.calcWobble(time, offset, intensity); }

export function checkCollision(playerX: number, playerZ: number, playerRadius: number, objectCount: number): boolean { return wasm.checkCollision(playerX, playerZ, playerRadius, objectCount); }


export function calcAccordionStretch(time: number, offset: number, intensity: number) { return wasm.calcAccordionStretch(time, offset, intensity); }
export function calcFiberWhip(time: number, offset: number, leadVol: number, isActive: boolean, branchIndex: number) { return wasm.calcFiberWhip(time, offset, leadVol, isActive, branchIndex); }
export function calcHopY(time: number, offset: number, intensity: number, kick: number): number { return wasm.calcHopY(time, offset, intensity, kick); }
export function calcShiver(time: number, offset: number, intensity: number) { return wasm.calcShiver(time, offset, intensity); }
export function calcSpiralWave(time: number, offset: number, intensity: number, groove: number) { return wasm.calcSpiralWave(time, offset, intensity, groove); }
export function calcPrismRose(time: number, offset: number, kick: number, groove: number, isActive: boolean) { return wasm.calcPrismRose(time, offset, kick, groove, isActive); }

export function lerpColorExport(color1: number, color2: number, t: number): number { return wasm.lerpColor(color1, color2, t); }
export function calcRainDropY(startY: number, time: number, speed: number, cycleHeight: number): number { return wasm.calcRainDropY(startY, time, speed, cycleHeight); }
export function calcFloatingParticle(baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number) { return wasm.calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude); }

export function valueNoise2D(x: number, y: number): number { return wasm.valueNoise2D(x, y); }
export function fbm(x: number, y: number, octaves = 4): number { return wasm.fbm(x, y, octaves); }
export function fastInvSqrt(x: number): number { return wasm.fastInvSqrt(x); }
export function fastDistance(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number { return wasm.fastDistance(x1, y1, z1, x2, y2, z2); }
export function hash(x: number, y: number): number { return wasm.hash(x, y); }

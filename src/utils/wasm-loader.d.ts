export type SpawnCandidate = { x: number; y: number; z: number; colorIndex: number };

export const AnimationType: {
  readonly BOUNCE: number;
  readonly SWAY: number;
  readonly WOBBLE: number;
  readonly HOP: number;
};

export function initWasm(): Promise<boolean>;
export function isWasmReady(): boolean;
export function isEmscriptenReady(): boolean;

export function getGroundHeight(x: number, z: number): number;
export function freqToHue(freq: number): number;
export function lerp(a: number, b: number, t: number): number;
export function lerpColor(color1: number, color2: number, t: number): number;

export function uploadPositions(objects: Array<{ x: number; y?: number; z: number; radius?: number }>): void;
export function copySharedPositions(sharedView: Float32Array, objectCount: number): void;
export function uploadAnimationData(animData: Array<{ offset: number; type: number; originalY: number; colorIndex?: number }>): void;

export function batchDistanceCull(
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  maxDistance: number,
  objectCount: number
): { visibleCount: number; flags: Float32Array | null };

export function batchMushroomSpawnCandidates(
  time: number,
  windX: number,
  windZ: number,
  windSpeed: number,
  objectCount: number,
  spawnThreshold: number,
  minDistance: number,
  maxDistance: number
): number;

export function readSpawnCandidates(candidateCount: number): SpawnCandidate[];

export function batchAnimationCalc(time: number, intensity: number, kick: number, objectCount: number): Float32Array | null;

export function calcBounceY(time: number, offset: number, intensity: number, kick: number): number;
export function calcSwayRotZ(time: number, offset: number, intensity: number): number;
export function calcWobble(time: number, offset: number, intensity: number): { rotX: number; rotZ: number };

export function checkCollision(playerX: number, playerZ: number, playerRadius: number, objectCount: number): boolean;

export function calcSpeakerPulse(time: number, offset: number, kick: number): { yOffset: number; scaleX: number; scaleY: number; scaleZ: number };
export function calcAccordionStretch(time: number, offset: number, intensity: number): { stretchY: number; widthXZ: number };
export function calcFiberWhip(time: number, offset: number, leadVol: number, isActive: boolean, branchIndex: number): { baseRotY: number; branchRotZ: number };
export function calcHopY(time: number, offset: number, intensity: number, kick: number): number;
export function calcShiver(time: number, offset: number, intensity: number): { rotX: number; rotZ: number };
export function calcSpiralWave(time: number, offset: number, intensity: number, groove: number): { rotY: number; yOffset: number; scale: number };
export function calcPrismRose(time: number, offset: number, kick: number, groove: number, isActive: boolean): { unfurl: number; spin: number; pulse: number; hue: number };

export function lerpColor(color1: number, color2: number, t: number): number;
export function calcRainDropY(startY: number, time: number, speed: number, cycleHeight: number): number;
export function calcFloatingParticle(baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number): { x: number; y: number; z: number };

export function valueNoise2D(x: number, y: number): number;
export function fbm(x: number, y: number, octaves?: number): number;
export function fastInvSqrt(x: number): number;
export function fastDistance(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number;
export function hash(x: number, y: number): number;

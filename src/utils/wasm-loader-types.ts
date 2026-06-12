import * as THREE from 'three';
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * WASI stub functions
 */
export interface WasiStubs {
    fd_close: () => number;
    fd_seek: () => number;
    fd_write: () => number;
    fd_read: () => number;
    fd_fdstat_get: () => number;
    fd_prestat_get: () => number;
    fd_prestat_dir_name: () => number;
    path_open: () => number;
    environ_sizes_get: () => number;
    environ_get: () => number;
    proc_exit: () => void;
    clock_time_get: (id: number, precision: bigint, outPtr: number | bigint) => number;
}

/**
 * WASM import object
 */
export interface WasmImportObject {
    env: {
        abort: (msg: number, file: number, line: number, col: number) => void;
        seed: () => number;
        now: () => number;
    };
    wasi_snapshot_preview1: WasiStubs;
}

/**
 * Emscripten module interface
 */
export interface EmscriptenModule {
    wasmMemory?: WebAssembly.Memory;
    HEAP8?: Int8Array;
    HEAPU8?: Uint8Array;
    HEAP32?: Int32Array;
    HEAPF32?: Float32Array;
    _malloc?: (size: number) => number;
    _free?: (ptr: number) => void;
    [key: string]: unknown;
}

/**
 * Extended Emscripten module with potential exports
 */
export interface ExtendedEmscriptenModule extends EmscriptenModule {
    // Physics functions
    _updatePhysicsCPP?: (...args: number[]) => number;
    _initPhysics?: (...args: number[]) => void;
    _addObstaclesBatch?: (count: number) => void;
    _initObstacleBuffer?: (maxCount: number) => number;
    _setPlayerState?: (...args: number[]) => void;
    _getPlayerX?: () => number;
    _getPlayerY?: () => number;
    _getPlayerZ?: () => number;
    _getPlayerVX?: () => number;
    _getPlayerVY?: () => number;
    _getPlayerVZ?: () => number;
    _valueNoise2D?: (x: number, y: number) => number;
    _fbm?: (x: number, y: number, octaves: number) => number;
    _fastInvSqrt?: (x: number) => number;
    _fastDistance?: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => number;
    _hash?: (x: number, y: number) => number;
    // Batch functions
    _batchShiver_c?: (...args: number[]) => void;
    _batchSpring_c?: (...args: number[]) => void;
    _batchFloat_c?: (...args: number[]) => void;
    _batchCloudBob_c?: (...args: number[]) => void;
    _deformWave_c?: (...args: number[]) => void;
    _deformJiggle_c?: (...args: number[]) => void;
    _deformWobble_c?: (...args: number[]) => void;
    _batchUpdateLODMatrices_c?: (...args: number[]) => void;
    _batchScaleMatrices_c?: (...args: number[]) => void;
    _batchFadeColors_c?: (...args: number[]) => void;
    _batchFrustumCull_c?: (...args: number[]) => void;
    _batchDistanceCullIndexed_c?: (...args: number[]) => void;
    // Fluid functions
    _fluidInit?: (size: number) => void;
    _fluidStep?: (dt: number, visc: number, diff: number) => void;
    _fluidAddDensity?: (x: number, y: number, amount: number) => void;
    _fluidAddVelocity?: (x: number, y: number, amountX: number, amountY: number) => void;
    _fluidGetDensityPtr?: () => number;
    _updateParticlesWASM?: (...args: number[]) => void;
    // Speaker and animation
    _calcSpeakerPulse?: (...args: number[]) => void;
    _getSpeakerScale?: () => number;
    // Arpeggio
    _calcArpeggioStep_c?: (...args: number[]) => void;
    _getArpeggioTargetStep_c?: () => number;
    _getArpeggioUnfurlStep_c?: () => number;
}

/**
 * Three.js Object3D-like interface for position
 */
export interface Positionable {
    position: {
        x: number;
        y: number;
        z: number;
    };
}

/**
 * Mushroom object with userData
 */
export interface Mushroom extends Positionable {
    userData: {
        radius?: number;
        capRadius?: number;
        capHeight?: number;
        isTrampoline?: boolean;
        colorIndex?: number;
    };
}

/**
 * Cave object with userData
 */
export interface Matrix4Like {
    elements: number[];
    clone: () => { elements: number[] };
}

export interface Vector3Like {
    x: number;
    y: number;
    z: number;
    clone: () => Vector3Like;
    applyMatrix4: (matrix: Matrix4Like) => Vector3Like;
}

export interface Cave extends Positionable {
    matrixWorld: Matrix4Like;
    userData: {
        isBlocked?: boolean;
        gatePosition: Vector3Like;
    };
}

/**
 * Cloud object with userData
 */
export interface Cloud extends Positionable {
    scale: {
        x: number;
        y: number;
        z: number;
    };
    userData: {
        tier?: number;
    };
}

/**
 * Trampoline object
 */
export interface Trampoline extends Positionable {
    userData: {
        capRadius?: number;
        capHeight?: number;
    };
}

/**
 * Material with shader info
 */
export interface MaterialInfo {
    vertexShaderId?: number;
    fragmentShaderId?: number;
    blendingMode?: number;
    flags?: number;
}

/**
 * Animation data entry
 */
export interface AnimationData {
    offset?: number;
    type?: number;
    originalY?: number;
    colorIndex?: number;
}

/**
 * Position data entry
 */
export interface PositionData {
    x?: number;
    y?: number;
    z?: number;
    radius?: number;
}

/**
 * Player state interface
 */
export interface PlayerState {
    position: {
        x: number;
        y: number;
        z: number;
    };
    velocity: {
        x: number;
        y: number;
        z: number;
    };
    isGrounded: boolean;
}

/**
 * Generic WASM export value type
 */
export type WasmExportValue = WebAssembly.ExportValue | ((...args: number[]) => number) | ((...args: number[]) => void);

/**
 * WASM exports interface
 */
export interface WasmExports {
    [key: string]: WasmExportValue | undefined;
    memory: WebAssembly.Memory;
    getGroundHeight: (x: number, z: number) => number;
    freqToHue: (freq: number) => number;
    lerp: (a: number, b: number, t: number) => number;
    batchMushroomSpawnCandidates?: (time: number, windX: number, windZ: number, windSpeed: number, objectCount: number, spawnThreshold: number, minDistance: number, maxDistance: number) => number;
    updateFoliageBatch?: (...args: number[]) => void;
    initDynamicFoliageMemory?: (maxInstances: number) => number;
    initCollisionSystem?: () => void;
    addCollisionObject?: (type: number, x: number, y: number, z: number, r: number, h: number, p1: number, p2: number, p3: number) => void;
    resolveGameCollisions?: (kickTrigger: number) => number;
    checkPositionValidity?: (x: number, z: number, radius: number) => number;
    addCollisionObjectsBatch?: (ptr: number, count: number) => void;
    malloc?: (size: number) => number;
    __new?: (size: number) => number;
    free?: (ptr: number) => void;
    __free?: (ptr: number) => void;
    batchDistanceCull?: (cameraX: number, cameraY: number, cameraZ: number, maxDistSq: number, objectCount: number) => number;
    // Hot-path Physics exports (from assembly/physics.ts)
    batchGroundHeight?: (positionsPtr: number, count: number, outputPtr: number) => void;
    dampVelocity?: (velocityPtr: number, count: number, damping: number) => void;
    batchDistanceCalc?: (positionsPtr: number, count: number, camX: number, camY: number, camZ: number, outputPtr: number) => void;
    batchFrustumTest?: (positionsPtr: number, count: number, frustumPlanesPtr: number, outputPtr: number) => number;
    batchLODSelect?: (distancesPtr: number, count: number, lodThresholdsPtr: number, outputPtr: number) => number;
    analyzeMaterials?: (offset: number, count: number) => number;
    getUniqueShaderCount?: () => number;
    batchAnimationCalc?: (time: number, intensity: number, kick: number, objectCount: number) => void;
    // Animation functions
    calcBounceY?: (time: number, offset: number, intensity: number, kick: number) => number;
    calcSwayRotZ?: (time: number, offset: number, intensity: number) => number;
    calcWobble?: (time: number, offset: number, intensity: number) => void;
    getWobbleX?: () => number;
    getWobbleZ?: () => number;
    checkCollision?: (playerX: number, playerZ: number, playerRadius: number, objectCount: number) => number;
    // Advanced animations
    calcAccordionStretch?: (animTime: number, offset: number, intensity: number) => void;
    getAccordionStretchY?: () => number;
    getAccordionWidthXZ?: () => number;
    calcFiberWhip?: (time: number, offset: number, leadVol: number, isActive: number, branchIndex: number) => void;
    getFiberBaseRotY?: () => number;
    getFiberBranchRotZ?: () => number;
    calcHopY?: (time: number, offset: number, intensity: number, kick: number) => number;
    calcShiver?: (time: number, offset: number, intensity: number) => void;
    getShiverRotX?: () => number;
    getShiverRotZ?: () => number;
    calcSpiralWave?: (time: number, offset: number, intensity: number, groove: number) => void;
    getSpiralRotY?: () => number;
    getSpiralYOffset?: () => number;
    getSpiralScale?: () => number;
    calcPrismRose?: (time: number, offset: number, kick: number, groove: number, isActive: number) => void;
    getPrismUnfurl?: () => number;
    getPrismSpin?: () => number;
    getPrismPulse?: () => number;
    getPrismHue?: () => number;
    calcArpeggioStep?: (currentUnfurl: number, currentTarget: number, lastTrigger: number, arpeggioActive: number, noteTrigger: number, maxSteps: number) => void;
    getArpeggioTargetStep?: () => number;
    getArpeggioUnfurlStep?: () => number;
    lerpColor?: (color1: number, color2: number, t: number) => number;
    calcRainDropY?: (startY: number, time: number, speed: number, cycleHeight: number) => number;
    calcFloatingParticle?: (baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number) => void;
    getParticleX?: () => number;
    getParticleY?: () => number;
    getParticleZ?: () => number;
    // New math functions from assembly/math.ts
    hslToRgb?: (h: number, s: number, l: number) => number;
    hash2D?: (x: number, y: number) => number;
    valueNoise2D?: (x: number, y: number) => number;
    fbm2D?: (x: number, y: number, octaves: number) => number;
    distSq2D?: (ax: number, ay: number, bx: number, by: number) => number;
    distSq3D?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number;
    smoothstep?: (t: number) => number;
    inverseLerp?: (a: number, b: number, value: number) => number;
    // New batch functions from assembly/batch.ts
    batchHslToRgb?: (ptr: number, count: number) => void;
    batchSphereCull?: (positionsPtr: number, count: number, camX: number, camY: number, camZ: number, maxDist: number, outputPtr: number) => void;
    batchLerp?: (ptr: number, count: number) => void;
    // New particle functions from assembly/particles.ts
    updateParticles?: (positionsPtr: number, count: number, dt: number, gravity: number) => void;
    spawnBurst?: (outputPtr: number, count: number, centerX: number, centerY: number, centerZ: number, speed: number, time: number) => void;
}

// Extend window for global functions
declare global {
    interface Window {
        setLoadingStatus?: (msg: string) => void;
        NativeWebAssembly?: typeof WebAssembly;
    }
}

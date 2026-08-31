import { log } from '../utils/log.ts';

export interface LoadingPhase {
    id: string;
    name: string;
    weight: number; // Relative time cost (0-1)
    description: string;
    isDeferred?: boolean; // Eligible for the skip button
    nonSkippable?: boolean; // Override: hide skip button even when isDeferred
    onStart?: () => void;
    onComplete?: () => void;
}

export interface LoadingProgress {
    phase: string;
    phaseIndex: number;
    totalPhases: number;
    percent: number; // 0-100 within phase
    overallPercent: number; // 0-100 overall
    taskDescription: string;
    estimatedTimeRemaining: number; // in seconds
}

export interface LoadingScreenOptions {
    debug?: boolean;
    showEstimatedTime?: boolean;
    allowSkipDeferred?: boolean;
    fadeOutDuration?: number;
    theme?: 'candy' | 'dark' | 'minimal';
}

// =============================================================================
// DEFAULT LOADING PHASES
// =============================================================================

// Weights are calibrated to observed wall-clock costs after Wave 1:
// - WASM runs in the background (not on the critical path) — small weight.
// - Audio worklet is deferred to after first frame — not on critical path.
// - Heightmap deform uses batchGroundHeight() — world-generation is cheap.
// - Shader compileAsync() + forceFullSceneWarmup() dominates the critical path on first
//   run (20–60 s on slow/mobile GPUs). It must hold the majority of the weight budget so
//   the bar visibly advances during warmup instead of sitting at ~56 % while worklet
//   polyfills and WASM modules resolve in parallel.
// - map-generation runs after "Enter World" and is its own bar segment.
export const DEFAULT_LOADING_PHASES: LoadingPhase[] = [
    {
        id: 'core-scene',
        name: 'Scene Setup',
        weight: 0.08,
        description: 'Initializing 3D renderer and scene...',
        onStart: () => log.debug('Loading', 'Starting Core Scene Setup'),
        onComplete: () => log.debug('Loading', 'Core Scene Setup complete'),
    },
    {
        id: 'audio-init',
        name: 'Audio System',
        weight: 0.03,
        description: 'Setting up audio context...',
        onStart: () => log.debug('Loading', 'Starting Audio System Init'),
        onComplete: () => log.debug('Loading', 'Audio System Init complete'),
    },
    {
        id: 'world-generation',
        name: 'World Build',
        weight: 0.12,
        description: 'Building sky, terrain and base world...',
        onStart: () => log.debug('Loading', 'Starting World Generation'),
        onComplete: () => log.debug('Loading', 'World Generation complete'),
    },
    {
        id: 'wasm-init',
        name: 'Physics Engine',
        weight: 0.07,
        description: 'Loading physics engine and native modules...',
        onStart: () => log.debug('Loading', 'Starting WASM Initialization'),
        onComplete: () => log.debug('Loading', 'WASM Initialization complete'),
    },
    {
        id: 'shader-warmup',
        name: 'Shader Warmup',
        weight: 0.55,
        description: 'Pre-compiling shaders for smooth gameplay...',
        onStart: () => log.debug('Loading', 'Starting Shader Warmup'),
        onComplete: () => log.debug('Loading', 'Shader Warmup complete'),
    },
    {
        id: 'map-generation',
        name: 'Map Generation',
        weight: 0.15,
        description: 'Placing entities, foliage and discoveries...',
        onStart: () => log.debug('Loading', 'Starting Map Generation'),
        onComplete: () => log.debug('Loading', 'Map Generation complete'),
    },
    {
        id: 'deferred-population',
        name: 'World Population',
        weight: 0, // 0 in normal mode; set to >0 in explore mode before registering
        description: 'Populating horizon...',
        isDeferred: true,
        onStart: () => log.debug('Loading', 'Starting deferred world population'),
        onComplete: () => log.debug('Loading', 'Deferred world population complete'),
    },
];

import { log } from '../utils/log.ts';

export interface LoadingPhase {
    id: string;
    name: string;
    weight: number; // Relative time cost (0-1)
    description: string;
    isDeferred?: boolean;    // Eligible for the skip button
    nonSkippable?: boolean;  // Override: hide skip button even when isDeferred
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
// - WASM runs in the background (not on the critical path) — removed from phases.
// - Heightmap deform uses batchGroundHeight() — world-generation is now cheap.
// - Shader compileAsync() + forceFullSceneWarmup() dominates the critical path on first run.
// - map-generation runs after "Enter World" and is its own bar segment.
export const DEFAULT_LOADING_PHASES: LoadingPhase[] = [
    {
        id: 'core-scene',
        name: 'Scene Setup',
        weight: 0.15,
        description: 'Initializing 3D renderer and scene...',
        onStart: () => log.debug('Loading', 'Starting Core Scene Setup'),
        onComplete: () => log.debug('Loading', 'Core Scene Setup complete')
    },
    {
        id: 'audio-init',
        name: 'Audio System',
        weight: 0.05,
        description: 'Starting audio worklet and effects...',
        onStart: () => log.debug('Loading', 'Starting Audio System Init'),
        onComplete: () => log.debug('Loading', 'Audio System Init complete')
    },
    {
        id: 'world-generation',
        name: 'World Build',
        weight: 0.20,
        description: 'Building sky, terrain and base world...',
        onStart: () => log.debug('Loading', 'Starting World Generation'),
        onComplete: () => log.debug('Loading', 'World Generation complete')
    },
    {
        id: 'wasm-init',
        name: 'Physics Engine',
        weight: 0.35,
        description: 'Loading physics engine and native modules...',
        onStart: () => log.debug('Loading', 'Starting WASM Initialization'),
        onComplete: () => log.debug('Loading', 'WASM Initialization complete')
    },
    {
        id: 'shader-warmup',
        name: 'Shader Warmup',
        weight: 0.30,
        description: 'Pre-compiling shaders for smooth gameplay...',
        onStart: () => log.debug('Loading', 'Starting Shader Warmup'),
        onComplete: () => log.debug('Loading', 'Shader Warmup complete')
    },
    {
        id: 'map-generation',
        name: 'Map Generation',
        weight: 0.30,
        description: 'Placing entities, foliage and discoveries...',
        onStart: () => log.debug('Loading', 'Starting Map Generation'),
        onComplete: () => log.debug('Loading', 'Map Generation complete')
    },
    {
        id: 'deferred-population',
        name: 'World Population',
        weight: 0,   // 0 in normal mode; set to >0 in waitForFull mode before registering
        description: 'Populating horizon...',
        isDeferred: true,
        onStart: () => log.debug('Loading', 'Starting deferred world population'),
        onComplete: () => log.debug('Loading', 'Deferred world population complete')
    }
];

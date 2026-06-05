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
        onStart: () => console.log('[Loading] Starting Core Scene Setup'),
        onComplete: () => console.log('[Loading] Core Scene Setup complete')
    },
    {
        id: 'audio-init',
        name: 'Audio System',
        weight: 0.05,
        description: 'Starting audio worklet and effects...',
        onStart: () => console.log('[Loading] Starting Audio System Init'),
        onComplete: () => console.log('[Loading] Audio System Init complete')
    },
    {
        id: 'world-generation',
        name: 'World Build',
        weight: 0.20,
        description: 'Building sky, terrain and base world...',
        onStart: () => console.log('[Loading] Starting World Generation'),
        onComplete: () => console.log('[Loading] World Generation complete')
    },
    {
        id: 'wasm-init',
        name: 'Physics Engine',
        weight: 0.35,
        description: 'Loading physics engine and native modules...',
        onStart: () => console.log('[Loading] Starting WASM Initialization'),
        onComplete: () => console.log('[Loading] WASM Initialization complete')
    },
    {
        id: 'shader-warmup',
        name: 'Shader Warmup',
        weight: 0.30,
        description: 'Pre-compiling shaders for smooth gameplay...',
        onStart: () => console.log('[Loading] Starting Shader Warmup'),
        onComplete: () => console.log('[Loading] Shader Warmup complete')
    },
    {
        id: 'map-generation',
        name: 'Map Generation',
        weight: 0.30,
        description: 'Placing entities, foliage and discoveries...',
        onStart: () => console.log('[Loading] Starting Map Generation'),
        onComplete: () => console.log('[Loading] Map Generation complete')
    },
    {
        id: 'deferred-population',
        name: 'World Population',
        weight: 0,   // 0 in normal mode; set to >0 in waitForFull mode before registering
        description: 'Populating horizon...',
        isDeferred: true,
        onStart: () => console.log('[Loading] Starting deferred world population'),
        onComplete: () => console.log('[Loading] Deferred world population complete')
    }
];

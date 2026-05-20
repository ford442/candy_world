// src/debug/stages.ts
// Debug staging system for isolating initialization failures

/**
 * Debug stage configuration
 * Set stages to false to disable them during initialization
 * Enable via URL parameter: ?debug=1
 */
export interface DebugStages {
  core: boolean;           // Core scene, renderer, camera, lights
  postProcessing: boolean; // Post-processing effects
  audio: boolean;          // Audio system and beat sync
  weather: boolean;        // Weather system
  worldCritical: boolean;  // Base world (sky, ground, moon)
  input: boolean;          // Input handling
  interaction: boolean;    // Interaction system
  musicReactivity: boolean;// Music reactivity
  gameLoop: boolean;       // Game loop initialization
  shaderWarmup: boolean;   // Shader compilation and warmup
  wasm: boolean;           // WASM Emscripten module
  worldGeneration: boolean;// Full world generation (trees, mushrooms, etc.)
  deferredVisuals: boolean;// Celestial bodies, aurora
  deferredWorld: boolean;  // Additional world content
}

/**
 * EMPTY SANDBOX CONFIGURATION
 * 
 * This configuration keeps core systems alive to test WebGPU stability,
 * while disabling heavy WASM/compute tasks that typically cause hangs.
 * 
 * Use this for debugging initialization by setting ?debug=1 and toggling
 * stages one at a time via the debug panel to identify the culprit.
 * 
 * Recommended progression:
 * 1. Keep this base config, verify "Enter World" button appears
 * 2. Turn on worldGeneration → check for memory/instancing issues
 * 3. Turn on shaderWarmup → check for WebGPU compile hangs
 * 4. Turn on postProcessing → check for render target mismatches
 * 5. Turn on wasm → check for Emscripten bridge conflicts
 */
export const DEBUG_STAGES: DebugStages = {
  core: true,             // ✓ KEEP: Scene, renderer, camera, lights
  postProcessing: false,  // ✗ DISABLE: Often causes WebGPU compilation hangs
  audio: true,            // ✓ KEEP: Prevents null audioSystem crashes
  weather: true,          // ✓ KEEP: Prevents null weatherSystem crashes
  worldCritical: true,    // ✓ KEEP: Sky, ground, moon (visual feedback)
  input: true,            // ✓ KEEP: Camera movement, demo triggers
  interaction: true,      // ✓ KEEP: Prevents gameLoop dependency crash
  musicReactivity: false, // ✗ DISABLE: Skips foliage loop ties
  gameLoop: true,         // ✓ KEEP: Animation loop must run
  shaderWarmup: false,    // ✗ DISABLE: Skips 8-second compile timeout
  wasm: false,            // ✗ DISABLE: Uses JS fallback mode
  worldGeneration: false, // ✗ DISABLE: Skips massive biome instancing
  deferredVisuals: false, // ✗ DISABLE: Aurora/celestial bodies
  deferredWorld: false,   // ✗ DISABLE: Additional mesh content
};

/**
 * Debug configuration
 */
export const DEBUG_CONFIG = {
  enabled: new URLSearchParams(window.location.search).has('debug'),
  stages: DEBUG_STAGES,
};

/**
 * Stage loading result
 */
export interface StageResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Stage status for UI updates
 */
export enum StageStatus {
  PENDING = 'pending',
  LOADING = 'loading',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Stage metadata
 */
export interface StageMetadata {
  name: string;
  status: StageStatus;
  duration?: number;
  error?: string;
}

// Stage status tracking
const stageStatuses = new Map<keyof DebugStages, StageMetadata>();

/**
 * Initialize stage tracking
 */
export function initStageTracking(): void {
  Object.keys(DEBUG_STAGES).forEach((stage) => {
    stageStatuses.set(stage as keyof DebugStages, {
      name: stage,
      status: StageStatus.PENDING,
    });
  });
}

/**
 * Get stage status
 */
export function getStageStatus(stage: keyof DebugStages): StageMetadata | undefined {
  return stageStatuses.get(stage);
}

/**
 * Get all stage statuses
 */
export function getAllStageStatuses(): Map<keyof DebugStages, StageMetadata> {
  return new Map(stageStatuses);
}

/**
 * Update stage status
 */
export function updateStageStatus(
  stage: keyof DebugStages,
  status: StageStatus,
  duration?: number,
  error?: string
): void {
  const metadata = stageStatuses.get(stage);
  if (metadata) {
    metadata.status = status;
    if (duration !== undefined) metadata.duration = duration;
    if (error !== undefined) metadata.error = error;
  }
}

/**
 * Stage loader - wraps initialization with timing and error handling
 */
export class StageLoader {
  /**
   * Load a stage with timing and error handling
   * @param name - Stage name (must match DebugStages key)
   * @param initFn - Async or sync initialization function
   * @returns Promise<StageResult>
   */
  static async loadStage(
    name: keyof DebugStages,
    initFn: () => Promise<void> | void
  ): Promise<StageResult> {
    const startTime = performance.now();
    
    // Check if stage is enabled (only respect flags when debug mode is active)
    if (DEBUG_CONFIG.enabled && !DEBUG_STAGES[name]) {
      console.log(`%c[${name}] ⏭️  SKIPPED`, 'color: gray; font-weight: bold');
      updateStageStatus(name, StageStatus.SKIPPED, 0);
      return { success: true, duration: 0 };
    }

    // Update status to loading
    updateStageStatus(name, StageStatus.LOADING);

    try {
      // Execute initialization function
      await initFn();
      
      const duration = performance.now() - startTime;
      const durationStr = duration.toFixed(0);
      
      console.log(
        `%c[${name}] ✓ ${durationStr}ms`,
        'color: lightgreen; font-weight: bold'
      );
      
      updateStageStatus(name, StageStatus.SUCCESS, duration);
      
      return { success: true, duration };
    } catch (e) {
      const duration = performance.now() - startTime;
      const errorMsg = e instanceof Error ? e.message : String(e);
      
      console.error(
        `%c[${name}] ✗ FAILED`,
        'color: red; font-weight: bold',
        e
      );
      
      updateStageStatus(name, StageStatus.FAILED, duration, errorMsg);
      
      return { success: false, duration, error: errorMsg };
    }
  }

  /**
   * Load a stage synchronously (wraps in Promise)
   */
  static async loadStageSync(
    name: keyof DebugStages,
    initFn: () => void
  ): Promise<StageResult> {
    return this.loadStage(name, () => {
      initFn();
    });
  }

  /**
   * Toggle a stage at runtime
   * @param stage - Stage name
   * @param enabled - Enable/disable
   */
  static toggleStage(stage: keyof DebugStages, enabled: boolean): void {
    DEBUG_STAGES[stage] = enabled;
    console.log(`%c[DEBUG] ${stage} = ${enabled}`, 'color: yellow; font-weight: bold');
  }
}

/**
 * Show debug error in UI
 */
export function showDebugError(stage: string, error: unknown): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorDetails = error instanceof Error && error.stack ? error.stack : '';
  
  // Try to use the loading screen if available
  if (typeof window !== 'undefined') {
    const loadingScreenModule = (window as any).LOADING_PHASES;
    if (loadingScreenModule && loadingScreenModule.showFatalError) {
      loadingScreenModule.showFatalError(
        `${stage} initialization failed:\n${errorMsg}\n\n${errorDetails}`
      );
      return;
    }
  }
  
  // Fallback: Create a simple error overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.95);
    color: #ff4444;
    font-family: monospace;
    font-size: 14px;
    padding: 40px;
    z-index: 100000;
    overflow: auto;
    box-sizing: border-box;
  `;
  
  overlay.innerHTML = `
    <h1 style="color: #ff4444; margin-bottom: 20px;">❌ ${stage} Initialization Failed</h1>
    <pre style="color: #ffaaaa; white-space: pre-wrap; word-wrap: break-word;">${errorMsg}</pre>
    ${errorDetails ? `<pre style="color: #888; white-space: pre-wrap; word-wrap: break-word; margin-top: 20px;">${errorDetails}</pre>` : ''}
    <button 
      onclick="window.location.reload()" 
      style="margin-top: 30px; padding: 12px 24px; font-size: 16px; background: #ff4444; color: white; border: none; cursor: pointer; border-radius: 4px;"
    >
      Reload Page
    </button>
  `;
  
  document.body.appendChild(overlay);
}

// Initialize stage tracking on module load
initStageTracking();

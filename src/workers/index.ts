/**
 * Web Workers Index
 * 
 * Central export point for all worker-related functionality.
 * 
 * Usage:
 *   import { initWorkerPool, getWorkerPool, WorkerPool } from './workers';
 *   
 *   // Initialize
 *   const pool = await initWorkerPool('/path/to/wasm.wasm');
 *   
 *   // Use physics API
 *   const height = await pool.getGroundHeight(x, z);
 *   
 *   // Use world generation API
 *   const entities = await pool.generateEntities(400, 150, (current, total) => {
 *     console.log(`Progress: ${(current/total * 100).toFixed(1)}%`);
 *   });
 *   
 *   // Cleanup
 *   terminateWorkerPool();
 */

// Worker Pool
export {
  WorkerPool,
  initWorkerPool,
  getWorkerPool,
  terminateWorkerPool
} from './worker-pool';

// Types
export type {
  WorkerStats,
  ProceduralEntity,
  PhysicsRequest,
  PhysicsResponse,
  WorldGenRequest,
  WorldGenResponse,
  WorkerMessage,
  WorkerPoolOptions,
  WorkerFeatureDetection
} from './worker-types';

// Re-export worker types for advanced usage
export * from './worker-types';

// ============================================================================
// Feature Detection
// ============================================================================

/**
 * Detect Web Worker support and related features
 */
export function detectWorkerFeatures(): WorkerFeatureDetection {
  return {
    isWorkerSupported: typeof Worker !== 'undefined',
    isOffscreenCanvasSupported: typeof OffscreenCanvas !== 'undefined',
    isSharedArrayBufferSupported: (() => {
      try {
        return typeof SharedArrayBuffer !== 'undefined' && 
               new SharedArrayBuffer(1).byteLength === 1;
      } catch {
        return false;
      }
    })()
  };
}

/**
 * Log worker support status to console
 */
export function logWorkerSupport(): void {
  const features = detectWorkerFeatures();
  
  console.group('🔧 Web Worker Support');
  console.log('Workers:', features.isWorkerSupported ? '✅ Supported' : '❌ Not Supported');
  console.log('OffscreenCanvas:', features.isOffscreenCanvasSupported ? '✅ Supported' : '❌ Not Supported');
  console.log('SharedArrayBuffer:', features.isSharedArrayBufferSupported ? '✅ Supported' : '❌ Not Supported');
  
  if (!features.isWorkerSupported) {
    console.warn('⚠️ Web Workers not supported - will use main thread fallback');
  }
  
  console.groupEnd();
}

// ============================================================================
// Performance Benefits Documentation
// ============================================================================

/**
 * Performance Benefits of Web Workers
 * 
 * ## Main Thread Responsiveness
 * - WASM physics calculations (getGroundHeight, collision detection) run in separate threads
 * - World generation (PROCEDURAL_ENTITY_COUNT = 400 entities) doesn't block UI
 * - Browser remains responsive during heavy startup computations
 * 
 * ## Parallel Processing
 * - Physics workers: 2 workers for latency-sensitive operations
 * - World gen workers: 2 workers for throughput-sensitive operations
 * - Independent calculations run in parallel on multi-core systems
 * 
 * ## Expected Speedups
 * - World generation: ~2-3x faster on multi-core systems
 * - Batch physics queries: ~1.5-2x faster
 * - Startup time: Significantly reduced perceived freeze time
 * 
 * ## Fallback Behavior
 * - If Workers aren't supported, automatically falls back to main thread
 * - Same API works in both modes
 * - No code changes required for fallback path
 */

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * Example: Basic Physics Query
 * ```typescript
 * import { initWorkerPool } from './workers';
 * 
 * async function getTerrainHeight(x: number, z: number): Promise<number> {
 *   const pool = await initWorkerPool('/wasm/candy_physics.wasm');
 *   return await pool.getGroundHeight(x, z);
 * }
 * ```
 */

/**
 * Example: Batch Terrain Query
 * ```typescript
 * import { initWorkerPool } from './workers';
 * 
 * async function getTerrainHeights(positions: {x: number, z: number}[]): Promise<number[]> {
 *   const pool = await initWorkerPool('/wasm/candy_physics.wasm');
 *   return await pool.batchGetGroundHeight(positions);
 * }
 * ```
 */

/**
 * Example: World Generation
 * ```typescript
 * import { initWorkerPool } from './workers';
 * 
 * async function generateWorld() {
 *   const pool = await initWorkerPool('/wasm/candy_physics.wasm');
 *   
 *   const entities = await pool.generateEntities(
 *     400,  // count
 *     150,  // range
 *     (current, total) => {
 *       console.log(`Generated ${current}/${total} entities`);
 *     }
 *   );
 *   
 *   // Instantiate entities in the scene
 *   for (const entity of entities) {
 *     createFoliage(entity.type, entity.x, entity.y, entity.z);
 *   }
 * }
 * ```
 */

/**
 * Example: Feature Detection
 * ```typescript
 * import { detectWorkerFeatures, logWorkerSupport } from './workers';
 * 
 * // Check support
 * const features = detectWorkerFeatures();
 * if (features.isWorkerSupported) {
 *   console.log('Using Web Workers for parallel processing');
 * } else {
 *   console.log('Using main thread fallback');
 * }
 * 
 * // Log detailed support
 * logWorkerSupport();
 * ```
 */

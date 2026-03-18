# Web Workers Performance Documentation

## Overview

The candy_world Web Workers system provides heavy computation offload for WASM physics and world generation, keeping the main thread responsive during startup and gameplay.

## Performance Benefits

### 1. Main Thread Responsiveness

**Problem:** WASM physics calculations (getGroundHeight, collision detection) and world generation (PROCEDURAL_ENTITY_COUNT = 400 entities) block the main thread, causing the browser to appear frozen.

**Solution:** All heavy computations are offloaded to Web Workers.

**Benefits:**
- Browser UI remains responsive during startup
- No perceived "freeze" during world generation
- Smooth animations continue during physics calculations
- Better user experience with progress indicators

### 2. Parallel Processing

**Architecture:**
- **Physics Workers:** 2 workers for latency-sensitive operations
- **World Generation Workers:** 2 workers for throughput-sensitive operations

**Benefits:**
- Independent calculations run in parallel on multi-core systems
- Reduced total computation time
- Better utilization of modern multi-core CPUs

### 3. Expected Speedups

| Operation | Single Thread | With Workers | Speedup |
|-----------|--------------|--------------|---------|
| World Generation (400 entities) | ~2-3 seconds | ~0.8-1.5 seconds | **~2-3x** |
| Batch Physics Queries (100 positions) | ~50ms | ~25-35ms | **~1.5-2x** |
| Startup Time | ~4-5 seconds | ~2-3 seconds | **~1.5-2x** |
| Perceived Freeze Time | 2-3 seconds | 0 seconds | **Eliminated** |

*Note: Actual speedups depend on hardware. Multi-core systems see greater benefits.*

## Feature Detection Fallback

The system automatically detects Web Worker support and falls back to main thread execution if needed.

```typescript
import { detectWorkerFeatures, logWorkerSupport } from './workers';

// Check support
const features = detectWorkerFeatures();
// { 
//   isWorkerSupported: true,
//   isOffscreenCanvasSupported: true,
//   isSharedArrayBufferSupported: false 
// }

// Log detailed support
logWorkerSupport();
// 🔧 Web Worker Support
//   Workers: ✅ Supported
//   OffscreenCanvas: ✅ Supported
//   SharedArrayBuffer: ❌ Not Supported
```

### Fallback Behavior

- If Workers aren't supported, same API works on main thread
- No code changes required for fallback path
- Graceful degradation with console warnings

## Usage

### Initialize the Worker Pool

```typescript
import { initWorkerPool } from './workers';

// Initialize with WASM URL
const pool = await initWorkerPool('/wasm/candy_physics.wasm');

// Check if using workers
console.log('Using workers:', pool.isUsingWorkers());
```

### Physics Queries

```typescript
// Single ground height query
const height = await pool.getGroundHeight(x, z);

// Batch query for better performance
const positions = [
  { x: 0, z: 0 },
  { x: 10, z: 10 },
  // ... 100 positions
];
const heights = await pool.batchGetGroundHeight(positions);

// Collision check
const isValid = await pool.checkPositionValidity(x, z, radius);
```

### World Generation

```typescript
// Generate procedural entities with progress callback
const entities = await pool.generateEntities(
  400,  // PROCEDURAL_ENTITY_COUNT
  150,  // Range
  (current, total) => {
    console.log(`Progress: ${(current/total * 100).toFixed(1)}%`);
  }
);

// Instantiate in scene
for (const entity of entities) {
  createFoliage(entity.type, entity.x, entity.y, entity.z, entity.variant);
}
```

### Cleanup

```typescript
import { terminateWorkerPool } from './workers';

// Terminate all workers when done
terminateWorkerPool();
```

## Worker Pool Statistics

Monitor worker performance:

```typescript
const stats = pool.getStats();
console.log({
  totalRequests: stats.totalRequests,
  successfulRequests: stats.successfulRequests,
  failedRequests: stats.failedRequests,
  averageResponseTime: stats.averageResponseTime,
  isUsingWorkers: stats.isUsingWorkers,
  pendingRequests: stats.pendingRequests
});
```

## Architecture

### File Structure

```
src/workers/
├── index.ts                    # Main exports and feature detection
├── worker-types.ts             # Shared TypeScript types
├── worker-pool.ts              # Worker pool manager
├── physics-worker.ts           # WASM physics wrapper worker
├── worldgen-worker.ts          # World generation worker
├── emscripten.worker.ts        # Emscripten WASM compilation worker
└── WORKER_PERFORMANCE.md       # This documentation
```

### Request Batching

Physics workers use request batching to optimize throughput:
- Requests are queued and processed in batches
- Batch size: 64 requests
- Batch delay: 4ms (~1 frame at 60fps)
- Reduces message passing overhead

### Error Handling and Retries

- Automatic retry with exponential backoff (max 3 retries)
- Fallback to main thread if all workers fail
- Request timeouts (30s default, 120s for world generation)

### Health Checks

- Workers are pinged every 30 seconds
- Idle workers are terminated after 30 seconds
- Minimum pool size maintained for responsiveness

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Web Workers | ✅ | ✅ | ✅ | ✅ |
| Module Workers | ✅ 80+ | ✅ 114+ | ✅ 15+ | ✅ 80+ |
| OffscreenCanvas | ✅ 69+ | ✅ 105+ | ❌ | ✅ 79+ |
| SharedArrayBuffer | ✅ (COOP/COEP) | ✅ | ❌ | ✅ |

## Testing

### Verify TypeScript Compiles

```bash
cd candy_world
npx tsc --noEmit
```

### Check Worker Support

Open browser console and run:

```javascript
console.log('Worker supported:', typeof Worker !== 'undefined');
console.log('Module worker supported:', () => {
  try {
    new Worker('data:text/javascript,', { type: 'module' });
    return true;
  } catch {
    return false;
  }
});
```

## Future Enhancements

1. **SharedArrayBuffer:** Enable zero-copy data transfer between main thread and workers
2. **OffscreenCanvas:** Move WebGPU rendering to worker thread
3. **Worklets:** Use AudioWorklet for audio processing
4. **Service Worker:** Cache compiled WASM modules for faster startup

## Troubleshooting

### Workers Not Loading

Check browser console for:
- CORS errors (workers require same-origin or proper headers)
- MIME type errors (worker files must be served as JavaScript)
- Module type errors (ensure `{ type: 'module' }` is specified)

### Performance Not Improved

- Check `pool.isUsingWorkers()` returns `true`
- Verify CPU has multiple cores
- Check browser isn't throttling background tabs
- Monitor `stats.fallbackExecutions` for fallback events

### Memory Issues

- Workers use ~64MB memory each
- Terminate pool when not needed: `terminateWorkerPool()`
- Monitor `stats.memoryUsage` in worker stats

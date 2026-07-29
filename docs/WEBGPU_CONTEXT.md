# WebGPU Context Architecture

## Overview
Candy World uses a unified WebGPU device and renderer context management system via the `gpuContext` singleton, located in `src/rendering/gpu-context.ts`.

Prior to this architecture, multiple sub-systems (renderer, particles, and compute) would opportunistically attempt to call `navigator.gpu.requestAdapter` and `adapter.requestDevice`. This led to high VRAM pressure, race conditions on startup, and silent black canvases if the device was ever lost due to OS resources.

The single-device architecture centralizes adapter and device request flow. The `GPUContext` object is initialized early in the render pipeline (within `src/core/init.ts`) and creates the `WebGPURenderer`, caching the created `adapter`, `device`, and `limits` for other subsystems to borrow safely.

## Core Features
1. **Single Owner:** `GPUContext` makes the request, no other system does.
2. **Explicit context:** `powerPreference: 'high-performance'` is forced globally.
3. **Graceful fail-closed:** Compute/particle systems degrade cleanly when the shared device is unavailable.
4. **Device lost recovery:** If `device.lost` fires, the application prevents a silent crash by overlaying an explicit modal UI prompting the user to reload the game.

## Interacting with `gpuContext`
The `gpuContext` must be ready before requesting the `device` or its limits.

```typescript
import { gpuContext } from '../rendering/gpu-context.ts';

if (gpuContext.isReady()) {
    const device = gpuContext.getDevice();
    const limits = gpuContext.getLimits();

    // Use device for buffer/pipeline allocations safely
} else {
    // Graceful degradation (e.g. CPU fallback or skipping compute passes)
}
```

## System Integration
* **`src/core/init.ts`**: Awaits `gpuContext.init(canvas)` to extract and return the configured `WebGPURenderer`.
* **`src/compute/gpu-compute-library.ts`**: Subscribes to the context's device. Will safely skip work if the GPU context drops.
* **`src/particles/compute-particles.ts`**: Subscribes to the context's device.
* **`src/rendering/webgpu-limits.ts`**: Bypasses fallback checking to extract real, hard limits from the `gpuContext`.
* **`src/utils/startup-profiler.ts`**: Replaces the global `GPUDevice.prototype` directly instead of tracking adapter promises since the `gpuContext` assumes adapter responsibilities.
with open("plan.md", "r") as f:
    plan = f.read()

new_item = """  - **Phase 4 targets (Compute Shaders - Remaining)**: **Status: Implemented ✅**
    - *Implementation Details: Updated the main rendering loop and procedural generation in `src/world/generation.ts` and `src/core/game-loop.ts` to utilize the modern GPU `ComputeParticleSystem` implementations for Fireflies and Pollen via their drop-in replacements (`createIntegratedFireflies`, `createIntegratedPollen`), enabling significantly higher particle counts (e.g. 50k for fireflies) and moving complex physics and collision detection entirely to WebGPU Compute Shaders.*
"""

# add it after Impacts Compute
plan = plan.replace("  - **Phase 4 targets (Impacts Compute)**: **Status: Implemented ✅**\n    - *Implementation Details: Migrated `src/foliage/impacts.ts` to utilize WebGPU Compute Shaders. Swapped `InstancedBufferAttribute` with `StorageInstancedBufferAttribute` and handled physics, scale, and color strictly inside a WebGPU TSL compute node using `renderer.compute(computeNode)`. Spawns are queued via uniforms to eliminate per-frame CPU iteration.*",
                    "  - **Phase 4 targets (Impacts Compute)**: **Status: Implemented ✅**\n    - *Implementation Details: Migrated `src/foliage/impacts.ts` to utilize WebGPU Compute Shaders. Swapped `InstancedBufferAttribute` with `StorageInstancedBufferAttribute` and handled physics, scale, and color strictly inside a WebGPU TSL compute node using `renderer.compute(computeNode)`. Spawns are queued via uniforms to eliminate per-frame CPU iteration.*\n" + new_item)

with open("plan.md", "w") as f:
    f.write(plan)

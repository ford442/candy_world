- Direct matrix array manipulation (`instanceMatrix.array`) bypasses expensive Object3D composition and matrix allocations, significantly improving rendering batcher update loops.
## 2024-04-09 - TSL and GC Performance Rules\n**Learning:** In Three.js, TSL math nodes are generally faster and preferred over updating uniforms via JS every frame for performance optimization. For Three.js InstancedMesh objects, colors must be updated via `.setColorAt()`. Modifying the material directly will incorrectly affect all instances. In Candy World, collision detection handled in JavaScript becomes a severe bottleneck at >500 entities. AssemblyScript/WASM handles 2000+ entities efficiently.\n**Action:** Use TSL math nodes instead of JS uniforms whenever possible. Always use `.setColorAt()` for InstancedMesh colors. Use WASM for heavy collision detection.

## 2024-04-10 - Direct InstancedMesh Updates (Batcher Sweep)
**Learning:** Using a dummy `THREE.Object3D` proxy inside a high-frequency loop to update an `InstancedMesh` via `setMatrixAt` causes significant internal allocation churn and massive CPU bottlenecking.
**Action:** Bypass the object proxy completely. Pre-allocate a scratch `THREE.Matrix4()`, compose position, rotation, and scale data directly into it, and write it straight to the `InstancedMesh`'s flat `Float32Array` via `_scratchMatrix.toArray(this.mesh.instanceMatrix.array, i * 16)`. Flag `this.mesh.instanceMatrix.needsUpdate = true` at the end of the loop.
## 2024-05-XX - Zero-Allocation Matrix Batching
**Learning:** Calling `Object3D.updateMatrix()` and `mesh.setMatrixAt()` inside update loops or batch generation code causes significant CPU overhead and garbage collection (GC) spikes because they instantiate intermediate objects and allocate arrays under the hood.
**Action:** For all `InstancedMesh` batchers, construct `Matrix4` locally using zero-allocation scratch variables (`_scratchMatrix.compose(pos, quat, scale)`) and copy the result directly to the underlying buffer memory using `_scratchMatrix.toArray(mesh.instanceMatrix.array, index * 16)`. Always follow up with `mesh.instanceMatrix.needsUpdate = true`.

## 2024-05-XX - Zero-Allocation Static Utility Methods
**Learning:** Calling `new THREE.Matrix4()` or `new THREE.Frustum()` inside frequently executed static utility methods (like `extractFrustumPlanes`) causes hidden garbage collection (GC) spikes, as these methods are often called in hot paths without the caller realizing the internal allocation cost.
**Action:** Always introduce `private static` scratch variables (e.g., `private static _scratchExtractMatrix = new THREE.Matrix4()`) within utility classes to enable zero-allocation object reuse and prevent GC pressure.

## 2024-05-XX - Zero-Allocation Geometric Tests in Hot Loops
**Learning:** Using `clone()` on geometric primitives like `THREE.Sphere` inside hot culling or collision loops (e.g., `obj.boundingSphere.clone()`) creates significant per-frame, per-object memory allocations, leading to severe GC stuttering.
**Action:** Pre-allocate module-level scratch geometry variables (e.g., `const _scratchSphere = new THREE.Sphere()`) and use in-place copying and mutation (`_scratchSphere.copy(original); _scratchSphere.radius += margin;`) for intersection tests to ensure zero-allocation performance.
## 2026-04-12 - Zero-Allocation LOD Map Updates
**Learning:** Instantiating Maps and Arrays on every frame for batching updates (like `new Map()` and `[].push()`) creates significant garbage collection spikes, violating Bolt's Zero-Allocation standard.
**Action:** Use pre-allocated nested Maps as class properties (e.g., `this._lodUpdates`) and track active elements via a `count` variable instead of pushing to or resetting arrays, passing this count to downstream buffer updates to ensure stale data is ignored.
## 2026-04-14 - Zero-Allocation Iteration and Math.sqrt Extirpation
**Learning:** High-frequency loops suffer severe GC spikes from array allocation methods like `.filter()` and CPU bottlenecks from `distanceTo()` (`Math.sqrt()`).
**Action:** Replaced `.filter()` array processing with standard, zero-allocation `for` loops in `src/utils/wasm-physics.ts`. Converted `distanceTo()` checks to `distanceToSquared()` in LOD, interaction, and physics loops (`src/foliage/lod.ts`, `src/systems/physics.core.ts`, `src/utils/interaction-utils.ts`) to eliminate expensive square root operations.

## Date: 2024-05-24
### Title: Eliminating Array Methods (.map/.filter) in Hot Paths
**Learning:** High-frequency game and update loops suffer severe Garbage Collection (GC) spikes when using array iteration methods like `.map()` and `.filter()`. These methods create intermediate arrays that must be tracked and collected by the V8 engine, causing noticeable frame drops when processing thousands of objects (like loaded regions or wind calculations).
**Action:** Replaced `.map()` and `.filter()` occurrences with standard, zero-allocation `for` loops in files like `src/systems/region-manager.ts`, `src/systems/discovery-persistence.ts`, and `src/foliage/wind-compute.ts` to ensure consistent 60fps performance and avoid memory pressure.

## Date: 2024-05-24
### Title: Plugging Three.js VRAM Leaks on Scene Removal
**Learning:** Removing an object from a Three.js scene (using `scene.remove(mesh)`) unlinks it from the graph but does not free the WebGL/WebGPU resources allocated on the GPU. Failing to explicitly dispose of the underlying geometries and materials causes rapid VRAM exhaustion, particularly with dynamic entities like particle systems and weather effects.
**Action:** Added explicit `.dispose()` calls for geometries and materials (handling both single instances and arrays of materials) prior to removing `rainMesh`, `mistMesh`, and `rainbow` from the scene in `src/systems/weather/weather-effects.ts`.


2024-05-24 - Physics Spatial Grids & Zero-Allocation Math
**Learning:** O(N) array iteration and Math.sqrt() in hot-path physics checks (like Retrigger Mushrooms and Geysers) create significant GC spikes and frame drops, even when N is relatively small compared to render counts. The rendering SpatialHashGrid is not suitable for gameplay proximity logic.
**Action:** Implemented a lightweight, physics-dedicated `PhysicsSpatialGrid` populated once per world generation. Replaced O(N) loops in `checkRetriggerMushrooms`, `checkGeysers`, `checkSnareTraps`, and `checkVibratoViolets` with grid queries, and stripped all `Math.sqrt()` and proxy `distanceToSquared()` calls from hot loops.

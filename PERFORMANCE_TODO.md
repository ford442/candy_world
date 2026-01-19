# Candy World Performance & Quality Checklist

This document outlines a prioritized roadmap to eliminate lag spikes (specifically the "solid freeze" at startup) and improve runtime performance.

**Current Status:**
- **Startup Freeze:** caused by compiling unique shaders for ~3000 individual mushroom instances.
- **Runtime Lag:** caused by heavy JavaScript loop iterating over thousands of Group objects.
- **Load Time:** slowed by sequential WASM calls for physics initialization.

---

## ✅ Phase 1: Quick Wins (Configuration & Rendering)
*Goals: stabilize frame rate without major refactoring.*

- [ ] **Adjust Object Limits** (`src/world/generation.ts`)
    - [ ] Raise `animatedFoliage` safety limit from 1000 to **3000**.
    - [ ] Reduce procedural "extras" count if density is too high.
    - [ ] **Action:** Ensure we target ~2000 initial objects, capping at 3000 max.

- [ ] **Tune Frustum Culling** (`src/systems/music-reactivity.js`)
    - [ ] The current culling relies on `obj.userData.radius`.
    - [ ] **Task:** Audit `src/foliage/mushrooms.js` and `flowers.js` to ensure they explicitly set accurate `userData.radius`.
        - *Example:* A giant mushroom might need `radius: 8.0` while a flower needs `radius: 1.5`.
    - [ ] **Task:** Tighten render distance. Change `distSq > 150 * 150` to a dynamic value based on object size (e.g., small flowers cull at 80m, giant trees at 200m).

- [ ] **Optimize Shadow Settings** (`src/core/init.js`)
    - [ ] With 3000 objects, the shadow map is under heavy load.
    - [ ] **Task:** Switch directional light shadow to `autoUpdate = false` and update it only when the sun moves significantly or foliage grows.

---

## 🚀 Phase 2: The "Solid Freeze" Fix (Material Strategy)
*Goal: Eliminate the 2-minute freeze by reducing shader programs from ~3000 to ~12.*

The current implementation clones the material for every mushroom to set a unique `noteColor`. This forces the GPU to compile 3000 unique shader variants.

- [ ] **Implement "Chromatic Material Reuse"** (`src/foliage/mushrooms.js`)
    - [ ] **Concept:** Instead of creating a new material for every mushroom, create exactly **12 shared materials** (one for each note: C, C#, D, etc.).
    - [ ] **Logic:**
        ```javascript
        // Pseudo-code for Module Scope
        const NOTE_MATERIALS = {}; // Cache: { 'C': Mat, 'C#': Mat ... }

        function getMaterialForNote(note, baseMaterial) {
           if (!NOTE_MATERIALS[note]) {
               const mat = baseMaterial.clone();
               mat.userData.noteColor = CONFIG.noteColors[note];
               NOTE_MATERIALS[note] = mat;
           }
           return NOTE_MATERIALS[note];
        }
        ```
    - [ ] **Application:** Apply this to Mushroom Caps, Spots, and Flower Petals.
    - [ ] **Result:** `forceFullSceneWarmup` will only need to compile ~12 shaders instead of 3000.

---

## ⚡ Phase 3: Load Time & WASM Batching
*Goal: Speed up world initialization by batching physics calls.*

Currently, `initCppPhysics` calls `addObstacle` 3000 times. Crossing the JS<->WASM bridge 3000 times is slow.

- [ ] **Create Batch API in C++** (`emscripten/physics.cpp`)
    - [ ] **Task:** Add a new exported function `addObstaclesBatch`.
    - [ ] **Signature:** `void addObstaclesBatch(float* data, int count)`
    - [ ] **Data Layout:** Flat array where each obstacle uses 9 floats: `[type, x, y, z, r, h, p1, p2, p3]`.

- [ ] **Implement Batch Loader** (`src/utils/wasm-loader.js`)
    - [ ] **Task:** Create `uploadObstaclesBatch(objects)` function.
    - [ ] **Logic:**
        1. Allocate a `Float32Array` in WASM memory (using `malloc` or a shared buffer).
        2. Iterate JS objects and write data into the array.
        3. Call `_addObstaclesBatch`.
        4. Free memory.

- [ ] **Update Physics System** (`src/systems/physics.ts`)
    - [ ] Replace the `foliageMushrooms.forEach` loop with a single call to `uploadObstaclesBatch`.

---

## 🏗️ Phase 4: Long-Term Architecture (Instancing)
*Goal: Support 10,000+ objects at 60 FPS.*

Moving `THREE.Group` objects to `THREE.InstancedMesh` is the ultimate performance unlock but requires significant refactoring.

- [ ] **Migration Strategy**
    - [ ] **Identify Batches:** Group objects by Geometry + Material.
        - *Batch 1:* Standard Mushrooms (Stem Geo + Clay Mat).
        - *Batch 2:* Standard Mushrooms (Cap Geo + Red Mat).
        - *Batch 3:* Giant Mushrooms...
    - [ ] **Tsl Instancing:** Use `THREE.InstancedAttribute` for:
        - `instanceColor`: For note colors.
        - `instanceScale`: For size variation.
        - `instanceOffset`: For individual animation timing.
    - [ ] **Physics Sync:** The `MusicReactivitySystem` will need to update the `InstancedMesh` buffers instead of traversing a generic array of Groups.

---

## 📋 Specific To-Dos for Next Session

1.  **Modify `src/foliage/mushrooms.js`**:
    *   Remove `capMat.clone()`.
    *   Implement the 12-slot material cache.
2.  **Modify `src/world/generation.ts`**:
    *   Raise `animatedFoliage` limit to 3000.
    *   Lower procedural extras count to 20.
3.  **Modify `src/systems/music-reactivity.js`**:
    *   Add explicit `radius` checks.
    *   Log how many objects are culled vs. rendered for debugging.

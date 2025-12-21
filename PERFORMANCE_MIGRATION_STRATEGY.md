# Performance Migration Strategy & Optimization Formula

**Goal:** Systematically move code from high-level JavaScript to lower-level, high-performance environments (TypeScript -> AssemblyScript WASM -> C++ WASM) to maximize frame rates and object counts.

---

## 🏗 The Optimization Pipeline

We follow a strict hierarchy of performance. Code should be migrated "down" this list as it becomes a bottleneck.

| Tier | Environment | Use Case | Best Candidates |
| :--- | :--- | :--- | :--- |
| **1** | **JavaScript (ES6+)** | Scene orchestration, DOM, Event handling, WebGL setup. | Init logic, UI, one-off events, Three.js material setup. |
| **2** | **TypeScript (Strict)** | Complex logic needing type safety, complex data structures. | State management, complex config parsing, system managers. |
| **3** | **AssemblyScript (WASM)** | High-frequency math, per-entity loop logic, array manipulations. | Particle updates, simple physics, procedural generation noise, skeletal animation math. |
| **4** | **C++ (Emscripten WASM)** | **Heavy** raw computation, pointers, SIMD operations, shared memory. | Fluid simulations, complex collision detection (spatial hasing), audio DSP, heavy matrix math for 10k+ instances. |

---

## 🧪 Formula for Migration

### Phase 1: JS ➔ TS (Type Safety & Structure)
**Objective:** Prepare code for strict typing and identify hidden complexity.
* **Identify:** Look for JS files with JSDoc comments describing complex objects (e.g., `src/systems/physics.js`, `src/foliage/animation.js`).
* **Action:**
    1.  Rename `.js` to `.ts`.
    2.  Define `interface` or `type` for all data structures (e.g., `Particle`, `FoliageState`).
    3.  Fix implicit `any` errors.
    4.  *Benefit:* This often reveals "hidden classes" or inconsistent object shapes that kill V8 optimization.

### Phase 2: TS ➔ AssemblyScript (WASM "Lite")
**Objective:** Move math-heavy loops off the main JS thread's garbage collector.
* **Identify:**
    * Functions running inside `animate()` or `update()` loops.
    * Math involving `Math.sin`, `Math.cos`, `Vector3` operations on arrays.
    * Example: `animateFoliage` in `src/foliage/animation.js`.
* **Action:**
    1.  Create a counterpart function in `assembly/index.ts`.
    2.  Use `Float64Array` or `Float32Array` (SharedArrayBuffer) to pass data. **Avoid passing Objects.**
    3.  Replace JS logic with AssemblyScript (syntax is very similar to TS).
    4.  Update `src/utils/wasm-loader.js` to expose the new function.

### Phase 3: TS/ASC ➔ C++ (Heavy Metal)
**Objective:** Maximum throughput using raw memory access and SIMD.
* **Identify:**
    * Systems processing > 5,000 entities per frame.
    * O(N^2) algorithms (like simple collision checks between many objects).
    * Audio processing (FFT, granular synthesis) currently in AudioWorklets.
* **Action:**
    1.  Define a C struct in `emscripten/candy_native.c` that matches your entity data layout.
    2.  Write the processing loop in C/C++.
    3.  Recompile using `./emscripten/build.sh`.
    4.  Access via `Module._functionName` in JS.

---

## 🎯 Current Migration Candidates (Roadmap)

### Priority A: High CPU Cost (Move to AssemblyScript/C++)
* **`src/foliage/animation.js` -> `animateFoliage`**
    * *Why:* Iterates over thousands of plants every frame calculating `sin`/`cos` sway.
    * *Target:* `assembly/index.ts`.
* **`src/systems/physics.js` -> `updatePhysics`**
    * *Why:* Collision detection loops are expensive.
    * *Target:* `emscripten/candy_native.c` (C++ is better for spatial hasing/quadtrees).

### Priority B: Logic Complexity (Move to TypeScript)
* **`src/foliage/factories/*.js`**
    * *Why:* Factory functions take many loose options (`{ color, size, type }`). Strict typing will prevent "undefined property" crashes during spawning.
* **`src/world/generation.js`**
    * *Why:* Complex logic for map parsing and object placement.

### Priority C: Future Audio (C++)
* **`src/systems/music-reactivity.js`**
    * *Target:* Move FFT analysis and beat detection thresholds to C++ for tighter synchronization and lower latency.

---

## 📝 Developer Annotations
When writing code, add these comments to flag future work for agents:

* `// @OPTIMIZE: Candidate for AssemblyScript (Math-heavy loop)`
* `// @OPTIMIZE: Candidate for C++ (O(n^2) complexity or raw memory access)`
* `// @Refactor: Move to TypeScript (Complex state object)`

---

## ⚙️ How to Compile

* **AssemblyScript:** `npm run asbuild`
* **C++ (Emscripten):** `cd emscripten && ./build.sh`

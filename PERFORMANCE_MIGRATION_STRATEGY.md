# Performance Migration Strategy & Optimization Formula (Refined)

**Goal:** Move performance-critical code down the stack only when proven necessary by profiling data. Avoid premature optimization.

## 🎯 The Optimization Pipeline (Decision Tree)
Migrate code down this ladder only if it exceeds the thresholds below. WASM calls have overhead (~0.5ms/call); small functions may run slower after migration.

| Tier | Environment | When to Use It | Migration Threshold | Agent Flag |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **JavaScript (ES6+)** | Default. DOM, events, orchestration. | < 2ms/frame in profiler | N/A |
| **2** | **TypeScript (Strict)** | Complex state, config parsing, type safety needed. | Logic errors > 5% of bugs | `@refactor ts` |
| **3** | **AssemblyScript (WASM)** | Proven hot loops: math on >100 items/frame. | > 3ms/frame and > 500 iterations | `@optimize asc` |
| **4** | **C++ (Emscripten WASM)** | Extreme scale: >1k entities, SIMD, shared memory. | > 8ms/frame and memory allocation thrash | `@optimize cpp` |

## 🏗️ Architectural Strategy: Interface-First (Component Model Ready)
**Goal:** Decouple game logic from engine implementation to allow seamless backend swaps (JS → TS → WASM → C++) without rewriting consumers.

1.  **Define the Contract (WIT-Style):**
    * Create strict TypeScript interfaces (e.g., `src/interfaces/IPhysicsEngine.ts`) defining capabilities (e.g., `getPositions()`, `step()`).
    * **Rule:** Interfaces must **NOT** expose memory offsets, pointers, or engine-specific glue. Data transfer must be abstract (e.g., returning `Float32Array` views).

2.  **The Adapter Pattern:**
    * **Stage A (Legacy/JS):** Wrap current logic in a `LegacyAdapter` class that implements the interface. Isolate "glue code" (memory copies, `SharedArrayBuffer` views, offsets) inside this adapter.
    * **Stage B (WASM/C++):** Implement a `WasmAdapter` that talks to the new backend.
    * **Stage C (Swap):** Switch adapters at initialization (`const physics = useWasm ? new WasmPhysicsAdapter() : new LegacyPhysicsAdapter()`). Gameplay code remains untouched.

3.  **Future-Proofing:** This aligns with the **WASM Component Model**, where these "Adapters" eventually become standardized bindings (imports/exports) handled by the runtime.

---

## 🧪 Migration Protocol (Agent Actions)

### Step 0: Profile First (MANDATORY)
* **Chrome DevTools → Performance → Start profiling**
* Look for: Long Task (>50ms), frequent function calls, GC pauses
* **Rule:** No migration without a profile screenshot showing the function's self-time.

### Step 1: JS → TS (Safety Net)
* **Trigger:** Function has complex objects, frequent `undefined` crashes.
* **Action:**
    1.  Rename `.js` → `.ts`.
    2.  Run `tsc --noEmit --strict`; fix all `any` types.
    3.  Stop here. Re-profile. Type safety alone often fixes V8 deopts.

### Step 2: TS → AssemblyScript (WASM)
* **Trigger:** Profile shows >3ms self-time in a loop over arrays.
* **Pre-requisite:** **Interface Defined.** System must be accessed via an `I[System]` interface, not direct imports.
* **Action:**
    1.  **Refactor:** Move existing JS logic behind an `Adapter` implementing the Interface.
    2.  Measure overhead: Copy function to `assembly/`, wrap in `export function`.
    3.  Use only TypedArrays: `Float32Array` for data-in, `Int32Array` for indices.
    4.  Pass flat data, not objects. **Struct-of-Arrays** pattern only.
    5.  Update loader: `wasmLoader.import('module', 'function', typedArray)`.
    6.  **Batching Pattern:** Use a JS batcher to collect data and call WASM once per frame per type (e.g., `FoliageBatcher`).
    7.  **A/B test:** If WASM version is not >5% faster, revert.

### Step 3: ASC → C++ (Heavy Metal)
* **Trigger:** Profile shows >8ms and AssemblyScript is memory-bound or needs SIMD.
* **Action:**
    1.  Define one C struct in `emscripten/include/entity.h`.
    2.  Use `EMSCRIPTEN_KEEPALIVE` and raw pointers (`float* positions`).
    3.  Enable SIMD: Add `-msimd128` to `build.sh`.
    4.  Access: `Module.ccall('function', 'number', ['number', 'number'], [ptr, length])`.
* **Fallback:** If build fails or crashes, return to AssemblyScript. Do not debug C++ in prod.

---

## 🎯 Current Migration Queue (Prioritized by Profile Data)

### Priority A: Hot Loops (Migrate to WASM)
| Function | File | Profile Data | Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| `animateFoliage` | `src/foliage/animation.js` | 4.2ms/frame (2k plants) | `assembly/foliage.ts` | **Done (Hybrid)** |
| `updateParticles` | `src/systems/particles.js` | 5.1ms/frame (5k particles) | `assembly/particles.ts` | **Ready** |

### Priority B: Type Safety (Migrate to TS)
| Function | File | Issue | Action |
| :--- | :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.js` | 3 undefined bugs this sprint | Rename to `.ts`, add `FoliageConfig` interface |
| `generateMap` | `src/world/generation.js` | Logic complexity | Rename to `.ts`, strict mode | **Done** |

### Priority C: Future Research (Do NOT migrate yet)
| Function | File | Blocker |
| :--- | :--- | :--- |
| `updatePhysics` | `src/systems/physics.js` | Needs spatial hashing in JS first; profile after |

---

## ⚠️ Agent Constraints (Critical)
* **WASM Call Budget:** Max 3 WASM calls per frame. Batching > multiple calls.
* **Debugging Cost:** C++ WASM cannot be source-mapped; add extensive logging in JS wrapper.
* **SharedArrayBuffer:** Requires COOP/COEP headers. Test on production domain before migrating.
* **Revert Policy:** If migrated code is < 5% faster and increases bundle size > 150kb, revert to TS.

## 📝 Agent Annotation Standard
Use machine-readable comments for automation:
```javascript
// @perf-migrate {target: "asc", reason: "hot-loop", threshold: "3ms"}
// @perf-profile {selfTime: "4.2ms", frame: "animation", screenshot: "profile-001.png"}

# Performance Migration Strategy & Optimization Formula (Refined)

**Goal:** Move performance-critical code down the stack only when proven necessary by profiling data. Avoid premature optimization.

## 🎯 The Optimization Pipeline (Decision Tree)
Migrate code down this ladder only if it exceeds the thresholds below. WASM calls have overhead (~0.5ms/call); small functions may run slower after migration.

| Tier | Environment | When to Use It | Migration Threshold | Agent Flag |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **JavaScript (ES6+)** | Default. DOM, events, orchestration. | < 2ms/frame in profiler | N/A |
| **2** | **TypeScript (Strict)** | Complex state, config parsing, type safety needed. | Logic errors > 5% of bugs | `@refactor ts` |
| **3** | **AssemblyScript (WASM)** | Proven hot loops: math on >1k items/frame. | > 3ms/frame and > 500 iterations | `@optimize asc` |
| **4** | **C++ (Emscripten WASM)** | Extreme scale: >5k entities, SIMD, shared memory. | > 8ms/frame and memory allocation thrash | `@optimize cpp` |

## 🧪 Migration Protocol (Agent Actions)

### Step 0: Profile First (MANDATORY)
* **Rule:** No migration without a profile screenshot or trace showing the function's self-time.

### Step 1: JS → TS (Safety Net)
* **Trigger:** Function has complex objects, frequent `undefined` crashes.
* **Action:**
    1.  Rename `.js` → `.ts`.
    2.  Run `tsc --noEmit --strict`; fix all `any` types.
    3.  Stop here. Re-profile. Type safety alone often fixes V8 deopts.

### Step 2: TS → AssemblyScript (WASM)
* **Trigger:** Profile shows >3ms self-time in a loop over arrays.
* **Action:**
    1.  Measure overhead: Copy function to `assembly/`, wrap in `export function`.
    2.  Use only TypedArrays: `Float32Array` for data-in, `Int32Array` for indices.
    3.  **Batching Pattern:** Use `FoliageBatcher` (see `src/foliage/foliage-batcher.ts`) to call WASM once per frame.
    4.  **A/B test:** If WASM version is not >20% faster, revert.

---

## 🎯 Current Migration Queue (Prioritized by Profile Data)

### Priority A: Hot Loops (Migrate to WASM)
| Function | File | Profile Data | Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| `animateFoliage` | `src/foliage/animation.ts` | 4.2ms/frame (2k plants) | `assembly/foliage.ts` | **Done (Hybrid)** |
| `updateParticles` | `src/systems/particles.js` | 5.1ms/frame | `assembly/particles.ts` | **Missing File** (Verify location) |

### Priority B: Type Safety (Migrate to TS)
| Function | File | Issue | Action | Status |
| :--- | :--- | :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.ts` | 3 undefined bugs | Interface `TreeOptions` | **Done** |
| `generateMap` | `src/world/generation.ts` | Logic complexity | Strict Mode | **Done** |

### Priority C: Future Research (Do NOT migrate yet)
| Function | File | Blocker |
| :--- | :--- | :--- |
| `updatePhysics` | `src/systems/physics.js` | Needs spatial hashing in JS first; profile after |

---

## ✅ Agent Decision Checklist
Before starting migration:
- [ ] Profile shows function self-time > threshold?
- [ ] Function processes > 500 elements/frame?
- [ ] A/B test plan written?

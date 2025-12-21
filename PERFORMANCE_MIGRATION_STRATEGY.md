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
* **Action:**
    1.  Measure overhead: Copy function to `assembly/`, wrap in `export function`.
    2.  Use only TypedArrays: `Float32Array` for data-in, `Int32Array` for indices.
    3.  Pass flat data, not objects. **Struct-of-Arrays** pattern only.
    4.  Update loader: `wasmLoader.import('module', 'function', typedArray)`.
    5.  **A/B test:** If WASM version is not >20% faster, revert.

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
| `animateFoliage` | `src/foliage/animation.js` | 4.2ms/frame (2k plants) | `assembly/foliage.ts` | **Ready** |
| `updateParticles` | `src/systems/particles.js` | 5.1ms/frame (5k particles) | `assembly/particles.ts` | **Ready** |

### Priority B: Type Safety (Migrate to TS)
| Function | File | Issue | Action |
| :--- | :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.js` | 3 undefined bugs this sprint | Rename to `.ts`, add `FoliageConfig` interface |
| `generateMap` | `src/world/generation.js` | Logic complexity | Rename to `.ts`, strict mode |

### Priority C: Future Research (Do NOT migrate yet)
| Function | File | Blocker |
| :--- | :--- | :--- |
| `updatePhysics` | `src/systems/physics.js` | Needs spatial hashing in JS first; profile after |

---

## ⚠️ Agent Constraints (Critical)
* **WASM Call Budget:** Max 3 WASM calls per frame. Batching > multiple calls.
* **Data Size Floor:** Don't migrate functions processing < 500 elements.
* **Debugging Cost:** C++ WASM cannot be source-mapped; add extensive logging in JS wrapper.
* **SharedArrayBuffer:** Requires COOP/COEP headers. Test on production domain before migrating.
* **Revert Policy:** If migrated code is < 10% faster or increases bundle size > 50kb, revert to TS.

## 📝 Agent Annotation Standard
Use machine-readable comments for automation:
```javascript
// @perf-migrate {target: "asc", reason: "hot-loop", threshold: "3ms"}
// @perf-profile {selfTime: "4.2ms", frame: "animation", screenshot: "profile-001.png"}
```

## ⚙️ Build Commands & Verification

### AssemblyScript
```bash
npm run asbuild
npm run test:perf  # Must show >20% improvement
```

### C++
```bash
cd emscripten && ./build.sh
node scripts/validate-wasm.js  # Checks bundle size < 50kb increase
```

## ✅ Agent Decision Checklist
Before starting migration:

- [ ] Profile shows function self-time > threshold?
- [ ] Function processes > 500 elements/frame?
- [ ] A/B test plan written?
- [ ] Revert command documented (git revert -m 1)?
- [ ] Bundle size impact calculated?

**Golden Rule:** Profile, migrate the smallest unit possible, measure, then decide.

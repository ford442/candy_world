# Tier Parity Testing

Golden-vector harness that compares **JavaScript fallbacks**, **AssemblyScript** (`candy_physics.wasm`), and **C++/Emscripten** (`candy_native_st.wasm`, optional) for functions that exist at multiple migration tiers.

Run locally:

```bash
pnpm run build:wasm          # required — AssemblyScript module
pnpm run test:tier-parity    # C++ checks are best-effort if candy_native_st.* exists
```

Wired into `pnpm run test:integration` after `test:wasm`.

## Source of truth

| Domain                                                                              | Canonical tier                                     | Notes                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ground height (`getGroundHeight`)                                                   | **AssemblyScript** (`assembly/math.ts`)            | C++ `math.cpp` mirrors the same closed-form hills formula                                          |
| Particle integration (`updateParticles`)                                            | **AssemblyScript** (`assembly/particles.ts`)       | C++ `physics.cpp::updateParticles` is a _different_ API — not compared                             |
| Value noise / FBM (`valueNoise2D`, `fbm2D`)                                         | **AssemblyScript** (`assembly/math.ts`)            | C++ uses a **different hash** (`math.cpp`) — AS↔C++ not compared; C++ simd4 wrapper self-test only |
| Batch foliage (`batchShiver_c`, `batchSpring_c`, `batchFloat_c`, `batchCloudBob_c`) | **C++** (`emscripten/animation_batch_foliage.cpp`) | No AS tier; JS scalar reference mirrors C++ tail loops                                             |
| Shipped JS fallbacks                                                                | `src/utils/wasm-physics.ts`, `wasm-batch-math.ts`  | Compared to AS to document **production drift**                                                    |

See also: [PERFORMANCE_MIGRATION_STRATEGY.md](archive/PERFORMANCE_MIGRATION_STRATEGY.md) (15% slice / sandwich pattern).

## Files

| File                               | Role                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `tests/tier-parity.mjs`            | Runner — loads tiers, asserts golden vectors                |
| `tests/tier-parity-references.mjs` | JS reference math (`shipped*` + `f32*` + batch scalar refs) |

## Epsilon rationale

WebAssembly tiers use **f32** semantics; Node JS uses **f64** `Math.sin` unless explicitly rounded. SIMD paths use **fast sin approximations** in C++.

| Constant           | Value  | Used for                                                             |
| ------------------ | ------ | -------------------------------------------------------------------- |
| `GROUND`           | `1e-4` | `getGroundHeight` — pure sin/cos, all tiers                          |
| `PARTICLE`         | `1e-4` | `updateParticles` — 10-step integration, f32 ref vs AS               |
| `NOISE_F32_STABLE` | `1e-3` | `valueNoise2D` on fractional coords where sin args align             |
| `NOISE_SHIPPED`    | `0.15` | Shipped JS `Math.sin` hash vs AS `NativeMathf.sin` — **known drift** |
| `FBM_F32`          | `0.12` | `fbm2D` normalized accumulation — f32 + sin differences compound     |
| `FBM_SHIPPED`      | `0.15` | Reserved for shipped non-normalized `fbm` vs AS `fbm2D` if added     |
| `BATCH_SCALAR`     | `1e-4` | Batch animations, count ≤ 3 (C++ tail / `sinf` path)                 |
| `BATCH_SIMD`       | `3e-2` | Batch animations, count = 8 (C++ `fast_sin_simd` vs `Math.sin`)      |

Exact equality is unrealistic for cross-tier SIMD/fast-math paths. The harness catches **regressions** (constants changed, wrong formula, off-by-one stride) while allowing documented numeric bands.

## Tier availability

| Tier           | CI                    | Local dev             |
| -------------- | --------------------- | --------------------- |
| JS references  | ✅ always             | ✅                    |
| AssemblyScript | ✅ after `build:wasm` | ✅                    |
| C++/Emscripten | ⏭️ skipped (no emsdk) | ✅ after `build:emcc` |

When C++ artifacts are missing, the runner prints `C++ tier unavailable` and skips Emscripten cases **without failing**.

## Multi-tier function inventory

Functions with **≥2 implementations** in the migration stack (initial parity slice in **bold**):

| Function                              | JS fallback                             | AssemblyScript                  | C++/Emscripten                         | WebGPU compute      | In harness  |
| ------------------------------------- | --------------------------------------- | ------------------------------- | -------------------------------------- | ------------------- | ----------- |
| **`getGroundHeight`**                 | `wasm-physics.ts`                       | `assembly/math.ts`              | `math.cpp`                             | —                   | ✅          |
| **`valueNoise2D`**                    | `wasm-physics.ts`, `wasm-batch-math.ts` | `assembly/math.ts`              | `math.cpp` (different hash)            | —                   | ✅          |
| **`fbm2D` / `fbm`**                   | `wasm-physics.ts` (non-normalized)      | `assembly/math.ts` (normalized) | `math.cpp` (different hash)            | —                   | ✅          |
| **`updateParticles`**                 | `wasm-batch-particles.ts`               | `assembly/particles.ts`         | `particle_physics.cpp` (different API) | —                   | ✅ (JS↔AS)  |
| **`batchShiver_c`**                   | scalar ref in harness                   | —                               | `animation_batch_foliage.cpp`          | —                   | ✅ (JS↔C++) |
| **`batchSpring_c`**                   | scalar ref in harness                   | —                               | `animation_batch_foliage.cpp`          | —                   | ✅          |
| **`batchFloat_c`**                    | scalar ref in harness                   | —                               | `animation_batch_foliage.cpp`          | —                   | ✅          |
| **`batchCloudBob_c`**                 | scalar ref in harness                   | —                               | `animation_batch_foliage.cpp`          | —                   | ✅          |
| `fastInvSqrt`, `fastDistance`, `hash` | `wasm-physics.ts`                       | `assembly/math.ts`              | `math.cpp`                             | —                   | ⏳ future   |
| `batchGroundHeight_simd`              | scalar loop in `wasm-physics.ts`        | `getGroundHeight` per sample    | `math.cpp`                             | —                   | ⏳ future   |
| Foliage batchers (TSL pose)           | batcher `update()`                      | —                               | via `wasm-loader-cpp.ts`               | GPU compute shaders | ⏳ future   |

Runtime selection: `src/utils/wasm-loader-core.ts` → `wasm-physics.ts` / `wasm-loader-cpp.ts` / `wasm-orchestrator.ts`.

## Functions covered (initial slice)

Aligned with #1327–#1330 hot-loop migration targets:

1. **valueNoise2D / fbm2D** — noise sampling
2. **getGroundHeight** — terrain height
3. **updateParticles** — particle physics step
4. **batchShiver / Spring / Float / CloudBob** — foliage batch animations (C++ only)

## Adding a new parity case

1. Add reference JS in `tests/tier-parity-references.mjs` (mirror `assembly/` or `emscripten/` exactly).
2. Add golden inputs + `assertClose` / `assertArraysClose` in `tests/tier-parity.mjs`.
3. Document epsilon and canonical tier in this file.
4. If the shipped JS fallback should match, use `shipped*` refs; if testing AS semantics, use `f32*` refs.

## Related tests

- `tests/wasm.mjs` — AS particle **bounds** (not cross-tier parity)
- `tests/ground-unified-parity.mjs` — unified ground JS vs AS (platform/lake modifiers)

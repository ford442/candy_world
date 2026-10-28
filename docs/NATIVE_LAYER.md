# Native layer: ownership, memory model, toolchain (ADR)

Status: accepted. Supersedes the "mirror every subsystem in AS and C++" approach.

## Context

Ten subsystems exist in both `assembly/` (AssemblyScript, ~6k LOC) and
`emscripten/` (C++, ~6.4k LOC), plus a JS fallback: animation, animation_batch,
batch, boids, discovery, ecs, ground, math, physics, particles. Runtime order is
C++ → AS → JS. Until this change, PR CI and stable releases never built C++, so
AS served production and the C++ twins went untested. Every physics fix had to
be written twice, and the twins drifted. For example, `batchGroundHeight_simd`
used a degree-5 sine that was more than a unit off `getGroundHeight`. It never
showed up because the C++ batch path threw on the missing `HEAPF32` before it
ever ran.

Both modules also had memory corruption: the AS runtime heap overlapped the
hand-placed regions, several of those regions overlapped each other, boids
wrote through pointer 0, `__new` was used as an unpinned malloc, and cached
TypedArrays went stale after `memory.grow`.

## Decision 1: one owner per subsystem

| Subsystem                                              | Owner   | Why                                                               | Losing twin                                                                                                                                                                        |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| animation_batch, lod_batch, fluid, batcher_instance    | **C++** | SIMD + OpenMP batch work                                          | `assembly/animation_batch.ts`: delete once its parity test is green against C++                                                                                                    |
| particles (batch)                                      | **C++** | SIMD/threaded                                                     | AS `particles.ts` stays only as the bounds-tested single-thread path until C++ parity lands                                                                                        |
| boids                                                  | **C++** | threaded batch                                                    | `assembly/boids.ts`. Today `cppUpdateBoids` is bound before Emscripten loads, so it is always null and AS serves; bind it after load behind a parity test, then delete the AS twin |
| ecs                                                    | **C++** | `src/systems/ecs/world.ts` already targets the C++ slab API       | `assembly/ecs.ts`: deleted (#2026 slice 1; nothing called it)                                                                                                                      |
| batch (`batch.cpp`)                                    | **C++** | OpenMP                                                            | `assembly/batch.ts` batch helpers                                                                                                                                                  |
| ground (unified + platforms)                           | **AS**  | zero-dependency, single-threaded, always loaded (top-level await) | `emscripten/ground.cpp`                                                                                                                                                            |
| physics (player, collision grid, rigid bodies, joints) | **AS**  | same; character-controller ABI                                    | `emscripten/physics.cpp` (keep only the assist-only ABI covered by `test:character-native`)                                                                                        |
| math (ground formula, noise)                           | **AS**  | parity reference; C++ noise already uses a different hash         | `math.cpp` noise / fast-math twins: deleted (#2026 slice 1); it keeps `getGroundHeight` (parity reference) and `batchGroundHeight_simd` (C++ batch fast path)                      |
| discovery                                              | **AS**  | fixed-region spatial grid, single-threaded                        | `emscripten/discovery.cpp`                                                                                                                                                         |

The JS fallback remains for every subsystem: it is what runs when neither
native module loads.

Twins are **deleted**, not kept as mirrors. Each deletion is its own PR:
first a parity test through the production bridge (as `tests/native-batch-parity.test.mjs`
does for ground), then the deletion. This ADR does not delete anything by itself.

## Decision 1b: every export has a caller (#2026 slice 1)

An export with no caller is code we build, ship and keep in sync for nothing,
and a lookup of a name the module does not export is a fallback that always
runs. Both are now checked:

- **The AS ABI is `assembly/index.ts`, listed by name.** `export *` exported
  every helper a module shared with its siblings (`clamp`, `lerp`,
  `jointsOnBodyRemoved`); asc compiles only what the list reaches.
- **The C++ ABI is `ANIMATION_FUNCTIONS` in `emscripten/build.sh`.**
  `EXPORT_KEEPALIVE=1` exports every `EMSCRIPTEN_KEEPALIVE` function whether or
  not it is in `exports.txt`, so `verify:emcc:manifest` fails on a KEEPALIVE
  function that is not declared, and on a declared name with no definition.
- **`npm run check:native-exports`** (in `test:fast`) fails on an export with no
  caller in `src/` or `tests/`, and on a `getNativeFunc('x')`, `ccall('x')` or
  `exports.x` that names nothing. The baseline
  (`scripts/native-exports-baseline.json`) is 0 dead / 0 stale and, like the
  other ratchets, can only go down (`test:baselines`). Tests keep what they
  need: an export only a test calls is allowed and listed with `--list`.

What slice 1 removed, all with zero call sites:

|                                              | before            | after           |
| -------------------------------------------- | ----------------- | --------------- |
| AS function exports                          | 171 (+84 globals) | 80 (+5 globals) |
| `candy_physics.wasm`                         | 69.5 KB           | 45.5 KB         |
| C++ exports (exports.txt + KEEPALIVE)        | 157               | 57              |
| `candy_native_st.wasm` / `candy_native.wasm` | 90 / 398 KB       | 47 / 339 KB     |
| `#pragma omp` sites                          | 32                | 10              |

Deleted: `src/workers/` and its chunk rule, `parallelWasmLoad`, the bootstrap
pthread (`bootstrap_loader.cpp`, which filled a heightmap nothing read),
`mesh_deformation.cpp`, the scalar animation calculators (`animation.cpp`
keeps only the arpeggio step), the percussion / melodic / effects / `*_simd`
batches and `processBatchUniversal_c`, the noise / fast-math twins, the legacy
`physics.cpp` particles, `assembly/ecs.ts` and `assembly/memory.ts`, and the
TS wrappers and bindings that only reached them. The 20 lookups of names the
C++ module never exported (`setGravity`, `createEntity`, `initFluidSolver`, …)
and the `processBatchUniversal_c` / `batch*_c` lookups on the **AS** instance
in `foliage-batcher-core.ts` (AS pointers, so the C++ path could never have
worked) are gone.

## Decision 2: one memory layout, real allocations for everything else

- **AS fixed regions** are declared once, in `scripts/memory-layout.mjs`.
  It generates `assembly/memory_layout.ts` (consumed by AS) and
  `src/utils/native-memory-layout.ts` (consumed by TS). Regions are packed and
  16-byte aligned (layout end 535264).
- **`--memoryBase` = `HEAP_BASE_FLOOR`** (589824, the layout end rounded up to a
  64 KiB page). AS static data, the shadow stack and the TLSF heap all sit above
  every fixed region.
- **JS-owned buffers in AS memory** use the exported `malloc`/`free`
  (`assembly/allocator.ts` → `heap.alloc`/`heap.free`). Those blocks are not GC
  objects, so JS may keep a pointer across frames. Never use `__new` as malloc.
  The runtime is no longer exported (`--exportRuntime` was dropped).
- **C++** has no fixed layout. Every buffer comes from its own `_malloc`, in its
  own linear memory. A pointer from one module is never passed to the other.
  `BoidsBuffer` tags its backend for exactly this reason.

`npm run check:memory-layout` fails on overlapping regions, stale generated
files, a `--memoryBase` that differs from the table, a raw `*_OFFSET = <number>`
in `assembly/` or in the TS files that write into AS memory, and a built binary
whose static data or `__heap_base` falls inside the layout. `tests/wasm.mjs`
(Test 5) fills every region and checks that 200 heap allocations leave all of
them intact.

## Decision 3: growth-safe access by construction

`memory.grow` detaches the old buffer (ST) or leaves cached views with a stale
length (shared memory, MT). The rule: **no TypedArray over native memory is held
across a native call.**

- `src/utils/native-memory.ts` provides `NativeF32`, whose `.view` re-derives from
  the current `memory.buffer` on every access; `asAllocF32` and `emAllocF32`
  return one. `emHeapF32(em)` reads the Emscripten heap fresh and works whether
  or not `HEAPF32` is exported.
- `refreshWasmViews()` rebuilds the legacy `positionView`, `animationView`,
  `outputView` and `playerStateView`. `getEmscriptenMemory()` reads the buffer
  fresh. The `emscriptenMemory` snapshot is kept only for compatibility.

`native-memory.ts` is the start of the typed bridge. New code goes through it.
The remaining `src/utils/wasm-*.ts` `export let` function caches migrate to it
subsystem by subsystem, alongside the twin deletions above.

## Decision 4: loader failure is bounded

`src/utils/native-instantiate.ts` wraps the Emscripten factory. An instantiate
failure, a throwing runtime init, or a hang longer than `NATIVE_INIT_TIMEOUT_MS`
(15 s) rejects. Before this, a failure left the factory promise pending forever
and boot hung. `loadEmscriptenModule` tries MT, then ST, and otherwise stays on
JS (`firstNativeModule`).

## Decision 5: ship what we test

- `npm run build` and `npm run release:stable` build AS + C++ + Vite. The CI
  release workflow (`release-stable.yml`) installs the pinned emsdk, builds both
  native tiers, requires `candy_native*.wasm` in `dist/`, and runs the
  cross-tier parity tests with `CANDY_PARITY_REQUIRE_CPP=1`.
- PR CI (`build:ci`, `test:fast`) builds AS only. C++ is built and
  parity-checked nightly and on tags (`emscripten-verify.yml`).
- COOP/COEP headers are served by both `vite` and `vite preview`, so the smoke
  test and local previews run the MT build (`crossOriginIsolated === true`).
  **The deploy host must send the same two headers**
  (`Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`). Without them production
  silently runs the ST build. This is server configuration outside this repo.

## Toolchain

- **emsdk** is pinned in `.emsdk-version` (4.0.10), which CI, the release
  workflow, `.jules/setup.sh` and `SETUP_GUIDE.md` all read. `build.sh` warns
  on any other version and keeps going; `CANDY_STRICT_EMSDK=1` makes the
  mismatch fatal. Every env knob `build.sh` reads has a default, because it runs
  under `set -u`.
- **Emscripten**: `-O2 -flto -fno-exceptions -msimd128` (MT and ST), `-pthread`
  (not `USE_PTHREADS`), `STACK_SIZE=1MB` (not `TOTAL_STACK`; it is also the
  default pthread stack, and every large C++ buffer is static or heap), no
  `-lembind` (there are no `EMSCRIPTEN_BINDINGS`), and `EXPORTED_RUNTIME_METHODS`
  includes `HEAP8,HEAPU8,HEAP32,HEAPF32`. No `-mrelaxed-simd` (no source uses a
  relaxed intrinsic, and the ST build is the Safari fallback) and no
  `WASM_BIGINT=0` (no export passes i64). There is no separate `wasm-opt` pass:
  `emcc -O2` and `asc --optimize` already run Binaryen. `PTHREAD_POOL_SIZE=4`; `math.cpp` caps the
  OpenMP team at the same size, so `#pragma omp parallel` never waits on
  workers the pool never spawned. emsdk ≥ 3.1.58 emits no `.worker.js`, and the
  loader no longer looks for one.
- **AssemblyScript**: `--enable bulk-memory --memoryBase 589824
--initialMemory 16 --maximumMemory 256`. No `--enable simd`: `assembly/` has no
  `v128` code and the binary is byte-identical without the flag. Prod
  `build:wasm` writes no `.wat` and no source map, so the module carries no
  `sourceMappingURL`; `build:wasm:debug` adds both for local debugging, and
  `npm run check:dist-wasm` fails a `dist/` that ships either. `env.abort`
  throws a decoded message instead of logging and continuing.
- `npm run verify:emcc:manifest` holds the flag set: one `-O` level and one
  `STACK_SIZE` matching `AGENTS.md`, no forbidden flag, a default for every env
  knob, and the prod AS flags above.
- **Housekeeping**: source maps are emitted `hidden` and `deploy.py` skips
  `*.map`. `madge` is a devDependency. Stale `public/candy_physics.*` are
  removed before every Vite build (`scripts/clean-public-artifacts.mjs`).

## Open items

- **MT fixed memory.** Growth combined with SharedArrayBuffer slows JS heap
  access (`-Wpthreads-mem-growth`). Views are now growth-safe, so fixing the MT
  heap size is purely a perf decision. Measure peak heap first, then consider
  `INITIAL_MEMORY == MAXIMUM_MEMORY` for MT.
- **`emscripten/vendor/libomp.a`** is still a tracked prebuilt archive.
  Rebuild it from LLVM `openmp/` in `emscripten-verify.yml`, or switch to
  emsdk's own OpenMP port once one ships, then untrack it.
- **Twin deletions** per Decision 1, each behind a bridge-level parity test
  (#2026 slice 2: one owner per subsystem, a parity test per row).
- **Incremental C++ builds.** `build.sh` still compiles every unit in one
  `em++` call per variant (MT and ST). Slice 1 cut a full `build:emcc` from
  about 55 s to 24 s; per-TU objects (Makefile/Ninja) would make a one-file edit
  cheaper still.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Candy World** is a 3D interactive WebGPU experience featuring a pastel candy-colored landscape with smooth, glossy organic shapes. Built with Three.js, TypeScript, and WebAssembly for performance-critical systems.
The primary play experience is first-person: click to pointer-lock, use mouse-look + WASD, and trigger movement abilities from within the world.

### Key Technologies

- **Rendering**: Three.js with WebGPU renderer and TSL (Three.js Shading Language)
- **Build System**: Vite (no plugins: WASM loads through Vite's built-in `?init` import, and the `es2022` target keeps top-level await)
- **Language**: TypeScript (strict mode)
- **Performance**: AssemblyScript compiled to WASM for physics and particle simulation
- **Testing**: Playwright for smoke/boot tests, Node.js (`node`/`tsx`) suites aggregated in `npm run test:fast`
- **Browser Support**: WebGPU (Chrome 113+, Edge 113+) is preferred; without it the world falls back to WebGL2 via `WebGPURenderer({ forceWebGL: true })` with reduced effects

## Development Commands

### Common Workflows

```bash
# Development (includes WASM build, serves on http://localhost:5173)
npm run dev

# Full production build (WASM + Emscripten + Vite)
npm run build

# Preview production build locally
npm run preview

# Tests (see Testing section below)
npm run test:fast          # PR gate: build:wasm + all node-only suites + repo-integrity guards (~20s, no browser)
npm run test:wasm          # Fast WASM particle physics test (~2s)
npm run test               # Smoke test - boot sequence (~2-3m, needs dist/)
npm run test:integration   # test:fast + vite build + smoke + fast smoke

# Ratchets (committed baselines; may only go down)
npm run typecheck          # tsc vs scripts/tsc-baseline.json
npm run lint               # ESLint problem count vs scripts/eslint-baseline.json
npm run test:cycles        # runtime import cycles vs scripts/cycles-baseline.json

# WASM & build tools
npm run build:wasm         # Compile AssemblyScript
npm run build:ci           # WASM + Vite only (no Emscripten)
npm run build:emcc         # Emscripten build
npm run verify:emcc        # Verify Emscripten exports
```

### Optimization Tools

```bash
npm run optimize           # Run all optimizations
npm run optimize:assets    # Asset optimization only
npm run analyze            # Bundle analysis
npm run budget             # Check size budget
npm run generate:map       # Generate map data
```

## Architecture & Code Organization

### Core Entry Point: `src/core/main.ts`

`index.html` loads `src/main.ts`, which imports `core/game-loop.ts` and `core/main.ts`; the latter calls `runBootstrap()` (`src/core/main/bootstrap.ts`). The pipeline runs `scene-pipeline` → `audio-world-pipeline` → `input-pipeline` → `wasm-pipeline`, then shader warmup; world generation and deferred visuals run after the player presses Enter (`start-screen.ts`). Every step is a named stage run through `runBootStage()` — stage order, dependencies and critical flags live in `src/debug/boot-registry.ts`; `?halt=1` / `?boot=scene|sandbox|limited|standard|full` / `?bootfail=<stage>` turn it into a debugging tool. See `docs/PROGRESSIVE_BOOT.md`.

The `scene`, `camera`, `renderer`, `player`, `addCameraShake` singletons are exported from `src/core/main/exports.ts` (not from `main.ts`).

### Directory Structure

#### `/src/core` — Core Systems

- **`main.ts`** + **`main/`**: Entry point and the staged bootstrap pipelines
- **`game-loop.ts`** (+ `game-loop-*.ts` per subsystem): Animation loop, frame timing, delta calculations
- **`hud.ts`**: Heads-up display, day/night toggle, theme updates
- **`config.ts`** + **`config/`**: Global configuration (palette, audio, season, post-FX, URL flags, …)
- **`init.ts`**: Scene creation (camera, renderer, lights, fog)
- **`deferred-init.ts`**: Post-startup warmup and visual initialization
- **`input/`**: Keyboard/mouse input handling

#### `/src/systems` — Game Systems (Modular)

- **`physics/`**: Collision, movement, ground height queries, rigid/soft bodies, joints, character controller (includes `physics-grids.ts` for spatial indexing)
- **`region-manager.ts`**: Chunks/regions, LOD, visibility culling
- **`music-reactivity.ts`**: Audio-driven visual feedback (beat pulses, reactivity)
- **`weather/`**: Weather effects (rain, wind, snow)
- **`interaction.ts`**: Clickable objects, inventory, UI responses
- **`discovery-*.ts`**: Discovery/quest system (persistence, optimization)
- **`accessibility.ts`**: Keyboard navigation, text alternatives
- **`material-batcher.ts`**: Material optimization and batching
- **`performance-budget/`**: Performance monitoring and alerts
- **`living-score.ts`**: One-shot world events fired on tracker pattern-row edges, cues in `assets/score-cues.json` (see `docs/LIVING_SCORE.md`)

#### `/src/rendering` — Graphics & Post-Processing

- Post-processing effects (bloom, depth of field, color grading)
- Material definitions and shader management
- TSL (Three.js Shading Language) shader nodes

#### `/src/foliage` — Content Creation

- **`index.ts`**: Validation and exports
- **`mushrooms.ts`**: Mushroom creation (caps, stems, faces)
- **`trees.ts`**: Tree/vegetation creation
- **`post-processing.ts`**: Visual effects pipeline
- **`*-batcher.ts`**: Optimized rendering for foliage

#### `/src/audio` — Audio System

- **`audio-system.ts`**: Web Audio API wrapper, playback control
- **`beat-sync.ts`**: Beat detection and synchronization
- Music reactivity integration

#### `/src/world` — World Generation

- **`generation.ts`**: Terrain, chunk generation, heightmap
- **`state.ts`**: World state, foliage tracking, animation state

#### `/src/gameplay` — Gameplay Mechanics

- **`rainbow-blaster.ts`**, `jitter-mines.ts`, `chord-strike.ts`, `harpoon-line.ts`: Weapon/ability systems (lazy-loaded via `lazy.ts`)
- Glitch grenade lives in `src/systems/glitch-grenade.ts`

#### `/src/particles` — Particle Systems

- GPU-accelerated particle systems
- Bounds validation (matches WASM physics bounds)

#### `/src/compute` — GPU Compute Shaders

- Compute shader implementations for performance-critical tasks

#### `/src/utils` — Utilities

- **`wasm-loader.ts`**: WASM initialization and ground height queries
- **`profiler.ts`**: Performance profiling
- **`startup-profiler.ts`**: Boot sequence instrumentation

#### `/src/ui` — User Interface

- **`loading-screen.ts`**: Progress tracking during boot
- **`webgpu-fatal.ts`** / **`boot-fatal.ts`**: Boot failure diagnostics screens
- UI components and overlays

#### `/src/debug` — Debug panel and boot staging

- **`boot-registry.ts`**, **`progressive-bootstrap.ts`**, **`stages.ts`**: progressive boot stages (see above)

#### `/assembly` — WebAssembly (AssemblyScript)

- **`physics.ts`**: Particle physics simulation (bounds: X±128, Y[-100,500], Z±128)
- **`constants.ts`**: Physics and memory constants
- **`particles.ts`**: Particle spawning and lifecycle
- **`animation.ts`**: Animation calculations
- **`foliage.ts`**: Foliage data structures
- Also `ground.ts`, `rigidbody.ts`, `joints.ts`, `boids.ts`, `ecs.ts`, `music_reactivity.ts`, batch/material helpers (re-exported from `index.ts`)

### Build & Bundling Strategy

**Vite Config** (`vite.config.js`) uses a `manualChunks(id)` function for code-splitting. Main buckets:

- `vendor` — Three.js and dependencies (`gltf-loader` split out ahead of it)
- `app` — core boot, audio, boot UI, and `weather` (kept static to avoid a chunk-cycle deadlock)
- `workers` — Web Workers
- Lazy chunks reached only via `import()` from thin `*lazy.ts` stubs: `gameplay`, `save-ui`, `accessibility-ui`, `debug`, `presence`, `photo-mode`, `map-loader`, `postfx-*`, `shader-warmup`, `clustered-lights`, `generative-music`, `world-content`, …

Adding a module to a static import path from `app` can pull a lazy chunk back into the boot bundle; see `docs/APP_CHUNK_SPLIT.md`.

## Development Patterns

### Physics & Collision

Ground height queries:

```typescript
// Fast WASM-backed query (cached, spatial grid)
import { getUnifiedGroundHeightTyped } from '../systems/physics/physics-math.ts';
const height = getUnifiedGroundHeightTyped(x, z);

// Alternative (direct WASM call, synchronous)
import { getGroundHeight } from '../utils/wasm-loader.ts';
const height = getGroundHeight(x, z);
```

Physics grid: Spatial indexing for collision checks. Update grid after moving objects:

```typescript
import { populatePhysicsGrids } from '../systems/physics/index.ts';
populatePhysicsGrids(); // Called in main initialization
```

### Material & Geometry Creation

Reuse geometries and materials for performance:

```typescript
// ❌ Avoid repeated geometry creation
for (let i = 0; i < 100; i++) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
}

// ✓ Create once, reuse
const sharedGeo = new THREE.BoxGeometry(1, 1, 1);
const meshes = Array.from({ length: 100 }, () => new THREE.Mesh(sharedGeo, mat));
```

Use `clearcoat` materials for the candy aesthetic:

```typescript
const material = new THREE.MeshPhysicalMaterial({
    color: 0xff69b4, // Pastel pink
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
});
```

### Animation Storage

Store animation metadata in `userData`:

```typescript
mesh.userData.animationType = 'bounce'; // or 'rotate', 'drift', etc.
mesh.userData.animationOffset = Math.random() * Math.PI * 2; // Desynchronize
mesh.userData.animationSpeed = 1.0;
```

The game loop reads these in `game-loop.ts` during animation updates.

### Async Initialization

Use deferred initialization for heavy work post-boot:

```typescript
import { initDeferredVisuals, initDeferredVisualsDependencies } from '../core/deferred-init.ts';
// Runs after scene is visible, doesn't block initial load
```

### Profiling & Performance

Enable startup profiler:

```typescript
import { enableStartupProfiler } from '../utils/startup-profiler.ts';
enableStartupProfiler({ enableConsole: true, saveToFile: true });

// Mark phases
import { startPhase, endPhase } from '../utils/startup-profiler.ts';
startPhase('my-phase');
// ... work ...
endPhase('my-phase');
```

Check performance budget:

```bash
npm run budget:check  # Verify chunk size constraints
```

## Testing

### WASM Physics Test (`npm run test:wasm`)

- Verifies particle physics stays within world bounds
- Bounds: X[±128], Y[-100, 500], Z[±128]
- File: `tests/wasm.mjs`
- Duration: ~2 seconds
- Run: `node tests/wasm.mjs` (requires built WASM)

### Smoke Test (`npm run test`)

- Boots the full application in Chromium with WebGPU enabled
- Checks for console errors during initialization
- Verifies `window.__sceneReady` flag
- File: `tests/smoke-runner.mjs`
- Duration: ~2–3 minutes (includes shader warmup, world gen)
- Run: Requires `dist/` folder; builds if missing

### Fast Suite (`npm run test:fast`) — the PR gate

- `build:wasm` then every node-only suite (physics, parity, boot stages, lights, seasons, …) plus repo-integrity guards (`test:docs-symbols`, `test:plan-integrity`, `test:foliage-barrel`, `test:cycles`, `test:baselines`)
- Runs in `.github/workflows/node-protocol-tests.yml`; no browser, ~20s
- New node-only suites must be added to the `test:fast` chain or they run nowhere. See `docs/CI_CONTRACT.md`

### Full Integration Test (`npm run test:integration`) — local/nightly only

1. `npm run test:fast`
2. `vite build`
3. `npm run test` (smoke) and `npm run test:smoke:fast`

**Requirements**: Node 24+ (`engines`), Playwright installed, Chromium with WebGPU enabled (Chrome 113+)

## Configuration & Constants

### Global Config (`src/core/config.ts`)

- Color palette
- Physics grid dimensions and bounds
- Audio settings (script processor node vs audio worklet)
- Debug flags (profiler, accessibility)

### Physics Constants (`assembly/constants.ts`)

- Particle world bounds (sync with test expectations)
- Memory layout for WASM
- Grid dimensions

### Compile Flags (toolchain contract)

- **AssemblyScript** (`build:wasm`): linear-memory MVP + `--enable simd --enable bulk-memory`, `--initialMemory 5 --maximumMemory 256`. No `asconfig.json`, so no `--target`; `--enable gc` (Wasm GC) is not used.
- **Emscripten** (`emscripten/build.sh`): `-O2` for compile and link, MT and ST. Do not pass `-s MINIFY_WASM_IMPORTS_AND_EXPORTS` (internal setting; emcc rejects it). `npm run verify:emcc:manifest` enforces the `-O` level against `AGENTS.md`.
- **WebGPU** is preferred; a failed boot probe falls back to WebGL2 (badge shows `WEBGL2 FALLBACK`, no GPU compute). Device limits are adapter-clamped, and the canvas `colorSpace` matches `outputColorSpace` — see `docs/WEBGPU_CONTEXT.md` and `docs/webgl-fallback.md`.

### Map/World Constants (`src/world/generation-utils.ts`)

- `DEFAULT_MAP_CHUNK_SIZE` — Map chunk size (default: 100)
- Fog distances are derived at runtime from camera/altitude/day-night (`src/systems/atmosphere-fog.ts`)

## TypeScript & Linting

- **Target**: ES2022 (output and modules)
- **Mode**: Strict (`strict: true` in tsconfig.json)
- **Module resolution**: `bundler` (Vite-compatible)
- **No comments on config options**: Trust TypeScript's strict checking

**Type checking and lint run in CI as ratchets** (`typecheck.yml`, `lint.yml`): `npm run typecheck` (tsc errors, baseline 0) and `npm run lint` (ESLint problem count) compare against committed baselines in `scripts/*-baseline.json`. Baselines may only go down — `npm run test:baselines` fails a PR that raises one; lower them with `npm run lint -- --update` after fixing. A `simple-git-hooks` pre-commit runs Prettier on staged files.

## Git & Branching

- **Main branch**: `main` (production-ready)
- **Commit messages**: Describe the _why_, not the _what_. Reference issues if applicable.
- **Pull requests**: Squashed or rebased; comprehensive test results required before merge.

## Stable Builds

Known-good builds are `stable-YYYY-MM-DD[-label]` tags + GitHub Releases + `candy-world/stable/` on storage.noahcohn.com. Promote with `npm run release:stable -- <label>` from a clean `main` after a browser walk-around. If the full world won't boot, `?preset=minimal` is safe mode. See `docs/RELEASES.md`.

## Common Issues & Troubleshooting

### WebGPU Not Available

- Requires Chrome/Edge 113+ (or newer with experimental features enabled)
- Integrated GPUs may not support WebGPU; use a discrete GPU for testing
- Check `chrome://gpu` for WebGPU status

### WASM Import Failures

- Ensure `npm run build:wasm` completes successfully
- Check `src/wasm/candy_physics.wasm` exists
- Top-level await requires the `es2022` build target (set in `vite.config.js` and `tsconfig.json`)

### Long Boot Times

- First run after `npm run build`: Shader compilation (~30–60s), world generation (~20–30s)
- Subsequent runs are faster (caches warm)
- Check profiler output for bottlenecks: `enableStartupProfiler({ saveToFile: true })`

### Physics Grid Misalignment

- After moving many objects, call `populatePhysicsGrids()`
- Grid dimensions are `GRID_COLS`/`GRID_ROWS`/`GRID_CELL_SIZE` in `assembly/constants.ts`

### Audio Worklet Issues

- Fallback to `ScriptProcessorNode` is automatic if worklet fails
- Enable debug logging: `CONFIG.audio.useScriptProcessorNode = true` (forces fallback)

## Performance & Optimization

### Key Metrics

- Target: 60 FPS on WebGPU-capable hardware
- Budget: ~500KB per chunk (`chunkSizeWarningLimit` in vite.config.js; enforced budgets in `tools/build-optimizer`)

### Optimization Techniques

- **Code splitting**: Lazy-load gameplay, save/debug/accessibility UI, post-FX and other heavy modules via `*lazy.ts` stubs
- **Material batching**: `src/systems/material-batcher.ts` combines materials
- **Region culling**: `src/systems/region-manager.ts` hides distant regions
- **Particle bounds**: WASM enforces world bounds; particles beyond are recycled

### Profiling

```bash
npm run analyze           # Bundle composition
npm run analyze:bundle   # Size breakdown
npm run budget:check     # Verify size constraints
npm run optimize        # Apply all optimizations (experimental)
```

## Adding New Features

### New Foliage Element

1. Create factory in `src/foliage/` (e.g., `createCactus()`)
2. Define material (use `MeshPhysicalMaterial` with clearcoat for candy look)
3. Create geometry using Three.js primitives or custom shapes
4. Add animation metadata to `userData` if needed
5. Export and import in `src/world/generation.ts`
6. Tune color/size in `src/core/config.ts` (if global)

### New Game System

1. Create file in `src/systems/` (e.g., `my-system.ts`)
2. Export initialization function
3. Hook into game loop in `src/core/game-loop.ts` or deferred init
4. Add to code-split chunk if heavy (edit `vite.config.js` manual chunks)
5. Don't introduce runtime import cycles — `npm run test:cycles` fails on any new one

### Music

Music is tracker modules (MOD/XM/IT/S3M) played by libopenmpt in an AudioWorklet (`src/audio/`); there are no `.mp3`/`.ogg` tracks. Continuous reactivity is bound in `assets/music-bindings.json`; row-exact one-shot events go in `assets/score-cues.json` (Living Score). See AGENTS.md → Music Reactivity.

## Further Reading

- **Tests**: `tests/README.md` — Detailed test documentation
- **Copilot Instructions**: `.github/copilot-instructions.md` — Visual style, materials, TSL usage
- **Map Generation**: `tools/map-generator/` — Custom terrain generation tool
- **Visual Regression**: `tools/visual-regression/` — Visual testing infrastructure

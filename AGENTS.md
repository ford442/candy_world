# AGENTS.md

## Project Overview

**Candy World** (also known as "Siphon Part I") is a 3D nature exploration experience featuring a pastel candy-colored landscape with smooth, glossy graphics. It is a WebGPU-based interactive world with procedurally generated terrain, animated foliage (trees, mushrooms, flowers, clouds), dynamic weather systems, day/night cycles, music reactivity, and first-person physics-based movement.

### Key Features
- **WebGPU Rendering**: Modern GPU API for high-performance 3D graphics using Three.js
- **Hybrid WASM Architecture**: Dual WebAssembly modules for physics and compute
- **Procedural Generation**: Dynamic terrain, foliage placement, and environmental effects
- **Audio Reactivity**: MOD/XM/IT/S3M music playback with visual reactivity
- **Dynamic Weather**: Rain, storms, and atmospheric effects with seasonal cycles
- **Interactive Gameplay**: First-person exploration with physics-based movement, abilities (dash, jitter mine, phase shift), and a tracker-pattern music HUD

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Rendering | Three.js ^0.171.0 + WebGPU | 3D graphics with `MeshPhysicalMaterial` for candy gloss |
| Build System | Vite ^5.0.0 | Module bundling, dev server, and production builds |
| Language | TypeScript ^5.9.3 (ES2020 target, ES2022 modules) | Application source code |
| Physics (Required) | AssemblyScript ^0.27.37 → WASM | Stateful physics, collision detection, spatial grid |
| Compute (Optional) | C++17 + Emscripten → WASM | SIMD-optimized math, animations, particle physics, mesh deformation |
| Audio | libopenmpt.js | Module music playback (.mod, .xm, .it, .s3m) |
| Styling | CSS3 | UI themes, animations, responsive design |
| Testing | Playwright + custom Node.js test runners | Smoke tests, WASM bounds tests, visual regression |
| Package Manager | pnpm (primary) / npm | Dependency management (`pnpm-lock.yaml` present) |

---

## Directory Structure

```
/root/candy_world/
├── src/                          # Main TypeScript source
│   ├── audio/                    # Audio system, beat sync
│   ├── compute/                  # GPU compute shaders (TSL), mesh deformation, particles, noise
│   ├── core/                     # Config, input handling, scene init, game loop, HUD, deferred init
│   │   └── input/                # Input handling, audio controls, playlist manager
│   ├── foliage/                  # Trees, mushrooms, flowers, clouds, sky, terrain, water, wind
│   │   └── batcher/              # Foliage batching sub-systems
│   ├── gameplay/                 # Rainbow blaster, jitter mines, harpoon line, chord strike
│   ├── particles/                # GPU and CPU particle systems, compute shaders
│   │   └── shaders/              # Particle shader code
│   ├── rendering/                # Materials, culling system, shader warmup, WebGPU limits
│   │   └── culling/              # Culling types, components, and system
│   ├── systems/                  # Physics, weather, music reactivity, unlocks, analytics
│   │   ├── adapters/             # Legacy adapter types
│   │   ├── analytics/            # Analytics core, types, performance tracking
│   │   ├── asset-streaming/      # Asset streaming infrastructure and types
│   │   ├── interfaces/           # Shared interfaces (e.g., IParticleSystem)
│   │   ├── performance-budget/   # Performance budget core, overlay, types
│   │   ├── physics/              # Physics states, types, abilities
│   │   ├── save-system/          # Save types, database, system implementation
│   │   └── weather/              # Weather atmosphere, effects, ecosystem
│   ├── types/                    # Global TypeScript type definitions
│   ├── ui/                       # Loading screen, accessibility menu, toasts, announcer, save menu
│   │   └── save-menu/            # Save menu styles, slots, settings
│   ├── utils/                    # WASM loader barrel, profiler, geometry dedup, startup profiler
│   ├── wasm/                     # WASM bindings, type definitions, compiled candy_physics.wasm
│   ├── workers/                  # Web Workers for physics and world generation
│   ├── world/                    # World generation, state management
│   ├── accessibility-index.ts    # Accessibility system entry point
│   └── main.ts                   # Application entry point (re-exports from core)
├── assembly/                     # AssemblyScript source (physics module)
│   ├── index.ts                  # Module exports
│   ├── physics.ts                # Collision detection, spatial grid
│   ├── animation.ts              # Animation calculations
│   ├── animation_batch.ts        # Batch animation operations
│   ├── batch.ts                  # Batch operations
│   ├── constants.ts              # Memory layout constants
│   ├── discovery.ts              # Discovery system logic
│   ├── foliage.ts                # Foliage-specific helpers
│   ├── material_batch.ts         # Material batching
│   ├── math.ts                   # Math utilities
│   ├── memory.ts                 # Memory management
│   └── particles.ts              # Particle physics
├── emscripten/                   # C++ source (compute/animations)
│   ├── animation.cpp             # Animation functions
│   ├── animation_batch.cpp       # Batch animation functions
│   ├── batch.cpp                 # Batch distance culling
│   ├── bootstrap_loader.cpp      # Bootstrap / shader warmup progress
│   ├── fluid.cpp                 # Fluid simulation
│   ├── lod_batch.cpp             # LOD matrix batch updates
│   ├── math.cpp                  # Math utilities (noise, hash, SIMD, OpenMP)
│   ├── mesh_deformation.cpp      # Mesh deformation
│   ├── particle_physics.cpp      # Particle systems
│   ├── physics.cpp               # Physics computations
│   └── build.sh                  # Build script with conditional exports
├── tools/                        # Build and optimization tools
│   ├── build-optimizer/          # Bundle analysis, tree-shaking audit, compression benchmark
│   ├── map-generator/            # Procedural map generation CLI
│   └── visual-regression/        # Playwright-based visual regression tests
├── test/                         # Manual TS compilation / integration tests
├── tests/                        # Smoke tests, WASM tests, accessibility tests
├── docs/                         # Architecture and feature documentation
├── public/                       # Static assets, compiled WASM
├── dist/                         # Vite production build output
├── index.html                    # Main HTML with UI, import maps, loading screen
├── vite.config.js                # Vite configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # npm scripts and dependencies
├── pnpm-lock.yaml                # pnpm lockfile (primary package manager)
└── deploy.py                     # SFTP deployment script
```

---

## Build Commands

### Development
```bash
# Standard development (runs dev.sh; attempts Emscripten build, then Vite)
npm run dev

# If you do not have Emscripten installed, the Emscripten step skips gracefully
```

### Production Build
```bash
# Full production build (AssemblyScript WASM + Emscripten C++ WASM + Vite)
npm run build

# Full production build with post-WASM optimization (requires wasm-opt)
npm run build:optimized
```

### Specific Build Steps
```bash
# Build AssemblyScript physics module only
# Output: src/wasm/candy_physics.wasm + .wat + source map
npm run build:wasm

# Build C++ native module only (requires Emscripten in PATH)
# Outputs both multi-threaded (public/candy_native.*) and single-threaded (public/candy_native_st.*)
npm run build:emcc

# Optimize WASM binaries (requires wasm-opt / wasmedge; runs tools/build-optimizer)
npm run optimize
npm run optimize:assets
npm run optimize:split

# Analyze bundle size, tree-shaking, and compression
npm run analyze
npm run analyze:bundle
npm run analyze:treeshake
npm run analyze:compress

# Check performance budgets
npm run budget
npm run budget:check
```

### Map Generation
```bash
# Run the procedural map generator CLI
npx tsx tools/map-generator/cli.ts
# or
npm run generate:map
```

### Testing
```bash
# Smoke test: starts Vite preview, launches Chromium with WebGPU flags,
# waits for window.__sceneReady, and verifies no console errors
npm run test

# WASM particle bounds test: loads candy_physics.wasm in Node.js and
# verifies particle physics stay within world bounds for 100+ frames
npm run test:wasm

# Integration: builds WASM then runs both test suites above
npm run test:integration

# Verify Emscripten exports after a build
npm run verify:emcc
```

### Preview & Deploy
```bash
# Preview production build locally
npm run preview

# Deploy to server via SFTP (requires Python + paramiko)
python3 deploy.py
```

---

## WASM Architecture

### Module 1: AssemblyScript (`candy_physics.wasm`)
- **Purpose**: Stateful physics engine and collision detection
- **Language**: AssemblyScript (TypeScript-like, compiles to WASM)
- **Location**: `assembly/*.ts`
- **Output**: `src/wasm/candy_physics.wasm` (dev), `public/candy_physics.wasm` (prod)
- **Required**: **Yes** — physics will not work without this module

Key capabilities:
- Spatial grid collision system (16×16 cells, 16-unit cells, origin at -128, -128)
- Player physics state management
- Position/animation data batching
- Ground height queries using FBM noise
- Discovery and foliage helper logic
- Particle physics updates and spawn bursts

### Module 2: Emscripten/C++ (`candy_native.wasm`)
- **Purpose**: Stateless compute functions, SIMD-optimized math
- **Language**: C++17 with OpenMP pragmas and SIMD (`-msimd128`, `-mrelaxed-simd`)
- **Location**: `emscripten/*.cpp`
- **Output**:
  - `public/candy_native.js` + `public/candy_native.wasm` (multi-threaded, with pthread)
  - `public/candy_native_st.js` + `public/candy_native_st.wasm` (single-threaded fallback)
- **Required**: **No** — has JavaScript fallbacks for all functions

Key capabilities:
- Animation calculations (bounce, sway, wobble, hop, fiber whip, spiral wave, etc.)
- Math utilities (fast inverse sqrt, noise, hash, SIMD batches)
- Batch distance and frustum culling
- Particle physics updates
- Fluid simulation step
- Mesh deformation (wave, jiggle, wobble)
- Bootstrap loader / shader warmup progress tracking

### Build Behavior
The build system gracefully handles missing Emscripten:
- If `em++` is not found, the build skips C++ compilation and removes stale artifacts
- JavaScript fallbacks are used for all native functions
- The application runs in "JavaScript fallback mode"

---

## Critical Technical Directives

### Emscripten Build Safety
```bash
# Optimization level in emscripten/build.sh is -O3 for speed.
# NOTE: Earlier versions warned against -O3 due to aggressive renaming;
# the current build uses conditional export scanning to avoid linking errors.

# MINIFY_WASM_IMPORTS_AND_EXPORTS=0 is MANDATORY
# Without this, JS glue fails to find env imports

# Assertions are DISABLED by default (ASSERTIONS=0)
# Set CANDY_DEBUG=1 to enable for debugging
```

### WebGPU Requirements
- Chrome 113+, Edge 113+, or WebGPU-enabled browser
- SharedArrayBuffer requires COOP/COEP headers (configured in Vite dev server)
- Uses Three.js WebGPU renderer with TSL (Three.js Shading Language)
- Top-level await in dependencies is preserved by targeting `es2022` / `esnext`

### Memory Layout (AssemblyScript)
The physics module uses a fixed memory layout:
- `POSITION_OFFSET` (0): Object positions array
- `ANIMATION_OFFSET` (4096): Animation state
- `OUTPUT_OFFSET` (8192): Output buffer for batch operations
- `MATERIAL_DATA_OFFSET` (12288): Material data
- `PLAYER_STATE_OFFSET` (16384): Player physics state (8 floats)
- `COLLISION_OFFSET` (16416): Collision object data (up to 4096 objects)
- `GRID_HEADS_OFFSET`: Spatial grid heads (calculated from collision end)
- `GRID_NEXT_OFFSET`: Spatial grid next pointers
- `DYNAMIC_RADII_OFFSET`: Dynamic foliage radii (max 512 plants)

### Security / Runtime Headers
Vite is configured to emit the following headers (required for `SharedArrayBuffer` / pthreads):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

---

## Code Style Guidelines

### TypeScript / JavaScript
- **TypeScript-first**: Almost all application code is in `.ts` files under `src/`
- Use ES2020+ features (top-level await, optional chaining, `const` / `let`)
- Module imports **must** use `.ts` extensions (Vite + `allowImportingTsExtensions` handles resolution)
- Three.js imports via importmap in `index.html` (e.g., `three`, `three/webgpu`, `three/tsl`)
- Target module system is `ES2022` with `bundler` resolution; compilation target is `ES2020`

### AssemblyScript
- Explicit type annotations required (`f32`, `i32`)
- Use `load<T>()` and `store<T>()` for memory access
- Export functions with proper type signatures
- Constants defined in `constants.ts`

### C++
- C++17 standard
- Use `EMSCRIPTEN_KEEPALIVE` for exported functions
- SIMD enabled with `-msimd128 -mrelaxed-simd`
- OpenMP pragmas for parallelization (`#pragma omp parallel for`)

### Visual / Aesthetic Conventions
- **Palette**: Pastel candy colors (e.g., `#FF69B4`, `#87CEFA`, `#98FB98`, `#FFD1DC`)
- **Materials**: Prefer `MeshPhysicalMaterial` with `clearcoat` for glossy surfaces; `MeshStandardMaterial` for matte/ground
- **Roughness**: Low (0.2–0.4) for shiny candy, high (~0.8) for clay-like matte
- **Comments**: Mark uniform/aesthetic values with "Visual Impact" notes so future agents know they define the look
- **Geometry**: Anchor objects at their base by translating geometry after creation; call `computeVertexNormals()` after modification

---

## Testing Strategy

### Active Tests
1. **Smoke Test** (`npm run test` → `tests/smoke-runner.mjs`)
   - Starts Vite preview server on port 4173
   - Launches Chromium with WebGPU/Vulkan flags
   - Navigates to `http://localhost:4173`
   - Waits for `window.__sceneReady === true` (up to 25s)
   - Checks for console errors and canvas initialization
   - Ignores expected 404s for missing Emscripten fallbacks

2. **WASM Bounds Test** (`npm run test:wasm` → `tests/wasm.mjs`)
   - Loads `src/wasm/candy_physics.wasm` directly in Node.js
   - Tests particle update, spawn burst, and extreme velocity scenarios
   - Verifies particles stay within documented world bounds for 100+ frames
   - Validates AssemblyScript memory layout and export signatures

3. **Visual Regression** (`tools/visual-regression/`)
   - Playwright-based screenshot comparison
   - Run via `pnpm run test:visual` inside `tools/visual-regression/`
   - GitHub Actions workflow (`.github/workflows/visual-regression.yml`) runs on pushes to `main`/`develop` and PRs to `main`
   - Supports viewpoints (`spawn`, `lake`, `forest`) and quality tiers (`medium`, `high`)

4. **Accessibility Tests** (`tests/accessibility-test.ts`)
   - TypeScript compilation and logic verification for the accessibility system
   - Tests color-blind modes, motion reduction, and announcer utilities

5. **Manual Compilation Tests** (`test/`)
   - `test/culling-system.test.ts` — verifies culling system exports and constants
   - `test/analytics-integration-test.ts` — verifies analytics event types
   - `test/plant-pose-machine.test.ts` — plant pose machine logic verification

### CI / GitHub Actions
- **Visual Regression**: Triggered on `src/**`, `assets/**`, or workflow changes. Uploads diffs/reports as artifacts. Baselines are updated manually via PRs.
- pnpm is used in CI for dependency installation.

---

## Deployment Process

1. **Build**: `npm run build` creates optimized `dist/` folder
2. **Verify**: Run `npm run test` and `npm run test:wasm` before deploying
3. **Deploy**: `python3 deploy.py` uploads via SFTP

### Deployment Configuration (deploy.py)
- Target: `test.1ink.us/candy-world`
- Method: SFTP via paramiko
- Local source: `dist/`
- Uploads recursively preserving directory structure

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CANDY_DEBUG` | Enable Emscripten assertions | `0` |
| `SKIP_VERIFY` | Skip post-build verification | `0` |

---

## Key Dependencies

### Runtime
- `three` (^0.171.0) — 3D rendering engine (WebGPU + TSL)
- `libopenmpt.js` — Module music player (loaded via script tag in `index.html`)

### Build
- `assemblyscript` (^0.27.37) — AssemblyScript compiler
- `vite` (^5.0.0) — Build tool and dev server
- `typescript` (^5.9.3) — Type checking
- `vite-plugin-wasm` — WASM support in Vite
- `vite-plugin-top-level-await` — Top-level await support

### Development / Testing
- `@playwright/test` — E2E and visual regression testing
- `playwright` — Browser automation
- `tsx` — TypeScript execution for CLI tools and tests

---

## Documentation Standards

When implementing large visual changes:
1. Create a technical summary (e.g., `SKY_ENHANCEMENTS.md`)
2. Update `IMPLEMENTATION_SUMMARY.md`
3. Comment code with "Visual Impact" notes where uniform values define aesthetics

### Existing Documentation Files
- `README.md` — Human-facing project overview and quick start
- `SETUP_GUIDE.md` — Development environment setup and Emscripten installation
- `IMPLEMENTATION_SUMMARY.md` — Feature implementation history
- `PERFORMANCE_MIGRATION_STRATEGY.md` — WASM migration guidelines (includes the "15% Rule")
- `SKY_ENHANCEMENTS.md` — Sky/weather system details
- `WEATHER_INTEGRATION_SUMMARY.md` — Weather system architecture
- `docs/` — Additional deep-dive docs (analytics, compute particles, culling, map generation, save system, wind optimization, accessibility, asset streaming, etc.)

---

## Troubleshooting

### "em++ not found"
Install Emscripten or work in JavaScript fallback mode. See `SETUP_GUIDE.md` for installation steps. The build will not fail; it simply skips the native module.

### WebGPU not available
Requires Chrome/Edge 113+ with WebGPU enabled. Check `chrome://flags`.

### SharedArrayBuffer errors
Ensure COOP/COEP headers are set (handled by Vite dev server in `vite.config.js`).

### WASM build failures
Clean and rebuild:
```bash
rm -rf public/*.wasm public/candy_native*.js
cd src/wasm && rm -f candy_physics.wasm candy_physics.wat
cd ../..
npm run build
```

### TypeScript import errors
Imports must use `.ts` extensions (e.g., `import { foo } from './bar.ts'`). Vite's bundler resolution handles this; do not omit the extension.

### Smoke test fails with timeout
The smoke test waits up to 25 seconds for `window.__sceneReady`. If it times out, check the browser console for shader compilation errors or WASM initialization failures.

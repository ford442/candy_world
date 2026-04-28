# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Candy World** is a 3D interactive WebGPU experience featuring a pastel candy-colored landscape with smooth, glossy organic shapes. Built with Three.js, TypeScript, and WebAssembly for performance-critical systems.

### Key Technologies

- **Rendering**: Three.js with WebGPU renderer and TSL (Three.js Shading Language)
- **Build System**: Vite (with WASM and top-level await plugins)
- **Language**: TypeScript (strict mode)
- **Performance**: AssemblyScript compiled to WASM for physics and particle simulation
- **Testing**: Playwright for smoke/boot tests, Node.js for WASM tests
- **Browser Support**: Chrome 113+, Edge 113+, or browsers with WebGPU enabled

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
npm run test:wasm          # Fast WASM particle physics test (~2s)
npm run test               # Smoke test - boot sequence (~2-3m)
npm run test:integration   # Full test pipeline

# WASM & build tools
npm run build:wasm         # Compile AssemblyScript
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

The initialization pipeline:
1. **Phase 1**: Scene setup (camera, renderer, post-processing, lighting)
2. **Phase 2**: Audio & weather systems initialization
3. **Phase 3**: World generation (terrain, foliage, props)
4. **Phase 4**: Game loop start

Exports: `scene`, `camera`, `renderer`, `player`, `addCameraShake`

### Directory Structure

#### `/src/core` — Core Systems
- **`main.ts`**: Entry point, initialization pipeline, loading screen
- **`game-loop.ts`**: Animation loop, frame timing, delta calculations
- **`hud.ts`**: Heads-up display, day/night toggle, theme updates
- **`config.ts`**: Global configuration (colors, physics bounds, grid settings)
- **`init.js`**: Scene creation (camera, renderer, lights, fog)
- **`deferred-init.ts`**: Post-startup warmup and visual initialization
- **`input/`**: Keyboard/mouse input handling

#### `/src/systems` — Game Systems (Modular)
- **`physics/`**: Collision, movement, ground height queries (includes `physics-grid.ts` for spatial indexing)
- **`region-manager.ts`**: Chunks/regions, LOD, visibility culling
- **`music-reactivity.ts`**: Audio-driven visual feedback (beat pulses, reactivity)
- **`weather/`**: Weather effects (rain, wind, snow)
- **`interaction.ts`**: Clickable objects, inventory, UI responses
- **`discovery-*.ts`**: Discovery/quest system (persistence, optimization)
- **`accessibility.ts`**: Keyboard navigation, text alternatives
- **`material-batcher.ts`**: Material optimization and batching
- **`performance-budget/`**: Performance monitoring and alerts

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
- **`rainbow-blaster.ts`**: Weapon/ability systems
- **`glitch-grenade.ts`**: Special effects

#### `/src/particles` — Particle Systems
- GPU-accelerated particle systems
- Bounds validation (matches WASM physics bounds)

#### `/src/compute` — GPU Compute Shaders
- Compute shader implementations for performance-critical tasks

#### `/src/utils` — Utilities
- **`wasm-loader.js`**: WASM initialization and ground height queries
- **`profiler.js`**: Performance profiling
- **`startup-profiler.ts`**: Boot sequence instrumentation

#### `/src/ui` — User Interface
- **`loading-screen.ts`**: Progress tracking during boot
- UI components and overlays

#### `/assembly` — WebAssembly (AssemblyScript)
- **`physics.ts`**: Particle physics simulation (bounds: X±128, Y[-100,500], Z±128)
- **`constants.ts`**: Physics and memory constants
- **`particles.ts`**: Particle spawning and lifecycle
- **`animation.ts`**: Animation calculations
- **`foliage.ts`**: Foliage data structures

### Build & Bundling Strategy

**Vite Config** (`vite.config.js`) uses manual chunking for code-splitting:
- `vendor` — Three.js and dependencies
- `compute` — GPU compute shaders
- `audio` — Audio system (lazy-loaded)
- `gameplay` — Gameplay mechanics
- `weather` — Weather effects
- `ui` — UI components
- `utils` — Utilities and loaders
- `foliage` — Large foliage module set
- `workers` — Web Workers
- `world` — World generation
- `main` — Core app code

This structure prioritizes loading the core scene first, with heavy systems (audio, compute, foliage) lazy-loaded.

## Development Patterns

### Physics & Collision

Ground height queries:
```typescript
// Fast WASM-backed query (cached, spatial grid)
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';
const height = getUnifiedGroundHeightTyped(x, z);

// Alternative (direct WASM call)
import { getGroundHeight } from '../utils/wasm-loader.js';
const height = await getGroundHeight(x, z);
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
  color: 0xFF69B4, // Pastel pink
  roughness: 0.3,
  metalness: 0.0,
  clearcoat: 0.8,
  clearcoatRoughness: 0.2
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

### Full Integration Test (`npm run test:integration`)
1. Builds WASM: `npm run build:wasm`
2. Runs WASM test: `npm run test:wasm`
3. Runs smoke test: `npm run test`

**CI Requirements**: Node 18+, Playwright installed, Chromium with WebGPU enabled (Chrome 113+)

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

### Map/World Constants (`src/world/generation.ts`)
- `DEFAULT_MAP_CHUNK_SIZE` — Chunk resolution (default: 8)
- Terrain size: 300×300 units
- Fog range: 20–100 units

## TypeScript & Linting

- **Target**: ES2020 (output), ES2022 (modules)
- **Mode**: Strict (`strict: true` in tsconfig.json)
- **Module resolution**: `bundler` (Vite-compatible)
- **No comments on config options**: Trust TypeScript's strict checking

**Type checking is not run in CI**; tests are behavioral (boot sequence, physics bounds). Rely on pre-commit hooks or IDE integrations for TS errors.

## Git & Branching

- **Main branch**: `main` (production-ready)
- **Commit messages**: Describe the *why*, not the *what*. Reference issues if applicable.
- **Pull requests**: Squashed or rebased; comprehensive test results required before merge.

## Common Issues & Troubleshooting

### WebGPU Not Available
- Requires Chrome/Edge 113+ (or newer with experimental features enabled)
- Integrated GPUs may not support WebGPU; use a discrete GPU for testing
- Check `chrome://gpu` for WebGPU status

### WASM Import Failures
- Ensure `npm run build:wasm` completes successfully
- Check `src/wasm/candy_physics.wasm` exists
- Top-level await requires ES2022+ and Vite's top-level-await plugin

### Long Boot Times
- First run after `npm run build`: Shader compilation (~30–60s), world generation (~20–30s)
- Subsequent runs are faster (caches warm)
- Check profiler output for bottlenecks: `enableStartupProfiler({ saveToFile: true })`

### Physics Grid Misalignment
- After moving many objects, call `populatePhysicsGrids()`
- Grid dimensions defined in `CONFIG.physics.gridDimensions` (src/core/config.ts)

### Audio Worklet Issues
- Fallback to `ScriptProcessorNode` is automatic if worklet fails
- Enable debug logging: `CONFIG.audio.useScriptProcessorNode = true` (forces fallback)

## Performance & Optimization

### Key Metrics
- Target: 60 FPS on WebGPU-capable hardware
- Budget: ~500KB per chunk (configured in vite.config.js)
- Scene complexity: 30 trees, 20 mushrooms, 15 clouds (tunable via CONFIG)

### Optimization Techniques
- **Code splitting**: Lazy-load audio, gameplay, compute modules
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

### New Audio Track
1. Add `.mp3` or `.ogg` to `public/audio/`
2. Load via `AudioSystem.loadTrack(url)`
3. Sync to beat with `BeatSync` if reactive
4. Lazy-load audio module to not block boot

## Further Reading

- **Tests**: `tests/README.md` — Detailed test documentation
- **Copilot Instructions**: `.github/copilot-instructions.md` — Visual style, materials, TSL usage
- **Map Generation**: `tools/map-generator/` — Custom terrain generation tool
- **Visual Regression**: `tools/visual-regression/` — Visual testing infrastructure

# AGENTS.md

## Project Overview

**Candy World** (also known as "Siphon Part I") is a 3D nature exploration experience featuring a pastel candy-colored landscape with smooth, glossy graphics. It is a WebGPU-based interactive world with procedurally generated terrain, animated foliage (trees, mushrooms, flowers, clouds), dynamic weather systems, day/night cycles, and music reactivity.

### Key Features
- **WebGPU Rendering**: Modern GPU API for high-performance 3D graphics using Three.js
- **Hybrid WASM Architecture**: Dual WebAssembly modules for physics and compute
- **Procedural Generation**: Dynamic terrain, foliage placement, and environmental effects
- **Audio Reactivity**: MOD/XM/IT/S3M music playback with visual reactivity
- **Dynamic Weather**: Rain, storms, and atmospheric effects with seasonal cycles
- **Interactive Gameplay**: First-person exploration with physics-based movement

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Rendering | Three.js + WebGPU | 3D graphics with MeshPhysicalMaterial for candy gloss |
| Build System | Vite | Module bundling and dev server |
| Physics (Primary) | AssemblyScript → WASM | Stateful physics, collision detection, spatial grid |
| Compute (Optional) | C++17 + Emscripten → WASM | SIMD-optimized math, animations, particle physics |
| Audio | libopenmpt.js | Module music playback (.mod, .xm, .it, .s3m) |
| Styling | CSS3 | UI themes, animations, responsive design |

---

## Directory Structure

```
/workspaces/candy_world/
├── src/                          # Main TypeScript/JavaScript source
│   ├── audio/                    # Audio system, beat sync
│   ├── compute/                  # GPU compute shaders (TSL)
│   ├── core/                     # Config, input handling, scene init
│   ├── foliage/                  # Trees, mushrooms, flowers, clouds, sky
│   ├── gameplay/                 # Rainbow blaster, jitter mines
│   ├── particles/                # GPU particle systems
│   ├── rendering/                # Materials, rendering utilities
│   ├── systems/                  # Physics, weather, music reactivity, unlocks
│   ├── utils/                    # WASM loader, profiler
│   ├── world/                    # World generation, state management
│   └── wasm/                     # WASM bindings and type definitions
├── assembly/                     # AssemblyScript source (physics)
│   ├── index.ts                  # Module exports
│   ├── physics.ts                # Collision detection, spatial grid
│   ├── animation.ts              # Animation calculations
│   ├── batch.ts                  # Batch operations
│   └── constants.ts              # Memory layout constants
├── emscripten/                   # C++ source (compute/animations)
│   ├── animation.cpp             # Animation functions
│   ├── physics.cpp               # Physics computations
│   ├── particle_physics.cpp      # Particle systems
│   ├── math.cpp                  # Math utilities (noise, hash)
│   └── build.sh                  # Build script with conditional exports
├── tools/                        # Build optimization scripts
│   ├── optimize.sh               # wasm-opt and wasmedge optimization
│   └── generate_map.py           # Map generation utilities
├── verification/                 # Test scripts (Python + Node.js)
├── public/                       # Static assets, compiled WASM
├── assets/                       # Images, splash screen
├── main.js                       # Application entry point
├── index.html                    # Main HTML with UI
└── vite.config.js                # Vite configuration
```

---

## Build Commands

### Development
```bash
# Standard development (AssemblyScript only, JS fallbacks for C++ features)
npm run dev

# Full development with Emscripten (requires emsdk_env.sh sourced)
bash dev.sh
```

### Production Build
```bash
# Full production build (WASM + Emscripten + Optimization + Vite)
npm run build
```

### Specific Build Steps
```bash
# Build AssemblyScript physics module only
npm run build:wasm

# Build C++ native module only (requires Emscripten)
npm run build:emcc

# Optimize WASM binaries (requires wasm-opt, wasmedge)
npm run optimize
```

### Testing
```bash
# Run all verification tests
npm run test

# Test WASM particle bounds
npm run test:wasm

# Test WASM + integration
npm run test:integration

# Verify Emscripten exports
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
- **Required**: Yes - physics will not work without this module

Key capabilities:
- Spatial grid collision system (400x400 world grid)
- Player physics state management
- Position/animation data batching
- Ground height queries using FBM noise

### Module 2: Emscripten/C++ (`candy_native.wasm`)
- **Purpose**: Stateless compute functions, SIMD-optimized math
- **Language**: C++17 with OpenMP pragms for threading
- **Location**: `emscripten/*.cpp`
- **Output**: `public/candy_native.wasm`, `public/candy_native.js`
- **Required**: No - has JavaScript fallbacks for all functions

Key capabilities:
- Animation calculations (bounce, sway, wobble, hop)
- Math utilities (fast inverse sqrt, noise, hash)
- Batch distance culling
- Particle physics updates
- Fluid simulation step

### Build Behavior
The build system gracefully handles missing Emscripten:
- If `em++` is not found, the build skips C++ compilation
- JavaScript fallbacks are used for all native functions
- The application runs in "JavaScript fallback mode"

---

## Critical Technical Directives

### Emscripten Build Safety
```bash
# Optimization level MUST be -O2, NOT -O3
# -O3 causes aggressive renaming that breaks imports

# MINIFY_WASM_IMPORTS_AND_EXPORTS=0 is MANDATORY
# Without this, JS glue fails to find env imports

# Assertions are DISABLED by default (ASSERTIONS=0)
# Set CANDY_DEBUG=1 to enable for debugging
```

### WebGPU Requirements
- Chrome 113+, Edge 113+, or WebGPU-enabled browser
- SharedArrayBuffer requires COOP/COEP headers (configured in Vite)
- Uses Three.js WebGPU renderer with TSL (Three.js Shading Language)

### Memory Layout (AssemblyScript)
The physics module uses a fixed memory layout:
- `POSITION_OFFSET` (0): Object positions array
- `COLLISION_OFFSET` (65536): Collision object data
- `PLAYER_STATE_OFFSET` (327680): Player physics state
- `GRID_HEADS_OFFSET` (360448): Spatial grid heads
- `GRID_NEXT_OFFSET` (368640): Spatial grid next pointers

---

## Code Style Guidelines

### TypeScript/JavaScript
- Use ES2022+ features (top-level await, optional chaining)
- Prefer `const` and `let` over `var`
- Module imports use `.ts` extensions (Vite handles resolution)
- Three.js imports via importmap in index.html

### AssemblyScript
- Explicit type annotations required (`f32`, `i32`)
- Use `load<T>()` and `store<T>()` for memory access
- Export functions with proper type signatures
- Constants defined in `constants.ts`

### C++
- C++17 standard
- Use `EMSCRIPTEN_KEEPALIVE` for exported functions
- SIMD enabled with `-msimd128`
- OpenMP pragmas for parallelization (`#pragma omp parallel for`)

---

## Testing Strategy

### Verification Tests
Located in `verification/`:
- `verify_wasm_particle_bounds.js` - WASM memory bounds checking
- `verify_emcc_exports.js` - Emscripten export validation
- `verify_*.py` - Visual/feature verification scripts

### Test Execution
```bash
# Python-based verification
python3 verification/verify_startup.py
python3 verification/verify_weather.py

# Node.js WASM tests
npm run test:wasm
npm run test:integration
```

---

## Deployment Process

1. **Build**: `npm run build` creates optimized `dist/` folder
2. **Verify**: Run `npm run test` to ensure build integrity
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
- `three` (^0.171.0) - 3D rendering engine
- `libopenmpt.js` - Module music player (loaded via script tag)

### Build
- `assemblyscript` (^0.27.37) - AssemblyScript compiler
- `vite` (^5.0.0) - Build tool
- `typescript` (^5.3.3) - Type checking

### Development
- `@playwright/test` - E2E testing
- `vite-plugin-wasm` - WASM support in Vite
- `vite-plugin-top-level-await` - Top-level await support

---

## Documentation Standards

When implementing large visual changes:
1. Create a technical summary (e.g., `SKY_ENHANCEMENTS.md`)
2. Update `IMPLEMENTATION_SUMMARY.md`
3. Comment code with "Visual Impact" notes where uniform values define aesthetics

Existing documentation files:
- `SETUP_GUIDE.md` - Development environment setup
- `IMPLEMENTATION_SUMMARY.md` - Feature implementation history
- `PERFORMANCE_MIGRATION_STRATEGY.md` - WASM migration guidelines
- `SKY_ENHANCEMENTS.md` - Sky/weather system details
- `WEATHER_INTEGRATION_SUMMARY.md` - Weather system architecture

---

## Troubleshooting

### "em++ not found"
Install Emscripten or work in JavaScript fallback mode. See `SETUP_GUIDE.md`.

### WebGPU not available
Requires Chrome/Edge 113+ with WebGPU enabled. Check `chrome://flags`.

### SharedArrayBuffer errors
Ensure COOP/COEP headers are set (handled by Vite dev server).

### WASM build failures
Clean and rebuild:
```bash
rm -rf public/*.wasm public/candy_native.js
npm run build
```

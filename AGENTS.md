# AGENTS.md

## Project Context
**Candy World** is a 3D nature exploration experience utilizing a hybrid tech stack:
1.  **Rendering:** Three.js with **WebGPU** backend (Standard & Physical materials).
2.  **Physics:** AssemblyScript compiled to WebAssembly (`candy_physics.wasm`).
3.  **Native Effects:** C++ compiled via Emscripten to WebAssembly (`candy_native.wasm`) for SIMD/Multithreaded math and particles.
4.  **Build System:** Vite.

## Directory Map & Languages
* **`/src` (TypeScript/JavaScript):** Core game logic, Three.js scene management, audio, and foliage generation.
* **`/assembly` (AssemblyScript):** Physics engine and collision logic.
    * *Rule:* Any changes here require `npm run build:wasm` to take effect.
* **`/emscripten` (C++17):** High-performance math, noise generation, and heavy particle systems.
    * *Rule:* Uses Pthreads and SIMD. Changes require `npm run build:emcc`.
* **`/tools` (Bash/Python):** Optimization scripts (`optimize.sh`) and map generators.
* **`/public`:** Static assets and compiled WASM binaries.

## Build & Run Instructions

### 1. Development (Daily Driver)
* **Command:** `npm run dev`
* **Action:** Compiles *both* WASM modules (AssemblyScript + Emscripten) and starts the Vite server.
* **Note:** If you only modify JS/TS in `/src`, you can just let Vite HMR handle it. If you touch `.ts` in `/assembly` or `.cpp` in `/emscripten`, you must restart this command or run the specific build step.

### 2. Specific Build Steps
* **Physics Only:** `npm run build:wasm` (Uses `asc`).
* **Native/C++ Only:** `npm run build:emcc` (Runs `./emscripten/build.sh`).
* **Production Build:** `npm run build` (Full pipeline: WASM -> Emscripten -> Optimization -> Vite).

### 3. Deployment
* **Command:** `python3 deploy.py`
* **Action:** Uploads the `dist/` folder to the remote server via SFTP.
* **Requirement:** Ensure `npm run build` has finished successfully before deploying.

## Critical Technical Directives

### Emscripten & C++ (`/emscripten`)
* **Optimization Level:** Keep compilation at `-O2`. Do **NOT** use `-O3` as it causes aggressive renaming that breaks imports.
* **Import Safety:** The flag `-s MINIFY_WASM_IMPORTS_AND_EXPORTS=0` in `build.sh` is **MANDATORY**. Do not remove it, or the JS glue will fail to find `env` imports.
* **Threading:** The project uses `SharedArrayBuffer`. Ensure headers (COOP/COEP) are set correctly if testing on a new server (handled by `vite` in dev).

### WebGPU Rendering
* **Materials:** We use `MeshPhysicalMaterial` for the "candy" glossy look.
* **Shaders:** Custom shaders are written in TSL (Three.js Shading Language) nodes where possible, or standard Three.js materials.
* **Performance:** High object counts (trees/mushrooms) utilize InstancedMesh.

### Post-Build Optimization
* The script `tools/optimize.sh` is critical for production.
* It uses `wasm-opt` (Binaryen) and `wasmedgec` to optimize the binaries.
* *Agent Note:* If `wasm-opt` fails or is missing, the build may exit. Warn the user if tools are missing.

## Documentation Standards
When implementing large visual changes (like the Sky/Sun update), you must:
1.  Create a technical summary (e.g., `SKY_ENHANCEMENTS.md`).
2.  Update `IMPLEMENTATION_SUMMARY.md`.
3.  Ensure code is commented with "Visual Impact" notes where uniform values define aesthetics.

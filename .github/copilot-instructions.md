<!-- Copilot / AI agent instructions for contributors and automated agents -->
# Candy World — AI Coding Agent Instructions

Purpose: Give immediate, actionable context so an AI coding agent can be productive in this repo.

- **Big picture:** This is a browser-based WebGPU 3D demo built with Three.js + Vite. Heavy logic lives in `main.js` and modular files under the project root (`foliage.js`, `candy-materials.js`, `particle-systems.js`, `compute-shaders.js`, `wasm-particles.js`). Native/compiled addons:
  - AssemblyScript module in `assembly/index.ts` -> compiled to `public/build/optimized.wasm` (via `asc`).
  - Optional C++ physics in `src/physics.cpp` -> compiled with `emcc` to `public/build/physics.wasm`.

- **Where to look first:**
  - `index.html` — canvas id `#glCanvas`, startup UI (`#instructions`), and importmap used for direct browser imports.
  - `main.js` — app bootstrap, scene graph, wasm integration, and the place most features are wired together.
  - `wasm-particles.js` and `assembly/index.ts` — the two wasm loading/usage patterns differ; read both when modifying WASM interfaces.
  - `package.json` — dev & build scripts (important for CI or local builds).

- **Build & developer workflows (explicit commands):**
  - Install deps: `npm install`
  - Dev server: `npm run dev` (Vite, serves `index.html` and `public/` files)
  - Full production build: `npm run build` — runs `asc` (AssemblyScript) then attempts an `emcc` build (if available) and then `vite build`.
    - `asc` output: `public/build/optimized.wasm`
    - `emcc` output (if emscripten available): `public/build/physics.wasm` (script checks `./emsdk/emsdk_env.sh` first)
  - Preview production build: `npm run preview`
  - Deploy: `npm run deploy` (runs build then `python3 deploy.py` — note: `deploy.py` currently contains an inline password; treat as secret and do not leak it).

- **WASM notes & gotchas (critical):**
  - Two loading patterns exist:
    - AssemblyScript wasm uses a Vite-friendly import with `?init` in `main.js`: `import wasmInit from './build/optimized.wasm?init'` — call `wasmInit()` to get exports.
    - `wasm-particles.js` fetches `build/optimized.wasm` manually and instantiates it with custom imports. It expects exported functions named `updateParticles` or `_updateParticles`. Check both when changing signatures.
  - Memory handling: code sometimes reads `__heap_base` or falls back to `1024` — be careful when changing allocation assumptions.
  - During dev, Vite serves files from `public/` at the server root; the build script writes to `public/build/` so runtime fetches should be relative to `/build/...`.

- **Testing & verification:**
  - A headless verification exists: `verify_particles.py` (Playwright). It launches Chromium with flags needed to enable WebGPU: `--enable-unsafe-webgpu` and `--use-gl=swiftshader`. Installing Playwright and running a local `npm run dev` is required before running the script.

- **Conventions & patterns specific to this repo:**
  - Visual/material helpers live in `candy-materials.js` and are used per-object (e.g., `createCandyMaterial`, `createGlowingCandyMaterial`). Reuse these helpers rather than creating ad-hoc materials.
  - Procedural content generation is centralized in `foliage.js` and `main.js` — preserve performance-minded patterns: instancing (see `initGrassSystem`) and caps on object counts (`MAX_OBJECTS`).
  - GPU particle systems are separated: WebGPU compute-based (`compute-shaders.js`) vs WASM particle logic (`wasm-particles.js`). Keep those concerns separate when refactoring.

- **Integration & external deps:**
  - `emsdk/` is included for local Emscripten; build scripts source `emsdk_env.sh` if present. If not available, `build:cpp` prints a skip message.
  - Third-party WASM library: libopenmpt is loaded in `index.html` (music support); `AudioSystem` uses it — be mindful of async runtime initialization (`window.libopenmptReady`).

- **Quick hints for common edits:**
  - Changing WASM-exported function names: update both `assembly/index.ts` and JavaScript loaders (`wasm-particles.js`, `main.js`) because loader code looks for `updateParticles` or `_updateParticles`.
  - If a build fails on `npm run build`, check `asc` output first (`public/build/optimized.wasm`) and then `emcc` step — missing `emcc` is non-fatal (script will skip it) but can cause CI expectations to fail.
  - For debugging wasm fetch errors in browser, check the network response content-type — the code already logs HTML responses when a 404 is returned.

- **Security & secrets:**
  - `deploy.py` currently contains a plaintext password — do not expose this in PRs or logs. Recommend replacing with environment variables or secret management before automating deployments.

- **Where to add changes:**
  - Small fixes: edit JS modules in the project root. Keep changes minimal and preserve public APIs.
  - Wasm changes: edit `assembly/index.ts`, then run `npm run build:asc` locally (requires `assemblyscript` devDep).

See also `mod-player/AGENTS.md` for repository-level agent guidance that can be referenced by multi-agent workflows.

If anything here is unclear or you'd like more detail (CI, packaging, or a checklist for a wasm rebuild), tell me which area to expand.

# Developer Context: Candy World

## 1. High-Level Architecture & Intent

*   **Core Purpose:** "Candy World" is a high-fidelity, procedurally generated 3D environment rendered in the browser. It features a "Claymorphism" aesthetic (matte, soft, tactile) and reacts dynamically to music (MOD/XM files) and simulated weather.
*   **Tech Stack:**
    *   **Rendering:** [Three.js](https://threejs.org/) (specifically `WebGPURenderer`) using **TSL** (Three Shading Language) for all custom shaders.
    *   **Physics & Compute:** **Hybrid WASM Architecture**.
        *   *AssemblyScript:* Stateful physics, collision detection (Entity-Component System style).
        *   *Emscripten (C++):* Stateless, heavy compute (noise generation, batch processing).
    *   **Tooling:** Vite (Build/Dev), Playwright (Verification).
*   **Design Patterns:**
    *   **Orchestrator Pattern:** `main.js` initializes and manages the loop, delegating logic to specialized systems (`src/systems/*`).
    *   **Factory Pattern:** Foliage creation (flowers, mushrooms) uses factory functions in `src/foliage/*` to generate complex instanced meshes with shared geometries.
    *   **Data-Driven Design:** World layout is defined in `assets/map.json`.
    *   **Shared Mutable State:** To avoid Garbage Collection (GC) in the render loop, systems share mutable global objects (e.g., `_weatherBiasOutput`, `keyStates`) rather than passing new objects.

## 2. Feature Map

| Feature | Entry Point / Key File | Description |
| :--- | :--- | :--- |
| **Main Loop** | `main.js` | Orchestrates Audio, Physics, Weather, and Rendering. Handles the startup sequence. |
| **World Gen** | `src/world/generation.js` | Loads `assets/map.json`, spawns static assets (grass) and procedural extras (mushrooms/flowers). |
| **Physics** | `src/systems/physics.js` | Bridges JS and WASM. Handles player movement, collision, and gravity. |
| **Weather** | `src/systems/weather.js` | Simulates wind, rain, and storm cycles. Controls global light levels. |
| **Audio/Music** | `src/audio/audio-system.js` | Wraps `libopenmpt` (WASM) to play tracker music. Analyzes channels for reactivity. |
| **Reactivity** | `src/systems/music-reactivity.js` | Maps specific audio channels to visual effects (color shift, bounce, scale). |
| **Foliage** | `src/foliage/common.js` | Shared TSL material factories (`createClayMaterial`) and geometry management. |
| **Input** | `src/core/input.js` | Handles Pointer Lock, Keyboard, and Mouse interaction. |

## 3. Complexity Hotspots (The "Complex Parts")

### A. TSL (Three Shading Language) Implementation
*   **Why it's complex:** The project uses `WebGPURenderer`, meaning standard GLSL strings (`shaderMaterial`) **will not work**. All shaders must be written in TSL (JavaScript-based shader graph construction).
*   **Agent Note:**
    *   **Do not** attempt to write GLSL. Use `three/tsl` imports (`float`, `vec3`, `color`, `Fn`).
    *   **Imperative Logic:** Conditionals and assignments inside shaders must be wrapped in `Fn(() => { ... })` blocks.
    *   **Uniforms:** When binding a `Vector3` to a TSL `uniform()`, you must pass a Javascript `new THREE.Vector3()`, not a TSL `vec3()`.
    *   **Attributes:** Geometries *must* have `position` and `normal` attributes. `src/foliage/common.js` has a `validateNodeGeometries` helper to patch this, but you should ensure factories create valid geometry.

### B. Hybrid WASM Architecture
*   **Why it's complex:** The app loads *two* separate WASM modules that run simultaneously.
    *   `candy_physics.wasm` (AssemblyScript): Handles stateful objects (player, trampolines).
    *   `candy_native.wasm` (C++): Handles raw compute.
*   **Agent Note:**
    *   Be careful when modifying `src/utils/wasm-loader.js`. It manages the initialization order and fallback strategies.
    *   The AssemblyScript side is "Memory-First"—it expects linear memory layouts.
    *   Watch out for `SharedArrayBuffer` requirements (headers in `vite.config.js`).

### C. Music Reactivity & Light Levels
*   **Why it's complex:** Reactivity isn't just "loud = bright". Objects have `minLight` and `maxLight` preferences.
    *   **"Night Dancers":** Some plants only react at night.
    *   **Sunflowers:** Only react during the day.
    *   **Split Channels:** High frequency channels trigger "Sky" objects; Low frequency channels trigger "Flora".
*   **Agent Note:** When adding new objects, explicitly set their `userData.minLight` / `maxLight` if they should adhere to the Day/Night cycle.

## 4. Inherent Limitations & "Here be Dragons"

*   **Browser Requirements:** The project requires a browser with WebGPU support. For automated testing (Playwright), specific flags (`--use-gl=swiftshader`, `--enable-unsafe-webgpu`) are mandatory.
*   **Build Pipeline:** `npm run dev` builds the WASM modules before starting the server. This can be slow.
    *   *Constraint:* Do not remove the `build:wasm` step from the dev script, or the physics will be out of sync.
*   **Garbage Collection:** The render loop is highly optimized to avoid GC.
    *   *Constraint:* Do not create `new THREE.Vector3` or `new THREE.Color` inside `animate()` or `update()` functions. Use module-scope scratch variables (e.g., `_scratchSunVector` in `main.js`).
*   **Physics "Floatiness":** The gravity is intentionally "floaty" to match the dream-like candy aesthetic. Do not "fix" this to be realistic earth gravity unless explicitly asked.
*   **File System:** The runtime environment initially lacks `node_modules` at the root. You must run `npm install` before running verification scripts that utilize non-native node modules.

## 5. Dependency Graph & Key Flows

### Startup Sequence
1.  **Entry:** `index.html` loads `main.js`.
2.  **WASM Init:** `main.js` triggers `initWasmParallel` (in `wasm-loader.js`).
    *   Loads `candy_physics.wasm` and `candy_native.js` simultaneously.
3.  **World Gen:** Once WASM is ready, `initWorld` (in `generation.js`) is called.
    *   Parses `assets/map.json`.
    *   Spawns specific foliage types using factories.
4.  **Loop Start:** `startAnimationLoop` begins the `requestAnimationFrame` cycle.

### Audio-Visual Reactivity Flow
1.  **Input:** `AudioSystem` decodes MOD file chunk -> FFT/Volume analysis.
2.  **State:** `beatSync` detects beats/kicks.
3.  **Update:** `MusicReactivitySystem.update()` iterates over `reactiveObjects`.
4.  **Reaction:**
    *   Checks Light Level constraints.
    *   Calculates intensity based on mapped channel (Flora vs Sky).
    *   **TSL Update:** Updates TSL uniforms (e.g., emission color, vertex displacement) on the GPU.

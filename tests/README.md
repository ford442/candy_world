# Candy World Test Suite

This directory contains the test infrastructure for Candy World.

## Quick Start

```bash
# Run WASM particle bounds test (fast, ~2 seconds)
npm run test:wasm

# Run smoke test (requires built dist/ folder, ~2-3 minutes)
npm run test

# Run full test suite (WASM + smoke)
npm run test:integration
```

## Test Descriptions

### `npm run test:wasm` — WASM Particle Physics

**File**: `tests/wasm.mjs`  
**Runtime**: Node.js (ESM)  
**Duration**: ~2 seconds  
**Purpose**: Verify AssemblyScript particle physics stays within documented world bounds

This test:
1. Loads `src/wasm/candy_physics.wasm` (built by `npm run build:wasm`)
2. Spawns test particles with various velocities and initial conditions
3. Steps the physics simulation 50-100 frames at a time
4. Asserts all particles remain within documented world AABB:
   - X bounds: `[-128, 128]`
   - Y bounds: `[-100, 500]` (allows fall below ground, reach into sky)
   - Z bounds: `[-128, 128]`

**Exit code**: `0` on pass, `1` on fail

**Note**: This test requires `candy_physics.wasm` to be built. Run `npm run build:wasm` first if it doesn't exist.

### `npm run test` — Smoke Test (WebGPU + Boot Sequence)

**File**: `tests/smoke-runner.mjs`  
**Runtime**: Node.js (ESM) + Playwright + Chromium  
**Duration**: ~2-3 minutes (includes server startup, page load, scene init)  
**Purpose**: Verify the game boots without errors and initializes WebGPU renderer

This test:
1. Builds dist folder (if not present) via `npm run build`
2. Starts Vite preview server on `http://localhost:4173`
3. Launches Chromium with WebGPU flags enabled
4. Navigates to the game and waits for `window.__sceneReady` flag
5. Asserts:
   - No console errors occurred during boot
   - WebGPU is available (`navigator.gpu !== undefined`)
   - Canvas element exists and is sized (`width > 0`, `height > 0`)

**Pointer-lock note**: current smoke coverage validates boot readiness (`window.__sceneReady`) but does not synthesize browser pointer-lock interactions in CI. For first-person flow checks, run manual verification in dev (`npm run dev`), click the world once to lock look, then press `Esc` and click canvas to relock.

**Required browser flags**: `--enable-unsafe-webgpu`, `--enable-features=Vulkan,WebGPU`

**Exit code**: `0` on pass, `1` on fail  

**Note**: Warnings (e.g., `CloudBatcher` capacity warnings) are OK and don't cause failure. Only errors fail the test.

#### WebGL2 Smoke Test (`RENDERER=webgl`)

For headless CI or environments where WebGPU is unavailable (SwiftShader, software stacks):

```bash
RENDERER=webgl npm run test
# or
npm run test:smoke:webgl
```

Boots with `?renderer=webgl&webglLite=1` and asserts `window.usingWebGL === true`. See [docs/webgl-fallback.md](../docs/webgl-fallback.md).

#### Full-Boot Smoke Test (`FULL_BOOT=1`)

You can run the smoke test in **FULL** or **FAST_FULL** mode to verify the complete world population path (the same path that regressed in #1133):

```bash
# Full map population (~60-90s additional wait)
FULL_BOOT=1 npm run test

# Fast-full (lighter population)
FULL_BOOT=fast npm run test
```

In full-boot mode the smoke runner:
1. Clicks the **Full Game** (or **Fast Full**) mode button
2. Clicks **Enter the Dream**
3. Waits up to **60 seconds** for deferred background population to finish
4. Asserts (hard failures):
   - `window.__worldHealth.healthy === true`
   - `window.__spawnReport.failed === 0`
   - `window.__worldHealth.succeeded >= 1000`
   - `window.__worldHealth.sceneObjects.animatedFoliage >= 50`
   - `window.__worldHealth.batchers.totalInstances >= 100`
   - `window.game.animatedFoliage.length >= 50`

Keep **CORE** as the default for fast CI feedback; use `FULL_BOOT=1` for integration / nightly runs.

### `npm run test:integration` — Full Test Chain

Runs the complete verification pipeline:
1. `npm run build:wasm` — Compile AssemblyScript physics module
2. `npm run test:wasm` — Verify particle bounds
3. `npm run test` — Verify boot sequence (implied via smoke test)

**Exit code**: `0` if all pass, `1` if any fail

## System Requirements

- **Node.js**: 18+ (for ESM module support, top-level await)
- **Vite**: ^5.0.0 (for preview server)
- **Playwright**: ^1.57.0 (for browser automation)
- **Chromium**: Installed by Playwright (run `npx playwright install chromium` if needed)
- **Browser flags**: Requires Chrome/Edge 113+ with WebGPU enabled
- **WebGPU**: Requires hardware support (discrete GPU strongly recommended)

## Debugging

### WASM Test Failures

If `npm run test:wasm` fails:

1. Verify `src/wasm/candy_physics.wasm` exists:
   ```bash
   ls -lh src/wasm/candy_physics.wasm
   ```

2. Rebuild WASM if needed:
   ```bash
   npm run build:wasm
   ```

3. Run test with more verbose output (edit `tests/wasm.mjs` to add `console.log` statements)

4. Check particle bounds are correct in `tests/wasm.mjs` (compare to `assembly/constants.ts`)

### Smoke Test Failures

If `npm run test` fails:

1. Verify dist folder is built:
   ```bash
   ls -la dist/index.html
   ```

2. Rebuild dist if needed:
   ```bash
   npm run build
   ```

3. Try running the preview server manually to debug:
   ```bash
   npm run preview
   # In another terminal:
   open http://localhost:4173
   ```

4. Check browser console for errors (the smoke test will report them)

5. Verify Chromium is installed:
   ```bash
   npx playwright install chromium
   ```

### WebGPU Not Available

If the smoke test reports "WebGPU not available":

1. Ensure you're using Chrome/Edge 113+ or a browser with WebGPU enabled
2. Check `chrome://flags` (in Chrome) for WebGPU settings
3. Note: WebGPU requires a discrete GPU on most systems; integrated graphics may not work

## CI Integration

For CI pipelines, run:

```bash
# Full chain with error reporting
npm run test:integration

# Or run individually:
npm run build:wasm     # Compile WASM
npm run test:wasm      # Verify bounds
npm run test           # Verify boot (auto-builds dist if needed)

# Full-world population smoke tests (requires GPU; see "FULL BOOT in headless" note above)
npm run test:smoke:full   # FULL_BOOT=1
npm run test:smoke:fast   # FULL_BOOT=fast
```

All commands exit with:
- `0` on success
- `1` on failure

## Files

- `tests/wasm.mjs` — WASM particle physics test (Node.js)
- `tests/smoke-runner.mjs` — Boot sequence smoke test (Playwright)
- `tests/README.md` — This file

## Known Issues

### CloudBatcher capacity warnings

The smoke test may show many `WARNING: [CloudBatcher] Max capacity reached` messages. These are expected and do not cause test failure. They indicate the cloud system reached its allocation limit during world generation, which is normal.

### Audio worklet warnings

The smoke test may show warnings about audio processor script loading. These are expected and don't cause test failure (the audio system has fallbacks).

### Slow startup on first run

On the first run after `npm run build`, the smoke test may take 3+ minutes. This includes:
- Shader compilation and warmup (~30-60s)
- World generation (~20-30s)
- Initial WASM initialization (~5-10s)

Subsequent runs are faster once caches are warm.

### FULL BOOT in headless / CI environments

`FULL_BOOT=1` creates a large number of instanced meshes and WebGPU buffers. In headless Chromium (SwiftShader) or containers without a real GPU, the browser tab may crash with `WebGPU Device Lost` or `Target crashed`. This is an **environment limitation**, not a code bug. For reliable FULL mode smoke tests, run on a machine with a discrete GPU and stable WebGPU drivers.

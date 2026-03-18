# Startup Profiler for Candy World

A comprehensive startup profiling dashboard that tracks initialization phases, memory usage, WebGPU metrics, and shader compilation times.

## Features

- **Phase Tracking**: Automatically hooks into `console.time/timeEnd` calls to track startup phases
- **Memory Profiling**: Records JS heap size before/after each phase
- **WebGPU Metrics**: Tracks buffer allocations, shader compilations, and pipeline creations
- **InstancedMesh Counting**: Monitors mesh instantiation during startup
- **WASM Timing**: Records AssemblyScript and Emscripten initialization times
- **TSL Material Tracking**: Tracks Three.js TSL material compilation phases
- **Browser Overlay**: Real-time visualization with progress bars and warnings
- **JSON Export**: Structured report export for analysis

## Usage

### Basic Setup

The startup profiler is automatically enabled in `main.ts`:

```typescript
import { enableStartupProfiler } from './utils/startup-profiler.ts';

// Enable at the start of your app
enableStartupProfiler({
  slowPhaseThreshold: 100,  // ms - phases exceeding this are flagged
  enableOverlay: true,      // Show browser overlay
  enableConsole: true,      // Log to console
  saveToFile: true,         // Save JSON report
});
```

### Manual Phase Tracking

For phases not covered by `console.time`, use manual tracking:

```typescript
import { startPhase, endPhase } from './utils/startup-profiler.ts';

startPhase('Custom Operation');
// ... do work ...
endPhase('Custom Operation');
```

### Keyboard Shortcuts

- **P**: Toggle runtime profiler (existing)
- **O**: Toggle startup profiler overlay

### Finalizing the Report

Call `finalizeStartupProfile()` when startup is complete:

```typescript
import { finalizeStartupProfile } from './utils/startup-profiler.ts';

// After all startup phases complete
finalizeStartupProfile();
```

## Tracked Phases

The profiler automatically tracks these phases from `main.ts`:

1. **Core Scene Setup** - Scene, camera, renderer initialization
2. **Audio & Systems Init** - Audio system and beat sync setup
3. **World Generation** - Initial world map generation
4. **Map Generation** - Full map generation after user clicks start
5. **Shader Warmup** - Deferred shader compilation
6. **Deferred Visuals Init** - Aurora, celestial bodies, effects

## Report Format

The generated report includes:

```typescript
interface StartupReport {
  timestamp: string;
  userAgent: string;
  totalTime: number;
  phases: PhaseTiming[];
  memory: {
    initial: number;
    peak: number;
    final: number;
    delta: number;
  };
  webgpu: {
    bufferAllocations: number;
    bufferTotalSize: number;
    shaderCompilations: number;
    shaderCompileTime: number;
    pipelineCreations: number;
  };
  instancedMeshes: {
    count: number;
    totalInstances: number;
    meshesByType: Record<string, number>;
  };
  wasm: {
    assemblyScriptLoaded: boolean;
    emscriptenLoaded: boolean;
    initTime: number;
  };
  tsl: {
    materialCount: number;
    compilePhases: PhaseTiming[];
  };
  slowPhases: PhaseTiming[];
  warnings: string[];
}
```

## Output Locations

The report is saved to multiple locations:

1. **Download**: `startup-profile.json` (browser download)
2. **localStorage**: Key `candy_world_startup_profile`
3. **Console**: Full report logged to dev console
4. **Global**: Access via `window.__startupProfile`

## Overlay UI

The browser overlay shows:

- Total startup time with color-coded indicators
- Memory delta (heap size change)
- Phase breakdown with horizontal bars
- "Slow phase" warnings for phases >100ms
- InstancedMesh count
- Shader compilation metrics

## Slow Phase Detection

Phases exceeding the `slowPhaseThreshold` (default 100ms) are:
- Highlighted in red on the overlay
- Listed in the `slowPhases` array
- Logged as warnings in the console

## API Reference

### `enableStartupProfiler(config?)`
Enables the profiler with optional configuration.

### `disableStartupProfiler()`
Disables the profiler and removes hooks.

### `finalizeStartupProfile()`
Generates and outputs the final report.

### `toggleOverlay()`
Shows/hides the browser overlay.

### `startPhase(name)` / `endPhase(name)`
Manual phase tracking.

### `recordWASMInit(startTime, asLoaded, emLoaded)`
Record WASM initialization metrics.

### `recordTSLCompile(phaseName, duration)`
Record TSL material compilation time.

### `getProfilerStatus()`
Get current profiler state.

## Integration with Existing Profiler

The startup profiler works alongside the existing runtime profiler (`profiler.js`):
- Startup profiler: One-time startup analysis
- Runtime profiler: Per-frame performance monitoring (toggle with 'P')

## Troubleshooting

### No overlay visible
- Check that `enableOverlay: true` is set
- Press 'O' to toggle visibility
- Check console for errors

### Missing phases
- Ensure `console.time/timeEnd` labels match tracked phases
- Use manual `startPhase/endPhase` for custom tracking

### Memory data unavailable
- `performance.memory` is Chrome-only
- Other browsers will show 0 for memory metrics

### WebGPU metrics zero
- WebGPU hooks require adapter initialization before profiling starts
- Some metrics may only populate in WebGPU-enabled browsers

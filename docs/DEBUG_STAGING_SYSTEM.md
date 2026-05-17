# Debug Staging System

## Overview

The Candy World debug staging system provides a way to isolate and debug initialization failures by selectively enabling/disabling subsystems during application startup. This is especially useful when dealing with complex initialization sequences where failures in one subsystem can cascade to others.

## Features

- **Selective Stage Loading**: Enable/disable individual initialization stages via URL parameter
- **Visual Debug Panel**: Interactive UI showing stage status in real-time
- **Colored Console Logging**: Success (✓ green), failure (✗ red), skipped (⏭️ gray) stages
- **Timing Information**: Performance metrics for each stage
- **Error Tracking**: Detailed error messages with stack traces
- **Runtime Toggle**: Enable/disable stages without code changes

## Quick Start

### Enable Debug Mode

Add `?debug=1` to the URL:

```
http://localhost:5173/?debug=1
```

### Debug Panel Controls

Once debug mode is enabled:
- **D key**: Toggle debug panel visibility
- **P key**: Toggle performance profiler
- **O key**: Toggle startup profiler overlay

### Debug Panel UI

The debug panel shows:
- ✅ **Green**: Stage loaded successfully
- ❌ **Red**: Stage failed (hover for error details)
- ⏳ **Yellow**: Stage currently loading
- ⏭️ **Gray**: Stage skipped
- ⏸️ **Pause icon**: Stage pending (not started)

## Available Stages

The following stages can be independently controlled:

| Stage | Description | Dependencies |
|-------|-------------|--------------|
| `core` | Scene, renderer, camera, lights | None (required) |
| `postProcessing` | Post-processing effects pipeline | core |
| `audio` | Audio system and beat sync | core |
| `weather` | Weather system initialization | core |
| `worldCritical` | Base world (sky, ground, moon) | core, weather |
| `input` | Input handling and controls | core, audio |
| `interaction` | Interaction system | core, input |
| `musicReactivity` | Music-driven visual reactivity | audio, weather |
| `gameLoop` | Game loop initialization | All above |
| `shaderWarmup` | Shader compilation and warmup | core |
| `wasm` | WASM Emscripten module (optional) | None |
| `worldGeneration` | Full world generation (trees, mushrooms, etc.) | worldCritical |
| `deferredVisuals` | Celestial bodies, aurora | core |
| `deferredWorld` | Additional world content | worldCritical |

## Configuration

Edit `src/debug/stages.ts` to change default stage states:

```typescript
export const DEBUG_STAGES: DebugStages = {
  core: true,
  postProcessing: true,
  audio: true,
  weather: true,
  worldCritical: true,
  input: true,
  interaction: true,
  musicReactivity: true,
  gameLoop: true,
  shaderWarmup: true,
  wasm: true,
  worldGeneration: true,
  deferredVisuals: true,
  deferredWorld: true,
};
```

## Usage Examples

### Example 1: Test Core Scene Only

Disable all stages except core to verify basic Three.js scene setup:

```typescript
// In src/debug/stages.ts
export const DEBUG_STAGES: DebugStages = {
  core: true,
  postProcessing: false,
  audio: false,
  weather: false,
  worldCritical: false,
  // ... rest false
};
```

Or via the debug panel: uncheck all stages except `core` and reload.

### Example 2: Isolate Audio System Failure

If audio initialization is failing:

1. Enable `?debug=1` in URL
2. Open debug panel (press D)
3. Disable `audio`, `musicReactivity` stages
4. Reload and verify core works
5. Re-enable `audio` stage only
6. Check console for detailed error logs

### Example 3: Test World Generation Separately

To test world generation without audio/weather:

```typescript
// Enable only essential stages
export const DEBUG_STAGES: DebugStages = {
  core: true,
  postProcessing: true,
  audio: false,
  weather: false,
  worldCritical: true,
  input: true,
  interaction: false,
  musicReactivity: false,
  gameLoop: true,
  shaderWarmup: true,
  wasm: true,
  worldGeneration: true,
  deferredVisuals: false,
  deferredWorld: false,
};
```

## Console Output

The staging system logs detailed timing and status information:

```
[core] ✓ 45ms                  // Success - 45ms
[postProcessing] ✓ 23ms         // Success - 23ms
[audio] ✗ FAILED                // Failure - check console for stack trace
[weather] ⏭️ SKIPPED            // Skipped because audio failed
```

## Error Handling

When a stage fails:
1. The stage status changes to ❌ (red)
2. Error details are logged to console with stack trace
3. An error overlay may appear (for critical failures)
4. Dependent stages may be automatically skipped

### Viewing Error Details

- **Console**: Full error with stack trace
- **Debug Panel**: Hover over ❌ icon for error message
- **Error Overlay**: For critical failures (core, gameLoop)

## Implementation Details

### Stage Loader API

The `StageLoader` class wraps initialization code:

```typescript
import { StageLoader } from '../debug/index.ts';

await StageLoader.loadStage('stageName', async () => {
  // Your initialization code here
  await someAsyncInit();
});
```

### Manual Stage Control

Toggle stages programmatically in the console:

```javascript
// Get the stage loader
import { StageLoader } from './src/debug/index.ts';

// Disable a stage
StageLoader.toggleStage('audio', false);

// Enable a stage
StageLoader.toggleStage('audio', true);
```

### Integration Points

The staging system is integrated at these points in `src/core/main.ts`:

1. **Core scene setup** (lines ~70-85)
2. **Post-processing** (lines ~86-90)
3. **Audio & weather systems** (lines ~95-110)
4. **World critical content** (lines ~113-122)
5. **Music reactivity** (lines ~124-162)
6. **Input & interaction** (lines ~168-184)
7. **Game loop dependencies** (lines ~186-214)
8. **Shader warmup** (lines ~241-254)
9. **WASM loading** (lines ~263-272)
10. **World generation** (in `enterWorld` function)
11. **Deferred visuals & world** (background tasks)

## Troubleshooting

### Debug panel not showing

- Verify `?debug=1` is in the URL
- Press D key to toggle panel visibility
- Check browser console for errors

### Stage still executing despite being disabled

- Clear browser cache and reload
- Verify `DEBUG_STAGES` configuration in `src/debug/stages.ts`
- Check if stage has been re-enabled via debug panel

### Stages fail in unexpected order

- Check stage dependencies in the table above
- Verify initialization order in `src/core/main.ts`
- Look for shared resources between stages

## Performance Considerations

- Debug mode adds ~5-10ms overhead per stage for timing
- Debug panel updates every 500ms when visible
- Disabling stages can significantly reduce load time
- Production builds should not include `?debug=1`

## Security Notes

- Debug mode is controlled via URL parameter (client-side only)
- No sensitive data is exposed in stage logs
- Error details may include file paths and stack traces
- Recommended for development/testing only

## Future Enhancements

Potential improvements:
- Save stage configurations to localStorage
- Add dependency graph visualization
- Export stage timing data as JSON
- Add "retry failed stage" button
- Stage groups (e.g., "all audio", "all world")
- Integration with error reporting services

## References

- Implementation: `src/debug/stages.ts`, `src/debug/panel.ts`
- Integration: `src/core/main.ts`
- Issue: #814 (Debug checkpoints)

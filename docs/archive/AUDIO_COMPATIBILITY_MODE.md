# Audio Compatibility Mode

## Overview

The Candy World audio system now supports two audio processing modes:
1. **AudioWorkletNode** (Default) - Modern, high-performance audio processing using Web Audio API's AudioWorklet
2. **ScriptProcessorNode** (Compatibility) - Older, more compatible audio processing using the deprecated ScriptProcessorNode API

## Why Use Compatibility Mode?

The ScriptProcessorNode compatibility mode is useful in the following scenarios:
- Browsers or systems where AudioWorkletNode has performance issues
- Slow loading times when using AudioWorkletNode
- Debugging audio processing issues
- Older browsers that have better ScriptProcessorNode support

## Configuration

### Method 1: Edit Configuration File

Edit `src/core/config.ts` and change the `audio.useScriptProcessorNode` setting:

```typescript
export const CONFIG: ConfigType = {
    // ... other settings ...
    audio: {
        useScriptProcessorNode: true  // Set to true to enable compatibility mode
    }
};
```

### Method 2: URL Query Parameter (Coming Soon)

You will be able to enable compatibility mode by adding `?audioMode=scriptprocessor` to the URL:
```
https://yoursite.com/candy-world?audioMode=scriptprocessor
```

### Method 3: localStorage (Coming Soon)

You will be able to toggle this setting via browser console:
```javascript
localStorage.setItem('audioMode', 'scriptprocessor');
// Then reload the page
```

## Technical Details

### AudioWorkletNode Mode (Default)
- Audio processing runs in a separate audio thread
- Better performance and lower latency
- Modern Web Audio API
- Requires worklet file to be loaded (js/audio-processor.js)

### ScriptProcessorNode Mode (Compatibility)
- Audio processing runs on the main thread
- More compatible across different systems
- Deprecated but still widely supported
- Direct access to libopenmpt library

## Performance Considerations

- **ScriptProcessorNode** may cause audio glitches if the main thread is busy
- **ScriptProcessorNode** reduces visual state update frequency (10% of callbacks) to minimize overhead
- Both modes provide the same audio output and control functionality

## Troubleshooting

### AudioWorkletNode Issues
If you experience:
- Slow loading times
- Audio worklet fails to load
- Console errors about worklet initialization

Try enabling ScriptProcessorNode compatibility mode.

### ScriptProcessorNode Issues
If you experience:
- Audio stuttering or glitches
- Delayed visual reactions to music
- Main thread performance issues

Use the default AudioWorkletNode mode.

## Implementation Status

- ✅ Configuration option added
- ✅ Both modes fully implemented in AudioSystem
- ✅ Audio processing and playback working in both modes
- ✅ Visual state updates working in both modes
- ⏳ UI toggle for runtime switching (planned)
- ⏳ URL query parameter support (planned)
- ⏳ localStorage persistence (planned)

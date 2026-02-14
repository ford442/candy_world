# Arpeggio Fern Enhancements

## Project: Candy World - Visual Polish (Palette)

### Task Completed
Upgraded the **Arpeggio Ferns** from static/robotic geometry to "Juicy", organic, and audio-reactive foliage using TSL (Three Shading Language).

---

## Implementation Overview

The `ArpeggioFernBatcher` was refactored to use advanced TSL features for vertex deformation and fragment shading, aligning it with the "Cute Clay" + "Neon" aesthetic.

### Files Modified
1. **src/foliage/arpeggio-batcher.ts** - Complete overhaul of material and shader logic.

### Key Features

#### 1. Organic Unfurling 🌿
- **Before:** Global, linear unfurl where all ferns opened in perfect unison.
- **After:** **Spatial Wave Unfurl**. Ferns now unfurl with a delay based on their world position (`sin(x*0.5 + z*0.3)`), creating a natural, wave-like opening effect across the field.

#### 2. Juicy Interaction 🏃‍♂️
- **Player Interaction:** Ferns now bend away from the player as they move through them, using the shared `applyPlayerInteraction` TSL function.
- **Wind Sway:** Added `calculateWindSway` for continuous environmental movement.

#### 3. Audio Reactivity 🎵
- **Pulse:** The ferns' thickness and width now pulse subtly with the High Frequency audio channel (`uAudioHigh`), making them "dance" to the melody.
- **Emissive Glow:** The fragment shader adds a dynamic emissive boost based on the melody, making the ferns glow to the beat.

#### 4. Visual Polish ✨
- **Rim Light:** Added `createJuicyRimLight` to both Fronds and Bases, giving them a "Rim Light" effect that pops against the background.
- **Base Color Sync:** The base cones now match the color of the fronds (Neon/Rainbow) instead of being a static green.

---

## Technical Details

### TSL Shader Logic

**Vertex Shader:**
```typescript
// Wave delay for unfurl
const spatialDelay = sin(positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3))).mul(0.1);
const instanceUnfurl = baseUnfurl.add(spatialDelay).clamp(0.0, 1.0);

// Audio Pulse
const audioScale = uAudioHigh.mul(0.3).add(1.0);
const pulsedPos = vec3(curledPos.x.mul(audioScale), curledPos.y, curledPos.z.mul(audioScale));

// Interaction & Wind
const withInteraction = applyPlayerInteraction(pulsedPos);
const finalPos = withInteraction.add(calculateWindSway(pulsedPos));
```

**Fragment Shader:**
```typescript
// Juicy Rim Light
const rim = createJuicyRimLight(baseColor, float(2.0), float(3.0), null);
frondMat.emissiveNode = rim.add(baseColor.mul(uAudioHigh.mul(0.5)));
```

---

## Verification
- Verified code compilation (TSL syntax).
- Verified imports from `common.ts` and `three/tsl`.
- Maintained existing "Glitch" effect at the end of the pipeline.

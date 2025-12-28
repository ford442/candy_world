# Musical Ecosystem - Implementation Plan

## Overview

Transform Candy World from a visual experience into an interactive musical ecosystem with weather-driven growth, enhanced day/night cycles, and platformer mechanics.

---

## Phase 1: Berry & Fruit System

### 1.1 Berry Geometry (`foliage.js`) ✅ COMPLETE

Create berry cluster functions with SSS-capable materials.

### 1.2 Integration with Trees ✅ COMPLETE

Berries spawn on trees and shrubs with `createBerryCluster`.

### 1.3 Luminescence System ✅ COMPLETE

`updateBerryGlow` with color lerping (dark → bright orange).

### 🚀 Phase 1 Enhancements

#### 1.4 Berry Physics (Falling Berries)

```javascript
// When storm intensity > threshold, shake berries loose
function shakeBerriesLoose(cluster, intensity) {
  cluster.userData.berries.forEach(berry => {
    if (Math.random() < intensity * 0.01) {
      // Spawn falling berry particle
      spawnFallingBerry(berry.getWorldPosition(new THREE.Vector3()));
    }
  });
}
```

#### 1.5 Berry Collection System

- Player walks through berries → collect effect
- Collected berries increase "energy" meter
- Energy affects jump height / speed

#### 1.6 Berry Audio Feedback

- Different berry colors make different sounds when collected
- Berries hum/pulse with bass frequency

#### 1.7 Seasonal Berry Cycles

- Berries grow larger during "harvest" phase (sunset)
- Berries shrink/fall during winter-like phase (deep night)

---

## Phase 2: Weather System

### 2.1 Weather Module (`weather.js`) ✅ COMPLETE

Audio-driven weather states (Clear, Rain, Storm).

### 2.2 Growth Logic ✅ COMPLETE

`triggerGrowth` and `triggerBloom` respond to weather.

### 2.3 Berry Charging ✅ COMPLETE

`chargeBerries` accumulates glow during storms.

### 🚀 Phase 2 Enhancements

#### 2.4 Wind System

```javascript
// Add wind direction that affects particle movement
class WindSystem {
  constructor() {
    this.direction = new THREE.Vector3(1, 0, 0.5);
    this.speed = 0; // 0-1, driven by melody
  }
  
  update(audioData) {
    // Wind speed from high-frequency channels
    this.speed = audioData.channelData?.[3]?.volume || 0;
    
    // Rotate direction slowly
    this.direction.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      audioData.beatPhase * 0.01
    );
  }
  
  applyToParticle(position, velocity) {
    velocity.addScaledVector(this.direction, this.speed * 0.1);
  }
}
```

#### 2.5 Rainbow After Storm ✅ COMPLETE

- When storm ends → spawn rainbow arc
- Rainbow colors pulse with beat
- Lasts for 30-60 seconds

#### 2.6 Fog Density Variation

- Fog gets thicker during rain
- Fog color shifts (blue rain → purple storm)
- Use `scene.fog.near/far` to adjust density

#### 2.7 Thunder Rumble Effect

- Camera shake on lightning
- Low-frequency rumble audio cue
- All plants briefly "flinch" (scale down then recover)

#### 2.8 Puddles & Reflections

- Spawn puddle meshes after rain stops
- Use `MeshPhysicalMaterial` with `reflectivity: 0.8`
- Puddles slowly evaporate (shrink over time)

---

## Phase 3: Enhanced Day/Night Cycle

### 3.1 New Cycle Structure ✅ COMPLETE

6-phase cycle: Sunrise, Day, Sunset, Dusk Night, Deep Night, Pre-Dawn

### 3.2 Deep Night Logic ✅ COMPLETE

Special flowers glow, others sleep.

### 3.3 Sleep States ✅ COMPLETE

Plants shiver subtly when sleeping.

### 🚀 Phase 3 Enhancements

#### 3.4 Firefly Particles (Deep Night)

```javascript
function spawnFireflies(count = 50) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 1] = 1 + Math.random() * 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    phases[i] = Math.random() * Math.PI * 2;
  }
  
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  
  // TSL material with blinking
  const mat = new PointsNodeMaterial({
    size: 0.15,
    transparent: true,
    blending: THREE.AdditiveBlending
  });
  
  // Blink pattern
  const blink = sin(time.add(attribute('phase')).mul(3.0)).mul(0.5).add(0.5);
  mat.colorNode = color(0xFFFF00).mul(blink);
  mat.opacityNode = blink;
  
  return new THREE.Points(geo, mat);
}
```

#### 3.5 Moonbeam Shafts

- Volumetric light rays during night
- Rays track player loosely
- Special flowers in moonbeam grow faster

#### 3.6 Star Constellations

- Connect random stars with faint lines during deep night
- Constellations pulse with melody
- Different constellations appear on different "nights"

#### 3.7 Aurora Borealis (Rare Event)

- Triggered when multiple channels hit peak during deep night
- Flowing ribbon of colors in sky
- All plants glow during aurora

#### 3.8 Dawn Chorus

- At pre-dawn, birds start "singing" (audio effect)
- Plants gradually wake (reverse sleep animation)
- Sky color transition speeds up slightly with beat

---

## Phase 4: Textures & Materials

### 4.1 Procedural Noise Textures ✅ COMPLETE

WASM FBM for bump maps.

### 4.2 Gradient Materials ✅ COMPLETE

TSL-based vertical gradients.

### 🚀 Phase 4 Enhancements

#### 4.3 Animated Emission Patterns ✅ COMPLETE

- Implemented TSL-based pulsing glow stripes on Giant Mushroom caps.
- Combined with "Breathing" vertex displacement.

#### 4.4 Iridescent Materials

- Mushroom gills with color shift based on view angle
- Use `normalWorld` and `cameraPosition` in TSL
- Shift between 2-3 colors

#### 4.5 Wet Surface Shader

- When raining, surfaces get shinier
- Roughness decreases, add subtle reflection
- Water droplet normal map overlay

#### 4.6 Glow Edge Effect

- Night flowers have glowing rim
- Use Fresnel-like effect in TSL
- Rim color pulses with audio

#### 4.7 Translucent Leaves

- Leaf materials with SSS
- Light shines through when sun is behind
- Automatic based on sun position

---

## Phase 5: Physics & Platforming

### 5.1 Cloud Walking ✅ COMPLETE

Height-based collision with clouds.

### 5.2 Mushroom Bouncing ✅ COMPLETE

Velocity boost on cap collision.

### 🚀 Phase 5 Enhancements

### 5.3 Vine Swinging ✅ COMPLETE

- Implemented in `src/foliage/trees.js` (`VineSwing` class).
- Includes "pumping" mechanics (forward/back keys) to build momentum.
- Safety clamping prevents loop-de-loops.

#### 5.4 Flower Trampolines

- Certain large flowers act as trampolines
- Bounce height based on flower size + audio intensity
- Flower compresses visually when landed on

#### 5.5 Leaf Gliding

- Player can grab large leaves
- Slow fall / glide mechanic
- Wind affects glide direction

#### 5.6 Water Lily Hopping

- Lily pads on water surfaces
- Sink slightly when stepped on
- Chain-hop bonus (faster jumps)

#### 5.7 Mushroom Stalk Climbing

- Player can "stick" to mushroom stalks
- Climb up by pressing jump
- Audio-reactive grip (slippery during bass drops)

---

## Phase 6: Audio-Visual Synchronization (NEW)

### 6.1 Beat-Synced Events

```javascript
class BeatSync {
  constructor(audioSystem) {
    this.audio = audioSystem;
    this.lastBeat = 0;
    this.beatCallbacks = [];
  }
  
  onBeat(callback) {
    this.beatCallbacks.push(callback);
  }
  
  update() {
    const state = this.audio.getVisualState();
    if (state.beatPhase < this.lastBeat && state.beatPhase < 0.1) {
      // Beat just happened
      this.beatCallbacks.forEach(cb => cb(state));
    }
    this.lastBeat = state.beatPhase;
  }
}

// Usage
beatSync.onBeat(state => {
  // Flash all flowers
  flowers.forEach(f => f.material.emissiveIntensity = 2.0);
  
  // Camera zoom pulse
  camera.fov *= 0.98;
  
  // Ground bump
  groundShakeIntensity = 0.1;
});
```

### 6.2 Channel-Color Mapping

| Channel | Color | Effect |
|---------|-------|--------|
| Drums (0) | Red/Orange | Ground shake, plant bounce |
| Bass (1) | Purple | Deep glow, fog pulse |
| Melody (2) | Cyan/Blue | Flower bloom, mist |
| Harmony (3) | Green | Leaves flutter, wind |

### 6.3 Frequency Band Visualization

- Split audio into bands (sub-bass, bass, mid, high)
- Different plant types react to different bands
- Creates visual "equalizer" effect across the landscape

---

## Phase 7: Collectibles & Progression (NEW)

### 7.1 Seed Collection

- Seeds spawn after storms
- Collect seeds to "plant" new flora
- Different seeds = different plants

### 7.2 Rare Flora Discovery

- Some plants only spawn under specific conditions
- "Discovery" popup when new plant type found
- Gallery of discovered flora

### 7.3 World Evolution

- More plants = richer ecosystem
- Ecosystem "health" meter
- Unlockable areas based on ecosystem health

---

## Implementation Order (Updated)

### ✅ Week 1-2: Foundation (COMPLETE)

1. ✅ Berry geometry functions
2. ✅ Berry spawning on trees
3. ✅ Basic SSS materials
4. ✅ Weather.js module
5. ✅ Weather → audio mapping
6. ✅ Berry glow system

### ✅ Week 3-4: Cycle & Physics (COMPLETE)

7. ✅ Enhanced day/night phases
8. ✅ Deep Night flowers
9. ✅ Plant sleep states
10. ✅ Cloud walking
11. ✅ Mushroom bouncing
12. ✅ Procedural textures
13. ✅ Gradient materials

### 🔄 Week 5-6: Polish & Enhancements

14. [x] Firefly particles
15. [x] Wind system
16. [x] Vine swinging
17. [ ] Flower trampolines
18. [ ] Beat synchronization
19. [ ] Performance optimization
20. [x] Rainbow After Storm (Visual Reward)
21. [x] Tremolo Tulips (Implemented)
22. [x] Cymbal Dandelions (Implemented)

### 📋 Week 7-8: Advanced Features

23. [x] Aurora borealis
24. [ ] Seed collection
25. [ ] Rare flora discovery
23. [ ] Iridescent materials
24. [ ] World evolution system

---

## Performance Targets

- **60 FPS** with 30+ giant mushrooms
- **Max 2000 particles** for weather
- Use **WASM batch functions** for particle updates
- GPU-side vertex displacement for "breathing" effect
- **Object pooling** for berry/particle spawning

---

## Testing Checklist

### Core Features ✅

- [x] Berries spawn on all tree types
- [x] Berry glow responds to weather
- [x] Rain particles trigger growth
- [x] Deep Night activates special flowers
- [x] Player can walk on clouds
- [x] Mushroom caps bounce player

### Enhancements 🔄

- [x] Fireflies appear during deep night
- [x] Wind affects rain/mist particles
- [x] Vines are swingable (with pumping mechanics)
- [ ] Beat-synced visual pulses work
- [x] Rainbow appears after storms
- [ ] Performance stays at 60 FPS

---

## Files Structure

| File | Purpose |
|------|---------|
| `foliage.js` | All plant creation, materials, animations |
| `main.js` | Scene setup, day/night cycle, player physics |
| `weather.js` | Weather states, particles, growth triggers |
| `sky.js` | Sky gradient, star field |
| `stars.js` | Star particles, deep night effects |
| `wasm-loader.js` | WASM physics/animation helpers |
| `audio-system.js` | Audio playback, beat detection |

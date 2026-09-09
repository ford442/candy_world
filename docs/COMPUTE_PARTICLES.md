# WebGPU Compute Shader Particle System

A high-performance GPU-accelerated particle system for Candy World using WebGPU compute shaders. This system achieves **100,000+ particles at 60fps** compared to ~5,000 with CPU-based systems.

## Overview

The Compute Particle System moves particle simulation entirely to the GPU, eliminating CPU bottlenecks and enabling massive particle counts with complex physics interactions.

### Key Features

- **GPU-Side Physics**: Gravity, wind, turbulence, collision
- **Noise-Based Movement**: Curl noise for organic, natural motion
- **Player Interaction**: Attraction/repulsion from player position
- **Audio Reactivity**: Particles respond to bass and treble frequencies
- **Automatic Fallback**: Falls back to CPU simulation if WebGPU unavailable
- **Multiple System Types**: Fireflies, Pollen, Berries, Rain, Sparks

## Performance

| Particle System | CPU (JS) | GPU (WebGPU) | Improvement |
|----------------|----------|--------------|-------------|
| Fireflies | ~5,000 @ 60fps | ~50,000 @ 60fps | **10x** |
| Pollen | ~3,000 @ 60fps | ~30,000 @ 60fps | **10x** |
| Rain | ~10,000 @ 60fps | ~100,000 @ 60fps | **10x** |
| Sparks | ~8,000 @ 60fps | ~50,000 @ 60fps | **6x** |

*Benchmarks measured on modern desktop GPU (RTX 3070). Mobile GPUs will see proportionally lower but still significant improvements.*

## Quick Start

### Creating a Firefly System

```typescript
import { createComputeFireflies } from './particles';

// Create 50,000 fireflies in a 100x15x100 area
const fireflies = createComputeFireflies({
    count: 50000,
    bounds: { x: 100, y: 15, z: 100 },
    center: new THREE.Vector3(0, 3, 0)
});

scene.add(fireflies.mesh);

// In your render loop
fireflies.update(renderer, deltaTime, playerPosition, audioData);
```

### Creating Multiple Systems

```typescript
import {
    createComputeFireflies,
    createComputePollen,
    createComputeRain,
    updateAllComputeSystems
} from './particles';

// Create multiple particle systems
const fireflies = createComputeFireflies({ count: 50000 });
const pollen = createComputePollen({ count: 30000 });
const rain = createComputeRain({ count: 100000 });

scene.add(fireflies.mesh);
scene.add(pollen.mesh);
scene.add(rain.mesh);

// Update all in render loop
updateAllComputeSystems(renderer, deltaTime, playerPosition, audioData);
```

## System Types

### Fireflies (`createComputeFireflies`)

Glowing particles that float organically with curl noise turbulence.

```typescript
const fireflies = createComputeFireflies({
    count: 50000,           // Number of particles
    bounds: { x: 100, y: 15, z: 100 },
    center: new THREE.Vector3(0, 3, 0),
    sizeRange: { min: 0.1, max: 0.25 },
    glowColor: 0x88FF00,    // Green-yellow glow
    blinkSpeed: 5.0
});
```

**Behaviors:**
- Organic wandering via curl noise
- Spring force to center area (territory)
- Audio turbulence on bass hits
- Player repulsion within 5 units
- Floor bounce constraint

### Pollen (`createComputePollen`)

Floating particles that react to wind and drift lazily.

```typescript
const pollen = createComputePollen({
    count: 30000,
    bounds: { x: 50, y: 20, z: 50 },
    center: new THREE.Vector3(0, 8, 0),
    windReactivity: 0.05,
    pollenColor: 0x00FFFF
});
```

**Behaviors:**
- Wind-driven movement
- Curl noise turbulence
- Center attraction (keep in area)
- Player repulsion
- Water surface constraint

### Berries (`createComputeBerries`)

Physics-based particles with gravity and bounce.

```typescript
const berries = createComputeBerries({
    count: 5000,
    bounds: { x: 80, y: 30, z: 80 },
    center: new THREE.Vector3(0, 20, 0),
    bounce: 0.5,        // Restitution
    gravity: 9.8
});
```

**Behaviors:**
- Gravity simulation
- Ground bounce with energy loss
- Surface friction
- Collectable (via collision detection)

### Rain (`createComputeRain`)

Fast-falling rain particles with wind drift.

```typescript
const rain = createComputeRain({
    count: 100000,
    bounds: { x: 200, y: 50, z: 200 },
    center: new THREE.Vector3(0, 40, 0),
    rainIntensity: 1.0,
    splashOnGround: true
});
```

**Behaviors:**
- Fast vertical fall
- Wind drift
- Die on ground contact (respawn at top)
- Stretched quads for speed lines effect

### Sparks (`createComputeSparks`)

Short-lived high-velocity particles for explosions/effects.

```typescript
const sparks = createComputeSparks({
    count: 20000,
    bounds: { x: 30, y: 20, z: 30 },
    center: new THREE.Vector3(0, 5, 0),
    sparkColor: 0xFFFF80,
    decayRate: 2.0
});
```

**Behaviors:**
- High initial velocity
- Light gravity
- Air resistance
- Size shrinks with life
- Short lifespan (0.3-0.8 seconds)

## Advanced Usage

### Using the ComputeParticleSystem Class Directly

```typescript
import { ComputeParticleSystem } from './particles';

const system = new ComputeParticleSystem({
    type: 'fireflies',
    count: 50000,
    bounds: { x: 100, y: 15, z: 100 },
    center: new THREE.Vector3(0, 3, 0),
    sizeRange: { min: 0.1, max: 0.25 }
});

scene.add(system.mesh);

// Update in render loop
system.update(renderer, deltaTime, playerPosition, audioData);
```

### Custom Audio Data

```typescript
const audioData = {
    low: bassEnergy,      // 0-1, affects turbulence
    mid: midEnergy,       // 0-1
    high: trebleEnergy,   // 0-1, affects glow/sparkle
    beat: isBeat,         // boolean, triggers effects
    groove: grooveAmount, // 0-1, overall intensity
    windX: windDirection.x,
    windZ: windDirection.z,
    windSpeed: windStrength
};

system.update(renderer, deltaTime, playerPosition, audioData);
```

### System Management

```typescript
import {
    initComputeParticleSystems,
    addComputeSystem,
    removeComputeSystem,
    updateAllComputeSystems,
    disposeAllComputeSystems,
    getActiveComputeSystems
} from './particles';

// Initialize
const systems = initComputeParticleSystems();

// Add systems
systems.fireflies = createComputeFireflies({ count: 50000 });
addComputeSystem('fireflies', systems.fireflies);

// Update all
updateAllComputeSystems(renderer, deltaTime, playerPosition, audioData);

// Cleanup
disposeAllComputeSystems();
```

## Technical Architecture

### Compute Shader Pipeline

1. **Update Shader** (`update-particles.wgsl`)
   - Runs per particle in parallel on GPU
   - Updates position, velocity, life
   - Handles respawning when life <= 0
   - Applies type-specific physics

2. **Spawn Shader** (`spawn-particles.wgsl`)
   - Handles burst emissions
   - Shape-based spawning (sphere, box, cone, disc)
   - Velocity patterns (random, explosive, directional, spiral)

3. **Collision Shader** (`collide-particles.wgsl`)
   - Height texture sampling for ground collision
   - Obstacle sphere collision
   - Water surface collision
   - Bounce physics response

4. **Render Shader** (`render-particles.wgsl`)
   - Billboard quads (camera-facing)
   - Size animation and effects
   - Velocity-based stretching
   - Type-specific coloring

### Data Flow

```
CPU: Initialize buffers → Write uniforms → Dispatch compute
                                                    ↓
GPU:  Compute Shader Updates Particles ← Read/Write Storage Buffers
                                                    ↓
GPU:  Render Shader Reads Buffers → Output to Screen
```

### Storage Buffer Layout

Each particle stores:
- **Position** (vec3): World position
- **Velocity** (vec3): Current velocity
- **Life** (float): Remaining life in seconds
- **Size** (float): Particle size
- **Color** (vec4): RGBA color
- **Seed** (float): Random seed for effects

### Uniform Buffer Layout

Per-frame uniforms:
- deltaTime, time, count
- bounds (x, y, z), center (x, y, z)
- gravity, wind (x, y, z, speed)
- playerPosition (x, y, z)
- audioLow, audioHigh
- particleType (0-4)

## Emitter API (reusable)

> Module: [`src/particles/emitter-api.ts`](../src/particles/emitter-api.ts)

The factory functions below (`createComputeFireflies`, …) are the *low-level* tier:
one call builds one purpose-built system. The **emitter API** wraps them so gameplay,
weather and debug tools can spawn, steer and music-drive particles without copying
shader files or hand-wiring a `ComputeParticleSystem`.

It creates **no new `GPUDevice`**. Every emitter runs on the system built by
`compute-particles.ts`, which borrows the one renderer-owned device through
`awaitGpuDevice()` and fails closed to `CPUParticleSystem` — see
[WEBGPU_CONTEXT.md](./WEBGPU_CONTEXT.md).

### Creating an emitter

```typescript
import { createEmitter, updateEmitters } from './particles';

const puff = createEmitter({
    preset: 'candy_puff',                       // behaviour + material preset
    shape: { type: 'sphere', radius: 0.4 },     // 'point' | 'sphere' | 'box'
    rate: 0,                                    // particles/second; 0 = burst-only
    lifetime: { min: 0.9, max: 2.0 },
    count: 1024,                                // pool size
    position: chest.position,
});

scene.add(puff.mesh);   // a stable Group — safe to parent once
puff.burst(48);         // one-shot pop
```

`emitter.mesh` is a `THREE.Group` wrapper, not the raw points object: the system
swaps its own mesh if WebGPU init fails and the CPU tier takes over, so parenting
the wrapper means the fallback lands in the scene automatically.

`updateEmitters()` is already called once per frame from
`src/core/game-loop-particles.ts` — emitters are stepped there and nowhere else, so
a system is never dispatched twice.

### Presets

| Preset | One-shot | Use for |
| ------ | -------- | ------- |
| `spark_burst` | ✅ | Impacts, hits, ability recoil — hot radial shrapnel, ~0.25–0.7 s |
| `candy_puff` | ✅ | Debris, pickups, dissolves — pastel billow that rises and expands |
| `fireflies`, `pollen`, `berries`, `rain`, `sparks`, `gem_sparks` | ❌ | The pre-existing ambient fields, wrapped in the same API |

**One-shot** pools start empty and never self-recycle: a dead particle parks
invisibly until the host re-seeds the slot through `burst()` or a non-zero `rate`.
That is what makes them safe for debris — the pool is a budget, not a permanent
field. Ambient presets recycle on the GPU exactly as before.

### Attractors

Up to `MAX_PARTICLE_ATTRACTORS` (4) per emitter. Force falls off linearly to zero at
the radius; **negative strength repels**. Attractors are applied by one shared pass in
the WGSL kernel, so they work for every preset without forking the shader — and the
CPU fallback runs the same falloff in `CPUParticleSystem.applyAttractors()`.

```typescript
const pull = puff.addAttractor({
    position: player.position,   // copied, not retained
    strength: 8,                 // units/s² at the centre; negative repels
    radius: 6,
});

pull?.setPosition(player.position);   // cheap, call per frame if you like
pull?.setStrength(-4);                // now a repulsor
pull?.remove();                       // frees the slot
```

`addAttractor()` returns `null` when all four slots are taken — a soft failure, not
an error. Slots freed with `remove()` are zeroed, so a stale attractor can never
linger in the uniform block.

### Music hooks

`bindMusic()` drives emit rate, respawn energy or an attractor's strength from the
same `ParticleAudioData` that feeds `MusicReactivitySystem`. Bindings are evaluated
in `updateEmitters()` with **zero per-frame allocation** and the same
frame-rate-independent exponential smoothing convention
(`1 - exp(-smoothing * dt)`) used elsewhere in the reactivity system.

```typescript
// Treble energy → emission rate, 0…120 particles/second
puff.bindMusic({ source: 'high', target: 'rate', min: 0, max: 120 });

// Bass → attractor strength, so the field inhales on every kick
puff.bindMusic({ source: 'low', target: 'attractor', attractorIndex: 0, min: 0, max: 14 });

// Beat → respawn energy (particleType-specific launch speed)
puff.bindMusic({ source: 'beat', target: 'emitScale', min: 1, max: 2.5, smoothing: 12 });

puff.clearMusicBindings();   // restores the attractor strengths captured at bind time
```

| Field | Values |
| ----- | ------ |
| `source` | `'low'`, `'mid'`, `'high'`, `'groove'`, `'beat'` |
| `target` | `'rate'`, `'emitScale'`, `'attractor'` |
| `min` / `max` | Output range mapped from the source's 0…1 (defaults `0`…`1`) |
| `smoothing` | Smoothing rate in 1/s; `0` disables (default `8`) |
| `attractorIndex` | Which slot `target: 'attractor'` drives (default `0`) |

Channel wiring conventions live in `assets/music-bindings.json`; a hook that should
follow a biome's channel reads the corresponding `BiomeUniforms` value and feeds it
in as `min`/`max` rather than re-deriving the channel mapping here.

### Disposal and device loss

```typescript
puff.dispose();          // or: disposeEmitter(id) / disposeAllEmitters()
```

Disposal unregisters the emitter, unparents its mesh and releases **its own** GPU
buffers (`particleBuffer`, `uniformBuffer`). It never calls `device.destroy()` — the
device belongs to the renderer.

On device loss the system's `onGpuDeviceLost` handler drops every pipeline and
buffer reference, stops dispatching compute, and **hides the mesh** rather than
leaving a field of particles frozen mid-air. `emitter.isGPU` and
`system.isDeviceLost` report the tier, so a caller can rebuild the emitter if the
renderer recovers. If WebGPU was never available in the first place, the constructor
catch installs `CPUParticleSystem` and `burst()` / attractors keep working on the
CPU tier.

### Debug surface (`?debug=1`)

`window.__particles` is installed by `src/debug/particle-emitter-debug.ts` when the
debug flag is on, so a burst can be fired from the console with no code changes:

```js
__particles.burst('spark_burst', 64)   // burst in front of the player
__particles.attract(8, 6)              // pull live particles toward the player
__particles.music()                    // bind treble → emit rate
__particles.list()                     // emitters + which tier each runs on
__particles.clear()                    // dispose everything the hook made
```

## Fallback Behavior

If WebGPU compute is not available, the system automatically falls back to CPU simulation using the `CPUParticleSystem` class. The fallback maintains the same API and similar visual results with reduced particle counts.

```typescript
// Automatic fallback - no code changes needed
const system = createComputeFireflies({ count: 50000 });

// If WebGPU unavailable, internally uses CPUParticleSystem
// with ~5,000 particles for smooth performance
```

## Performance Tips

### Optimal Particle Counts by Device

| Device Type | Fireflies | Pollen | Rain | Sparks |
|-------------|-----------|--------|------|--------|
| Desktop GPU | 100,000 | 50,000 | 200,000 | 50,000 |
| Laptop GPU | 50,000 | 30,000 | 100,000 | 30,000 |
| Mobile GPU | 20,000 | 10,000 | 50,000 | 15,000 |
| CPU Fallback | 5,000 | 3,000 | 10,000 | 8,000 |

### Optimization Strategies

1. **Use bounds wisely**: Smaller bounds = less spatial cache pressure
2. **Batch updates**: Call `updateAllComputeSystems` once per frame
3. **Cull invisible systems**: Disable updates for off-screen particle systems
4. **Use appropriate types**: Rain particles are cheaper than fireflies
5. **Limit audio reactivity**: Only pass audio data when it changes

## Browser Support

| Browser | WebGPU Support | Notes |
|---------|---------------|-------|
| Chrome 113+ | ✅ Full | Best performance |
| Edge 113+ | ✅ Full | Best performance |
| Firefox | ⚠️ Nightly | Enable `dom.webgpu.enabled` |
| Safari | ⚠️ TP | Technology Preview |

All browsers fall back to CPU simulation if WebGPU is unavailable.

## Integration with Existing Systems

### Replacing Old Fireflies

```typescript
// Old way (CPU-based from foliage/fireflies.ts)
import { createFireflies } from './foliage';
const oldFireflies = createFireflies(150, 100);

// New way (GPU compute)
import { createComputeFireflies } from './particles';
const newFireflies = createComputeFireflies({ count: 50000 });
```

### Replacing Pollen

```typescript
// Old way
import { createNeonPollen } from './foliage';
const oldPollen = createNeonPollen(3000, 25, center);

// New way
import { createComputePollen } from './particles';
const newPollen = createComputePollen({ count: 30000 });
```

## Shader Customization

For advanced users, you can access the WGSL shader sources:

```typescript
import { UPDATE_PARTICLES_WGSL, RENDER_PARTICLES_WGSL } from './particles';

// Modify shaders or use as reference for custom implementations
console.log(UPDATE_PARTICLES_WGSL);
```

## Future Enhancements

- [ ] Height texture integration for accurate ground collision
- [ ] GPU-based spatial hashing for particle-particle interactions
- [ ] Trail rendering for fast particles
- [ ] Particle collision with instanced foliage
- [ ] GPU-based particle sorting for correct transparency
- [ ] Level-of-detail system for distant particles

## Debugging

Enable WebGPU debug labels:

```typescript
const system = new ComputeParticleSystem({
    type: 'fireflies',
    count: 50000
});

// Check if using GPU or CPU fallback
console.log('Using GPU:', system['usingGPU']);
```

---

**Note**: This system requires Three.js with WebGPU support. Ensure you're using the WebGPU build of Three.js (`three/webgpu`).

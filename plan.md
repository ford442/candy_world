Let's make these additions to `src/systems/physics/physics.ts`:
1. Normal Jump (around line 315):
```typescript
             spawnImpact(player.position, 'jump');
             if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('jump', { pitch: Math.random() * 0.2 + 0.9, volume: 0.5 });
             }
```
2. Hard Fall (around line 330):
```typescript
                spawnImpact(player.position, 'land');
                spawnImpact(player.position, 'dash'); // Extra particles
                addCameraShake(0.4); // 🎨 Palette: Heavy landing shake
                if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 0.6, volume: 1.0 });
                }
```
3. Medium Fall (around line 336):
```typescript
                spawnImpact(player.position, 'land');
                addCameraShake(0.15); // 🎨 Palette: Medium landing shake
                if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 0.8, volume: 0.7 });
                }
```
4. Soft Landing (around line 340):
```typescript
                spawnImpact(player.position, 'jump'); // Lighter particle burst
                if (uChromaticIntensity) uChromaticIntensity.value = 0.2;
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 1.2, volume: 0.4 });
                }
```
5. Trampoline bounce (around line 363):
```typescript
              // 🎨 Palette: Add "Juice" to trampoline mushroom bounce
              spawnImpact(player.position, 'jump');
              addCameraShake(0.3); // 🎨 Palette: Trampoline bounce shake
              if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                  (window as any).AudioSystem.playSound('impact', { pitch: 1.5, volume: 0.8 });
              }
```
6. Trap snap (around line 720):
```typescript
                        spawnImpact(player.position, 'snare');
                        addCameraShake(0.6); // 🎨 Palette: Trap snap shake
                        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                            (window as any).AudioSystem.playSound('impact', { pitch: 0.4, volume: 1.0 });
                        }
```

Wait, what about `src/systems/physics/physics.ts` JS fallback landings around line 870? We should add audio there too.
Also `src/systems/physics/physics-abilities.ts` around line 80 dash?
```typescript
        addCameraShake(0.1); // 🎨 Palette: Dash shake
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('dash', { pitch: Math.random() * 0.2 + 0.9, volume: 0.6 });
        }
```

And `src/systems/glitch-grenade.ts` triggerExplosion:
```typescript
    private triggerExplosion(position: THREE.Vector3) {
        // Set the TSL uniforms to apply the local glitch shader
        uGlitchExplosionCenter.value.copy(position);
        uGlitchExplosionRadius.value = this.explosionRadiusMax;

        // Reset timer
        this.explosionTimer = this.explosionDuration;

        // Visual impact (reusing spore or jump for now)
        spawnImpact(position, 'spore');

1. **Phase 4 targets (Compute Shaders - Remaining)**: Identify specific visual features that are still heavily reliant on CPU and transition them to WebGPU Compute Shaders (GPGPU). Candidates include any remaining particle or visual effect loops (e.g. Grass swaying, or moving custom animations into pure TSL Vertex Shaders).
2. **Phase 4 (Three.js -> WebGPU) Stage B (Custom Render Passes)**: Begin replacing specific materials with `RawShaderMaterial` / WebGPU pipelines (e.g., cloud or terrain draws) per `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`.
3. **Phase 4 (Three.js -> WebGPU) Stage C (Scene Graph Replacement)**: Once compute + custom render passes are in place, migrate scene hierarchy to an ECS in WASM and call `device.queue.submit()` directly.

---

## Recent Progress
- **Accomplished:**
  - **Phase 4 targets (Falling Berries Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Migrated `src/foliage/berries.ts` falling berry physics loop to utilize WebGPU Compute Shaders. Added `StorageInstancedBufferAttribute` for position, life, velocity, and scale tracking natively on the GPU using TSL `Fn().compute()`. Kept a lightweight CPU proxy strictly for trigger and collection distance checks, eliminating the heavy O(N) `.setMatrixAt` and array writes.*
  - **Phase 4 targets (Glitch Grenades Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Migrated `src/systems/glitch-grenade.ts` to utilize WebGPU Compute Shaders. Added `StorageInstancedBufferAttribute` for position, life, and velocity tracking on the GPU using TSL `Fn().compute()`. Maintained a CPU proxy only for triggering the explosion and checking ground collisions, mirroring the hybrid approach used in Rainbow Blasters.*
  - **Phase 4 - Compute Shaders (GPGPU) - Waterfall Splashes**: **Status: Implemented ✅**
    - *Implementation Details: Replaced the CPU-driven splash particle simulation loop in `src/foliage/waterfalls.ts` with a TSL WebGPU compute shader utilizing `StorageBufferAttribute`. Implemented floor collision logic and audio-reactive velocity impulses (`uPulseIntensity`) purely on the GPU.*
  - **Verify Data Flow (`AudioSystem`)**: **Status: Implemented ✅**
    - *Implementation Details: Updated `src/main.ts` and `index.html` with a Tracker Status HUD UI element that continuously monitors and displays the current Pattern (`order`) and Row. This verified that `AudioSystem` correctly extracts and passes tracker data from the worklet to the main thread.*
  - **Phase 4 (Three.js -> WebGPU) Stage B (Weather Particles)**: **Status: Implemented ✅**
    - *Implementation Details: Rewrote the legacy CPU/WASM particle system to use WebGPU Compute Shaders (`ComputeParticleSystem`) for weather effects (rain and mist). Moved physics updates and audio-reactive behavior completely to the GPU, and removed `LegacyParticleSystem` and `WasmParticleSystem`.*
  - **Phase 4 targets (Jitter Mines Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Offloaded JitterMineSystem CPU-side matrix updates to WebGPU TSL Vertex Shaders. Used `InstancedBufferAttribute` and a custom Rodrigues' rotation formula in TSL to provide stateless, time-based particle rotation and scaling updates on the GPU without manual instanceMatrix updates on the CPU.*
  - **Phase 4 - Compute Shaders (GPGPU) - Harmony Orbs**: **Status: Implemented ✅**
    - *Implementation Details: Rewrote the `HarmonyOrbSystem` in `src/foliage/aurora.ts` to utilize WebGPU Compute Shaders. All physics (gravity, wind sway) and lifecycle updates were offloaded from the CPU to the GPU via TSL `Fn().compute()`. `StorageInstancedBufferAttribute` buffers map directly to the TSL material.*
  - **Phase 4 targets (Sparkle Trail Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Migrated `SparkleTrail` in `src/foliage/sparkle-trail.ts` to utilize WebGPU Compute Shaders. Replaced CPU-side array mutations with `StorageInstancedBufferAttribute` and handled spawning and physics completely on the GPU via TSL `Fn().compute()`. Added uniform variables for passing dynamic player data (velocity, position) to the shader.*
  - **Phase 4 targets (Rainbow Blaster Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Migrated `rainbow-blaster.ts` to utilize WebGPU Compute Shaders. Replaced CPU-side Matrix4 updates with `StorageInstancedBufferAttribute`. Handled physics (position, scale, life decay) entirely on the GPU via TSL `Fn().compute()`, while maintaining a CPU proxy array exclusively for collision logic with clouds, geysers, and traps.*
  - **Planning Debt Resolution**: **Status: Implemented ✅**
    - *Implementation Details: Extracted all completed features into `archive/COMPLETED_FEATURES.md`. Cleaned up `plan.md` and `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md` to remove the bloat from successfully implemented items.*
  - **Plan Consolidation Task**: Added `weekly_plan.md` directive. **Status: Implemented ✅**
    - *Implementation Details: Updated `weekly_plan.md` with a note to review, fix, and archive all old plan files because all active categories are mostly filled with 'Implemented' tasks.*
  - **Phase 4 targets (Impacts Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Migrated `src/foliage/impacts.ts` to utilize WebGPU Compute Shaders. Swapped `InstancedBufferAttribute` with `StorageInstancedBufferAttribute` and handled physics, scale, and color strictly inside a WebGPU TSL compute node using `renderer.compute(computeNode)`. Spawns are queued via uniforms to eliminate per-frame CPU iteration.*
  - **Phase 4 targets (Compute Shaders - Remaining)**: **Status: Implemented ✅**
    - *Implementation Details: Updated the main rendering loop and procedural generation in `src/world/generation.ts` and `src/core/game-loop.ts` to utilize the modern GPU `ComputeParticleSystem` implementations for Fireflies and Pollen via their drop-in replacements (`createIntegratedFireflies`, `createIntegratedPollen`), enabling significantly higher particle counts (e.g. 50k for fireflies) and moving complex physics and collision detection entirely to WebGPU Compute Shaders.*

*(Note: The full list of past accomplishments and completed plan categories has been moved to `archive/COMPLETED_FEATURES.md` to resolve planning debt).*

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [DONE]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM. [DONE]
3. **Phase 3 (ASC -> C++):** Specialized solvers. [DONE]
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines. [IN PROGRESS]
        // 🎨 Palette: Juice up the explosion with shake and sound
        if (typeof (window as any).addCameraShake === 'function') {
             (window as any).addCameraShake(0.8);
        }
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
             (window as any).AudioSystem.playSound('explosion', { position, pitch: 0.5 + Math.random() * 0.5 });
        }
    }
```
Wait, `glitch-grenade.ts` imports from `src/core/game-loop.ts`? No, it imports `addCameraShake`? Actually we can just import `addCameraShake` in `glitch-grenade.ts` if it's not imported:
`import { addCameraShake } from '../core/game-loop.ts';`

I can just use `request_plan_review` with this.

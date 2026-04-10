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

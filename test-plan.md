1. **Understand the Goal**: As Bolt ⚡, I need to find an orphaned system and implement proper `.dispose()` cleanup to prevent VRAM leaks (Memory Rescue). The user recommended picking one of the three systems (`chord-strike.ts`, `rainbow-blaster.ts`, `glitch-grenade.ts`) that is rebuilt often.

2. **Select Target**: Based on grep results, `chord-strike.ts` and `rainbow-blaster.ts` have re-instantiations (`_chordStrikeSystem = new ChordStrikeSystem()` and `_projectilePool = new ProjectilePool()`). `glitch-grenade.ts` does not.
Between `chord-strike.ts` and `rainbow-blaster.ts`, `chord-strike.ts` is simpler and safer to start with. It creates a `THREE.Mesh`, a `THREE.CylinderGeometry`, and a `MeshStandardNodeMaterial`.

3. **Plan Details for `chord-strike.ts`**:
   - Implement `dispose()` in `ChordStrikeSystem`.
   - In `dispose()`, use `safeRemoveAndDispose(this.mesh.parent, this.mesh)` or call `this.mesh.removeFromParent()` and dispose geometry/material manually. Since the instruction says "Reuse the existing `safeRemoveAndDispose` helper where you can", we should import it and use it. Wait, `safeRemoveAndDispose(this.mesh.parent || scene, this.mesh)`. The user said: "Reuse the existing `safeRemoveAndDispose` helper where you can, as `weather-effects.ts` does." Wait, in `weather-effects.ts`, it's `safeRemoveAndDispose(this.scene, state.rainMesh)`. But `ChordStrikeSystem` doesn't keep a reference to `scene`. We can just use `if (this.mesh.parent) safeRemoveAndDispose(this.mesh.parent, this.mesh)`. But wait, `safeRemoveAndDispose` from `src/utils/dispose-utils.ts` expects `scene: THREE.Object3D, obj: ...`. So `if (this.mesh.parent) safeRemoveAndDispose(this.mesh.parent, this.mesh);`.
   - Ensure we also check if `this.mesh` exists.

4. **Testing**: Write a unit test `tests/chord-strike-dispose.test.ts`. Mock `geometry.dispose` and `material.dispose` with spies and check `scene.children` before and after.
   - `npm run test:fast` to run tests.

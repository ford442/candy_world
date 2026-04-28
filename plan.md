1. **Update Master Plan:**
   - Modify `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md` to strike out or mark Stage B and Stage C under Phase 4 as [DEPRECATED - Superseded by TSL & InstancedMesh Batching]. (This is mandated by the user).
2. **Implement Day/Night Plant Pose State Machine:**
   - Update `src/core/config.ts` to add `plantPose.flower` config for the state machine.
   - Update `src/foliage/flower-batcher.ts` to instantiate `PlantPoseMachine` with `MAX_FLOWERS` capacity.
   - Introduce `aPoseState` as an `InstancedBufferAttribute` to petals in `src/foliage/flower-batcher.ts`.
   - Add `update(time: number, audioState: any, dayNightBias: number)` method to `src/foliage/flower-batcher.ts`. Call `this._poseMachine.update(...)`. Write results to `mesh.geometry.attributes.aPoseState.array`, and flag `needsUpdate = true`. Also add `update` call in `src/systems/music-reactivity.ts` inside `updateFoliage`.
   - Update `src/foliage/material-core.ts` to modify `calculateFlowerBloom` to read `attribute('aPoseState', 'float')` and use it to drive the expansion/bloom logic.
   - Update `src/rendering/shader-warmup.ts` to add `geometry.setAttribute('aPoseState', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 1));` to the dummy geometry.
3. **Verify changes:**
   - Run `pnpm build` to confirm the TypeScript compiles without errors.
4. **Run all relevant tests:**
   - Run `pnpm test` to ensure the changes are correct and have not introduced regressions.
5. **Pre-commit Checks:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
6. **Submit:**
   - Call `submit` to push the changes.

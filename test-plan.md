1. **Add Uniforms to `src/foliage/material-core/shared-resources.ts`**:
    - Add `uVineAnchor`, `uVineTip`, and `uVineFlare` global uniforms.
2. **Export Uniforms from `src/foliage/material-core.ts`**:
    - Ensure these new uniforms are exported for use in physics updates and shaders.
3. **Enhance `enhanceWithFloralJuice` in `src/foliage/trees-core.ts`**:
    - Compute the closest distance between `positionWorld` and the line segment defined by `uVineAnchor` and `uVineTip`.
    - Falloff the flare effect based on distance, e.g., using a radius of 0.6.
    - Multiply `createJuicyRimLight` by `uVineFlare` combined with the falloff, and add it to the material's emissive node.
4. **Update Uniforms in `src/systems/physics/physics-states.ts`**:
    - In `updateVineState` while the player is attached (`activeVineSwing` exists), set `uVineAnchor` to `activeVineSwing.anchorPoint`, `uVineTip` to `player.position`, and `uVineFlare` to `Math.min(1, Math.abs(activeVineSwing.swingAngularVel) * 5)`.
    - On detach, set `uVineFlare.value = 1`.
5. **Decay `uVineFlare` in `updateVineState`**:
    - Ensure that when no vine is attached, if `uVineFlare.value > 0`, it decays toward 0 using `delta` (e.g., `Math.max(0, uVineFlare.value - delta * 2)`).
6. **Pre-commit**: Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
7. **Submit**: Submit the branch with a descriptive commit message matching the Bolt/Palette conventions.

1. **Understand the goal**: As Palette 🎨, I will add high-impact visual polish to `src/foliage/subwoofer-lotus-batcher.ts`. Specifically, I will add a **TSL Juicy Rim Light** and **TSL Wind Sway** to the newly implemented Subwoofer Lotus rings.
2. **Implementation details**:
   - In `subwoofer-lotus-batcher.ts`, update `init()` to construct `ringMat` using `getCachedProceduralMaterial('subwoofer_lotus_ring', 0xFFFFFF, () => { ... })` instead of a naked `new MeshStandardNodeMaterial()`. This respects the crucial "Module-level Material Cache" rule to prevent WebGPU compilation freezes.
   - Import `getCachedProceduralMaterial`, `createJuicyRimLight`, and `calculateWindSway` from `./index.ts`.
   - In the `ringMat` TSL setup:
     - Compute the normal emission.
     - Add `createJuicyRimLight(finalColor, float(2.0), float(3.0), null)` to the emissive node.
     - Compute `calculateWindSway(newPos)` and add it to the position node.
3. **Pre-commit**:
   - Run `pre_commit_instructions` tool to get the pre-commit instructions, and ensure all checks (like tests, formatting) pass.
4. **Submit**:
   - Submit the PR with the exact title format required: "🎨 Palette: [Visual/UX Improvement]" such as "🎨 Palette: Add TSL Rim Light and Wind Sway to Subwoofer Lotus". Include the description mentioning the Visual Change, Juice Factor, and Technical details.

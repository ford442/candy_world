# plan.md

## Objective
Split the mega-module `src/foliage/mushroom-batcher.ts` (~944 lines) into smaller sub-modules using a domain barrel approach, similar to what was done for `trees.ts`. This satisfies the architectural rule of breaking down files larger than 700 lines.

## Plan

1. **Create Sub-modules:**
   - Extract `MushroomBatcher` class logic into `mushroom-batcher-class.ts`.
   - Extract geometry merging logic (`createMergedGeometry`) into `geometry.ts`.
   - Extract TSL material creation logic (`createMaterials`) into `materials.ts`.
   - Any shared constants, imports, or type definitions will be placed in `types.ts` or `constants.ts` as needed.

2. **Refactor `mushroom-batcher.ts`:**
   - Modify the original file to act solely as a barrel module (re-exporting from the newly created files), preserving the original API.

3. **Verify:**
   - Run `npm run typecheck` to ensure no circular dependencies or missing exports.
   - Run `npm run test` to verify logic integrity.

4. **Update Documentation:**
   - Update `plan.md` to mark this mega-module split as completed, similar to the entry for `trees.ts`.

5. **Complete pre-commit steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

6. **Submit:**
   - Commit the changes and submit the PR.

- **Status: Implemented ✅** (Split mushroom-batcher.ts)
  - Implementation Details: Split the massive `mushroom-batcher.ts` file by extracting `MushroomBatcher` class logic, geometry merging, and TSL material creation into `mushroom-batcher.ts`, `geometry.ts`, and `materials.ts` within a new `mushroom-batcher` directory. Maintained `src/foliage/mushroom-batcher.ts` as the public barrel by re-exporting the newly split modules, effectively resolving the 944-line module size while keeping the public API stable and satisfying domain architecture requirements.

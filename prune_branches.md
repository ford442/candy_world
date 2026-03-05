# prune_branches.md

This document catalogues the three long‑lived branches in `candy_world` and
identifies the useful ideas or features that could be cherry‑picked back to
`main`.  It also calls out areas where conflicts will need to be resolved if
we ever attempt a full merge.

## Branches under consideration

1. **bolt/optimize-simple-flowers-3889742903034480911**
2. **copilot/add-ideas-from-plan-md**
3. **jules-dev3**

---

## 1. bolt/optimize-simple-flowers-... ⚡

### Notable features / ideas

- **Simple flower batching**: groups of simple flower meshes are rendered using
  instanced draws to reduce draw calls.
- **Impact system refactor**: rewrote impact visuals to use `InstancedMesh` and
  a tiny shading language (TSL) for better performance and WebGPU compatibility.
  The commit message refers to improved visuals as a side effect.

### Potential value for `main`

- The batching code could drastically reduce CPU/GPU cost during foliage
  heavy scenes.  The refactored impact/TSL logic is reusable in the current
  WebGL renderer.

### Status

✅ **Extracted**: `SimpleFlowerBatcher` class and impact system TSL refactor
have been incorporated into `main`. Files `src/foliage/simple-flower-batcher.ts`
and updated `src/foliage/impacts.js` are present and functional.

---

## 2. copilot/add-ideas-from-plan-md 🤖

### Notable features / ideas

- **Audio subsystem removal**: `audio-system.js` is deleted entirely and
  `main.js` updated accordingly.  This reflects a decision to either move the
  audio code elsewhere or remove it in favour of a new design.
- A handful of plan‑related tweaks in `main.js` – likely placeholders for
  features called out in `plan.md`.

### Potential value for `main`

- If the project is going to adopt a new audio architecture (e.g. WebAudio
  Worklets or WASM DSP) the branch offers a clean slate and a pointer to what
  needs replacing.

### Status

❌ **Not extracted**: The audio deletion is too disruptive for current `main`
which still relies on audio functionality. However, the foliage spawning
enhancements (flowering trees, glowing flowers, floating orbs, vines) could be
cherry‑picked if more world variety is desired.

---

## 3. jules-dev3 🌲

This branch is essentially a second codebase; it was an ambitious refactor that
migrated the entire tree to TypeScript and introduced a spatial-hash based
world system plus dozens of new foliage modules, tests, documentation, and
WASM/TSL tooling.

### Notable features / ideas

- **TypeScript rewrite**: `main.ts` plus conversion of most `src/` files and
  new definitions in `assembly/`, `verification/`, and utilities.
- **Spatial hash utility**: new `src/utils/spatial-hash.js` for efficient
  neighbor queries, plus a proposal and test results documentation.
- **Foliage expansion**: a huge number of new/rewritten foliage systems –
  clouds, aurora, fireflies, ribbons, overlay, etc.  These improve visuals and
  performance.
- **WASM/TSL tooling**: `emscripten/build.sh`, `tools/optimize.sh`, new tests,
  and guidelines for using TSL safely.
- **Music-reactivity** and audio integration rewrites (migrated to TS).
- Dozens of MD documents outlining design plans, performance strategy,
  validation guides, etc.

### Potential value for `main`

- Any of the individual subsystems (spatial hash, foliage modules, TSL
  utilities) could be lifted incrementally.
- The documentation files are a treasure trove of design knowledge that should
  be referenced regardless of whether the code is merged.

### Status

✅ **Partially extracted**: The `SpatialHashGrid` utility has been added to
`src/utils/spatial-hash.js` on `main`. Many foliage modules and documentation
have been incorporated. The full TS rewrite remains separate due to scope.

---

## Recommendations

- **Keep the branches around** for reference but treat them as archives.  Do
  not attempt to merge them all at once.
- **Cherry‑pick useful pieces**: copy over optimized flower batching code,
  spatial-hash helper, and any documentation you need.  Re‑implement them in
  the current code style rather than merging whole files.
- **Document conflicts in this file** so future developers know why the branches
  were pruned and what ideas they contained.

> ✅ **Branches pruned**: All three branches have been deleted locally and remotely
> as their useful features have been extracted into `main`. This document serves
> as an archive of what was contained in those branches.

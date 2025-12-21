# Foliage System Architecture & Developer Guide

**Last Updated:** [Current Date]
**Status:** Stable (Recent fixes applied to material registry)

## 1. System Overview
The Candy World foliage system creates procedural vegetation using Three.js and TSL (Three Shading Language). It relies on a centralized material registry to ensure consistent styling and reactivity to music/weather.

### Core Modules
* **`src/foliage/common.js`**: The "Source of Truth." Contains shared resources (`foliageMaterials`), reactive object registries, and TSL material helpers (`createClayMaterial`).
* **`src/foliage/factories/*.js`**: (e.g., `flowers.js`, `trees.js`) specialized functions that return `THREE.Group` hierarchies.
* **`src/world/generation.js`**: Orchestrates spawning. It loads `assets/map.json` for fixed objects and runs `populateProceduralExtras()` for random vegetation.

## 2. The "Missing Material" Trap (Crucial)
**Issue:** A common crash involves `TypeError: Cannot read properties of undefined (reading 'clone')`.
**Cause:** Factory functions (e.g., `createFiberOpticWillow`) often try to clone materials like `foliageMaterials.opticTip`. If this key is missing from `src/foliage/common.js`, the app crashes during world generation.

**Rule for Agents:**
> **Before creating a new foliage type that relies on a shared material, YOU MUST add that material definition to the `foliageMaterials` object in `src/foliage/common.js`.**

### Essential Materials List
Ensure `src/foliage/common.js` always exports:
* `stem`, `trunk`, `vine`
* `flowerCenter`, `petal`
* `lightBeam` (used for glowing effects)
* `opticCable`, `opticTip` (used for Fiber Optic Willow)
* `lotusRing` (used for Subwoofer Lotus)

## 3. Spawning Logic (`src/world/generation.js`)
* **Safe Adding:** We use `safeAddFoliage(obj, isObstacle, radius)` to register objects. This pushes them to `animatedFoliage` arrays for the animation loop.
* **Map vs. Procedural:**
    * **Map Data:** Fixed positions from `map.json`.
    * **Procedural:** `populateProceduralExtras` scatters flowers/trees. *Current limitation:* Uses pure random distribution, which can cause overlapping.

## 4. Reactivity System
Objects are made "reactive" (bouncing to music, swaying in wind) via `attachReactivity(group)` in `common.js`.
* **Tagging:** Objects are tagged with `userData.animationType` (e.g., `'wobble'`, `'fiberWhip'`).
* **Execution:** `src/foliage/animation.js` iterates through `reactiveObjects` and applies transforms based on audio data.

## 5. Future Improvements (Roadmap)
1.  **Instancing:** Currently, every flower is a unique `Group`. We need to migrate high-frequency objects (like simple grass or basic flowers) to `InstancedMesh` for performance.
2.  **Collision Optimization:** `obstacles` array is checked linearly. Need a QuadTree or spatial hash if object count exceeds 1000.
3.  **Poisson Disk Sampling:** Replace `Math.random()` in `generation.js` to ensure even spacing of vegetation.

---
*Note to Copilot/Jules: If the user reports a "spawn error" or "undefined clone," 99% of the time it is a missing entry in `foliageMaterials` inside `src/foliage/common.js`.*

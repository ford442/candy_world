# Candy Material Cookbook

Recipes for Candy World's glossy, music-reactive surfaces. **Reuse these before
hand-rolling a material** — every recipe maps to a real `CandyPresets.*` factory or
a shipping batcher you can copy from.

- Presets & helpers: [`src/foliage/material-core.ts`](../src/foliage/material-core.ts)
- Aesthetic values: [`src/core/config.ts`](../src/core/config.ts) (`PALETTE`, `noteColorMap`)
- Music binding conventions (authoritative): **[`AGENTS.md`](../AGENTS.md) →
  "Music Reactivity & Biome / Channel-to-Shader Binding Conventions"**

> All values below are pulled from the live source. When you change a recipe,
> change it here too.

---

## Recipe table

| Recipe | Preset / approach | Key values | Music hook | Live example |
|--------|-------------------|------------|------------|--------------|
| Glossy mushroom cap | clearcoat material + rim light | clearcoat ~0.8, roughness ~0.3, metalness 0 | `BiomeUniforms.crystallineNebula.noteColor` (emissive) | [`mushroom-batcher.ts`](../src/foliage/mushroom-batcher.ts) |
| Translucent gummy fruit | `CandyPresets.Gummy` | transmission 0.9, thickness 1.5, ior 1.4, subsurfaceStrength 0.6 | `shimmer` color mix | `material-core.ts` `Gummy` |
| Crystal gem | `CandyPresets.Crystal` + emissive + rim | transmission 1.0, ior 2.0, iridescence 0.7 | `gemCanopy.noteColor` (note→color LUT) | [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) |
| Glass mycelium | `Crystal` base + emissive vein network | transmission 0.85, roughness 0.06, fake SSS | `LuminousPlantUniforms.intensity` + `uAudioLow` ripple | [`glass-mushroom-batcher.ts`](../src/foliage/glass-mushroom-batcher.ts) |
| Matte ground / rocks | `CandyPresets.Clay` | roughness 0.8, bumpStrength 0.15, rimStrength 0.3 | none | terrain / props |
| Frosted sugar crust | `CandyPresets.Sugar` | roughness 0.6, sheen 1.0, bumpStrength 0.8 (noiseScale 60) | none / `createSugarSparkle` | snow / candy crust |
| Velvet petal | `CandyPresets.Velvet` | roughness 1.0, sheen 1.0 (colored), bumpStrength 0.05 | optional `shimmer` | [`flower-batcher.ts`](../src/foliage/flower-batcher.ts) |
| Twilight glow (any) | any preset + `uTwilight` | multiply emissive by `uTwilight` × `circadianGlowMult` | circadian (`uCircadianPhase`) | [`luminous-plant-batcher.ts`](../src/foliage/luminous-plant-batcher.ts) |

`CandyPresets` keys: `Clay`, `Sugar`, `Gummy`, `SeaJelly`, `Crystal`, `Velvet`,
`OilSlick` — all in `material-core.ts`. Each takes `(hex, opts?)` and returns a
`MeshStandardNodeMaterial`; spread `...opts` to override any value.

```ts
import { CandyPresets } from '../foliage/material-core.ts';

const cap   = CandyPresets.Gummy(0xFF69B4);                 // pastel pink, soft glow
const gem   = CandyPresets.Crystal(0xE0115F, { side: THREE.DoubleSide });
const ground = CandyPresets.Clay(0xBFA76F);                 // matte, tactile
```

---

## Copy-paste TSL snippets

All helpers are exported from
[`material-core.ts`](../src/foliage/material-core.ts). Import what you need:

```ts
import {
  CandyPresets, getCachedProceduralMaterial,
  createJuicyRimLight, createRimLight, createSugarSparkle,
  applyPlayerInteraction, calculateWindSway,
  uTime, uAudioLow, uAudioHigh,
} from '../foliage/material-core.ts';
import { color, float, mix, positionLocal } from 'three/tsl';
```

### Juicy rim light (audio-reactive edge glow)

Args are TSL nodes: `(baseColor, intensity, power, normalNode | null)`. Adds a
view-dependent edge glow that pulses on `uAudioHigh` and shifts toward cyan on loud
melody.

```ts
const rim = createJuicyRimLight(color(0xE0115F), float(1.5), float(3.0), null);
material.emissiveNode = baseEmissive.add(rim.mul(0.5));
```

For a plain (non-reactive) rim use `createRimLight(colorNode, intensity, power, normalNode)`.

### Player interaction + wind sway (vertex displacement)

Wrap your final position node so plants get pushed by the player and sway in wind.
Order matters — apply sway, then player push:

```ts
const swayed = positionLocal.add(calculateWindSway(positionLocal));
material.positionNode = applyPlayerInteraction(swayed);
```

### Sugar sparkle (candy glitter)

```ts
import { normalWorld } from 'three/tsl';
const sparkle = createSugarSparkle(normalWorld, float(15.0), float(0.3), float(2.0));
material.emissiveNode = material.emissiveNode.add(sparkle);
```

### Cache procedural materials (avoid recompiles)

`getCachedProceduralMaterial(key, colorHint, factory)` returns a singleton per key —
build the TSL graph once and share it across instances:

```ts
const stemMat = getCachedProceduralMaterial('my_plant_stem', 0xFFFFFF, () => {
  const m = CandyPresets.Gummy(0x88FF88) as MeshStandardNodeMaterial;
  m.positionNode = applyPlayerInteraction(positionLocal.add(calculateWindSway(positionLocal)));
  return m;
});
```

### Twilight / circadian glow

Multiply emissive so plants brighten at night and dim by day. `uTwilight` lives in
[`sky.ts`](../src/foliage/sky.ts); `uCircadianPhase` in
[`biome-uniforms.ts`](../src/systems/biome-uniforms.ts) (0 = night, 1 = day).

```ts
import { uTwilight } from '../foliage/sky.ts';
import { uCircadianPhase } from '../systems/biome-uniforms.ts';
import { CONFIG } from '../core/config.ts';

const nightMult = mix(float(CONFIG.circadian.nightGlowMultiplier), float(1.0), uCircadianPhase);
material.emissiveNode = baseColor.mul(uTwilight).mul(nightMult);
```

---

## Tutorial: adding a reactive plant

Goal: a new plant whose glow follows a tracker channel. This mirrors the shipping
[`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) /
[`glass-mushroom-batcher.ts`](../src/foliage/glass-mushroom-batcher.ts). The
authoritative step list is in **AGENTS.md**; this is the worked example.

**1. Bind channels in `assets/music-bindings.json`.** Either add a biome block or
reuse an existing one:

```json
"biomes": {
  "my_grove": { "shimmer": [3, 4], "hueShift": [5], "noteColor": [3] }
}
```

**2. Declare TSL uniforms in [`biome-uniforms.ts`](../src/systems/biome-uniforms.ts)**
(create **once**, never reassign), and add the biome to the `BiomeId` union and the
`getBiomeUniforms()` switch:

```ts
myGrove: {
  shimmer: uniform(0.0),
  hueShift: uniform(0.0),
  noteColor: uniform(new THREE.Color(0xffffff)),
},
```

**3. Drive the values each frame in
[`music-reactivity.ts`](../src/systems/music-reactivity.ts)** — pre-parse the channel
lists to `readonly number[]`, accumulate, and mutate `.value` in place (colors via
`.lerp`). Night/twilight-gate if appropriate. *Zero allocations on this path.*

> Shortcut: a companion biome can simply **reuse** an existing binding — the glass
> mycelium reads `LuminousPlantUniforms` rather than defining its own, so steps 1–3
> reduce to "pick an existing biome."

**4. Reference the uniforms in your batcher's TSL graph:**

```ts
const u = getBiomeUniforms('my_grove');
material.colorNode    = mix(color(BASE_HEX), u.noteColor, u.shimmer);
material.emissiveNode = material.colorNode.mul(u.shimmer.mul(2.0).add(0.3));
// bass-reactive vertex pop:
const pop = positionLocal.add(normalLocal.mul(uAudioLow.mul(0.1)));
material.positionNode = applyPlayerInteraction(pop.add(calculateWindSway(pop)));
```

**5. Register the archetype + place it.** Add a factory + `registerType('my_plant', …)`
in [`foliage-registry.ts`](../src/world/foliage-registry.ts), set `userData.biome`,
and spawn it from [`generation-decorators.ts`](../src/world/generation-decorators.ts)
with `recordSpawnAttempt('my_plant', ok)`. Add a `batcher-telemetry.ts` entry so it
shows up in `window.__worldHealth`.

**6. Test in isolation** with a tracker that exercises only the target channel(s),
in both renderers (`?renderer=webgl`).

---


## Core Candy Material Foundations

Candy World materials favor atmosphere and glossy specularity over physical realism.

- **MeshPhysicalMaterial:** Most materials derive from this to support clearcoat and transmission.
- **Clearcoat:** The secret to the "Candy" look. Typically set high (`0.8`-`1.0`).
- **Roughness:** Keep low to mid (`0.1`-`0.4`) for gloss, unless aiming for matte clay.
- **Metalness:** Almost always `0`. Candy world relies on specular reflection and clearcoat, not metalness.
- **Transmission:** Used heavily for gummy, glass, or gem-like foliage.

## Foliage-Specific Patterns

When dealing with thousands of objects, **InstancedMesh Batchers** are required to maintain performance.

- **Use InstancedMesh:** Never add individual `Mesh` objects to the scene in hot loops or for dense foliage.
- **Batcher Registration:** Build a `THREE.Group` proxy, position/scale it, and register it with the appropriate batcher (e.g., `mushroomBatcher.register(proxy)`).
- **LOD Considerations:** Use squared distance comparisons (`distSq < limit * limit`) instead of `Math.sqrt` inside LOD culling loops.

## Common Gotchas & Performance Notes

- **Zero-Allocation Hot Paths:** Do not instantiate new `THREE.Vector3` or `THREE.Color` objects inside `animate()` or `update()` functions. Use module-scope `_scratch` variables.
- **Shader Recompilation Freezes:** Always use `getCachedProceduralMaterial` instead of instantiating new `MeshStandardNodeMaterial`s per object archetype to prevent WebGPU compilation stutter.
- **WASM Boundary:** Minimize crossing the JS/WASM bridge in loops. Calculate heavy bulk operations inside WASM or use flat typed array getters.
- **Attribute Disposal:** When disposing of InstancedMeshes, remember to explicitly dispose of custom `StorageInstancedBufferAttribute`s to prevent VRAM leaks.

## Appendix: `// Visual Impact:` inventory

Tunable visual constants are tagged with a `// Visual Impact:` comment explaining what
the value does, so the next contributor can tune confidently. List them with:

```bash
grep -rn "Visual Impact:" src/
```

Dense examples worth reading: `gem-fruit-batcher.ts` (clearcoat/emissive/shimmer),
`glass-mushroom-batcher.ts` (transmission, vein glow, bass ripple), and the god-ray
opacity caps + frustum gate in `game-loop.ts`.

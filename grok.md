# grok.md — Candy World Quick-Start

> **Read this first.** The 5-minute orientation for humans and agents. Deep
> conventions live in [`AGENTS.md`](./AGENTS.md) and [`CLAUDE.md`](./CLAUDE.md) —
> this file points you at them, it doesn't duplicate them.

**Candy World** (Siphon Part I) is a music-reactive, first-person 3D fantasy world
in WebGPU: glossy candy-colored nature (mushroom trees, gem canopies, glass
mycelium, floating clouds) with a strong bias toward **atmosphere over realism**.

- **Live demo**: https://go.1ink.us/candy-world/v0.9/index.html
- **Stack**: Three.js ^0.171 (WebGPU + TSL) · TypeScript · Vite · AssemblyScript/Emscripten WASM · libopenmpt (tracker music)

---

## Visual principles

1. **Glossy clearcoat candy.** Surfaces use `MeshPhysicalMaterial`/TSL with high
   clearcoat, low-to-mid roughness, zero metalness. Reach for a `CandyPresets.*`
   recipe (see the [Material Cookbook](./docs/CANDY_MATERIAL_COOKBOOK.md)) before
   hand-rolling a material.
2. **Pastel palette.** Pull colors from `PALETTE` and `noteColorMap` in
   [`src/core/config.ts`](./src/core/config.ts) — don't invent hex values. Day
   palette is soft sky-blue → peachy horizon → pink fog.
3. **Atmosphere > realism.** Soft pastels, rounded shapes, dreamy light. Gravity is
   intentionally floaty; god rays and bloom are features, not bugs.
4. **Annotate aesthetic choices.** Tag tunable visual constants with a
   `// Visual Impact:` comment so the next contributor knows what a value does
   (`grep -rn "Visual Impact:" src/`).
5. **60fps on mid-range.** Batch with InstancedMesh, reuse geometries/materials,
   zero allocations in the render loop (module-scope `_scratch*` only).

---

## File map

| Area | Where |
|------|-------|
| Entry / init pipeline | `src/core/main.ts`, `src/core/init.ts` |
| Render loop, day/night, god rays | `src/core/game-loop.ts` |
| Global config (palette, flags, postfx) | `src/core/config.ts` |
| Materials & TSL helpers | `src/foliage/material-core.ts` (`CandyPresets`, rim light, wind sway) |
| Batchers (InstancedMesh + TSL) | `src/foliage/*-batcher.ts` (tree, mushroom, gem-fruit, glass-mushroom, luminous-plant, …) |
| Post-processing (bloom, DoF, vignette) | `src/foliage/post-processing.ts` |
| **Music bindings (source of truth)** | `assets/music-bindings.json` |
| **Music → TSL uniforms** | `src/systems/biome-uniforms.ts` |
| **Per-frame binding/update** | `src/systems/music-reactivity.ts` |
| World gen & placement | `src/world/generation-core.ts`, `generation-decorators.ts`, `foliage-registry.ts` |
| Particles (compute + fallback) | `src/particles/compute-integration.ts` |
| Health / telemetry | `src/world/spawn-tracker.ts`, `world-health.ts` (`window.__worldHealth`) |

---

## Music reactivity flow (JSON → uniforms → batcher)

The whole pipeline, end to end:

1. **JSON** — `assets/music-bindings.json` is the single source of truth. Each biome
   block lists the tracker channels that drive it, e.g.
   `biomes.arpeggio_grove.shimmer: [3,4]`, plus `hueShift` / `noteColor`. Per-object
   `tracker_channel`s (portamento_pine, luminous_plants, …) live here too.
2. **Uniforms** — [`biome-uniforms.ts`](./src/systems/biome-uniforms.ts) declares the
   TSL `uniform()` surface: `BiomeUniforms.arpeggioGrove.{shimmer,hueShift,noteColor}`,
   `crystallineNebula`, `gemCanopy`, plus `LuminousPlantUniforms` and the note→color
   LUT textures. Created **once**; never reassigned.
3. **Update** — `MusicReactivitySystem.update()` in
   [`music-reactivity.ts`](./src/systems/music-reactivity.ts) reads the analyzed
   channels each frame and **mutates `.value` in place** (colors via `.lerp()`),
   gated by night/twilight. Zero allocations on this hot path.
4. **Batcher** — a `*-batcher.ts` TSL graph references those uniforms (e.g.
   `mix(baseColor, noteColorNode, shimmer)` for color, `uAudioLow`-driven vertex
   displacement for bass). The GPU does the rest.

> Tag a foliage object with `userData.biome` and resolve uniforms via
> `getBiomeUniforms(biome)` rather than importing `BiomeUniforms.xxx` directly.
> Full conventions + the exact "add a binding" steps are in **AGENTS.md →
> "Music Reactivity & Biome / Channel-to-Shader Binding Conventions"**.

---

## Materials in 30 seconds

```ts
import { CandyPresets } from './foliage/material-core.ts';
const cap = CandyPresets.Gummy(0xFF69B4); // translucent, inner glow, soft
```

Presets: `Clay` (matte ground), `Sugar` (frosted), `Gummy` (translucent),
`SeaJelly` (wet/wobbly), `Crystal` (refractive gem), `Velvet` (sheen), `OilSlick`
(iridescent). Recipes, key uniforms, music hooks, and copy-paste TSL snippets:
**[docs/CANDY_MATERIAL_COOKBOOK.md](./docs/CANDY_MATERIAL_COOKBOOK.md)**.

---

## First-PR checklist

```bash
npm install
npm run dev          # http://localhost:5173 (WebGPU: Chrome/Edge 113+)
npm run build        # full WASM + Emscripten + Vite build
npm run test:wasm    # particle physics bounds (~2s)
npm run test         # smoke / boot sequence (~2–3m)
```

- [ ] Materials reuse a `CandyPresets.*` recipe (or document why not).
- [ ] New visual tunables carry `// Visual Impact:` comments.
- [ ] No `new THREE.Vector3/Color` inside `animate()`/`update()` — scratch vars only.
- [ ] Reactive content goes through a batcher + TSL (not legacy per-mesh callbacks).
- [ ] Placement records via `recordSpawnAttempt(...)`; verify with
      `window.__worldHealth` after boot.
- [ ] Test both renderers when touching visuals: default WebGPU and `?renderer=webgl`.

**Useful URL flags:** `?explore=1` (orbit showcase) · `?renderer=webgl` ·
`?postfx=off|low|high` · `?dof` · `?no_luminous` / `?no_mycelium` (isolate subsystems).

---

## Go deeper

- [`AGENTS.md`](./AGENTS.md) — architecture, music-binding conventions, invariants (authoritative)
- [`CLAUDE.md`](./CLAUDE.md) — commands, directory guide, patterns
- [`docs/CANDY_MATERIAL_COOKBOOK.md`](./docs/CANDY_MATERIAL_COOKBOOK.md) — material recipes + reactive-plant tutorial
- [`docs/webgl-fallback.md`](./docs/webgl-fallback.md) — WebGPU↔WebGL2 parity & porting
- [`DEVELOPER_CONTEXT.md`](./DEVELOPER_CONTEXT.md) — complexity hotspots & "here be dragons"
- [`SETUP_GUIDE.md`](./SETUP_GUIDE.md) — native module / Emscripten setup

This world already feels magical — keep it documented so it stays effortless. 🍭✨

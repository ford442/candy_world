# Candy Aesthetic Guardrails

**Living doc.** Companion to [`CANDY_MATERIAL_COOKBOOK.md`](./CANDY_MATERIAL_COOKBOOK.md):
the cookbook says _how_ to build a surface, this says _which advanced rendering features
to refuse, tone down, or reach for_.

Candy World is **pastel, glossy, dreamy, clay/gummy**. Every advanced lighting feature
(CSM, GI, SSR, SSS, AO, extra lights) ships in engine samples tuned for **photorealism** —
grey bounce, dirty cavities, hard sun disks, physically-correct falloff. Those defaults are
wrong here. Adopting a feature means **re-tuning it toward candy**, not enabling it as-is.

> **No photoreal default.** GI, AO, and SSR arrive grey and contrasty. If a PR lands one
> at sample defaults, the world stops being candy — that is a bug, not a taste dispute.

---

## Agent preamble (copy into lighting / rendering issues)

```
Candy World is pastel, glossy, dreamy — clay and gummy, not photoreal.
Advanced lighting features must be re-tuned toward candy, never enabled at engine defaults.
Keep hues pastel and saturated: shadows and cavities tint pink/lilac, never grey.
No hard sun disks, no filmic dirt, no gritty contrast; softness and bloom over accuracy.
Read docs/CANDY_AESTHETIC_GUARDRAILS.md before touching CSM/GI/AO/SSR/SSS or adding lights.
```

---

## Feature triage

### ✅ Stay candy-first — reach for these

| Feature                  | Why it fits                                          | Where                                                |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| Soft PCF shadows         | Buttery contacts on glossy surfaces, no razor edges  | [`SHADOW_SOFTNESS.md`](./SHADOW_SOFTNESS.md)         |
| Pastel bounce / probe GI | Coloured leak, tinted interiors — never grey fill    | [`IRRADIANCE_PROBES.md`](./IRRADIANCE_PROBES.md)     |
| Gummy SSS / translucency | Core of the `Gummy` / `SeaJelly` / `Crystal` presets | Cookbook → Surface knobs                             |
| Dream bloom              | The signature glow; strength stays audio-driven      | [`POSTFX_STACK.md`](./POSTFX_STACK.md)               |
| Coloured fog             | Warm pink/peach depth cue, part of the palette       | `src/core/config/palette.ts` (`fog` per cycle entry) |
| Clearcoat + sheen        | Glazed candy shell, frosted sugar crust              | `CandyPresets.Sugar` / `.Gummy`                      |

### ⚠️ Use sparingly — justify in the PR

| Feature                               | Condition                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSR                                   | Not in the stack today; mirrors use `getDreamEnvTexture()`. Adding it needs a budget pass **and** a tint pass — reflections stay pastel, not chrome.             |
| AO (GTAO)                             | Only `high`/`?ao`, half-res, cavity tinted pink-cocoa `(0.88, 0.74, 0.84)`. Never `low`/CI.                                                                      |
| Volumetric shafts                     | Gated to sunrise/sunset/moon + frustum. Soft additive planes — not god-ray realism.                                                                              |
| Extra spot / point lights             | Clustered lighting has a budget; each new light must earn its slot. See [`CLUSTERED_LIGHTS.md`](./CLUSTERED_LIGHTS.md) / [`LOCAL_LIGHTS.md`](./LOCAL_LIGHTS.md). |
| Sharpened / high-contrast tonemapping | Crushes pastels toward grey. Only with before/after screenshots.                                                                                                 |

### ❌ Avoid — refuse by default

| Feature                            | Why it breaks the look                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Filmic / dirty AO                  | Grey grime in every crevice; reads as mud, not candy                  |
| Photoreal sun disks, lens flares   | Hard specular sun and anamorphic streaks are renderer-demo tells      |
| Grey / neutral GI bounce           | Desaturates albedo — the single fastest way to kill the palette       |
| Motion blur                        | Fights `prefers-reduced-motion` (see `src/systems/accessibility.ts`)  |
| Physically-correct exposure sweeps | Auto-exposure hunting makes the pastel sky drift                      |
| Desaturating albedo for "realism"  | Albedo is never desaturated — tint the _light_, never the base colour |

---

## Palette reminders

- Pastels: `#FF69B4` (hot pink), `#87CEFA` (light sky blue), `#98FB98` (mint), `#FFD1DC` (blush).
  Canonical cycle palettes live in [`src/core/config/palette.ts`](../src/core/config/palette.ts) (`PALETTE`).
- **Roughness:** `0.2–0.4` shiny candy, `~0.8` clay/matte ground and trunks.
- **Clearcoat:** on for glossy shells (`Sugar` ≈ 0.7); opt-in for `Gummy`.
- **Metalness:** ~0 except deliberate `OilSlick` accents.
- Shadows, cavities, and bounce carry **hue**. If a tuned value trends toward grey, it is wrong.
- Mark tuned values with `// PALETTE:` (foliage) or `// Visual Impact:` (systems) per
  [`AGENTS.md`](../AGENTS.md) → Visual / Aesthetic Conventions.

---

## Quality tiers

`low` must still look **candy** — cheaper, not greyer. Tiers (`QualityTier` in
[`culling-types.ts`](../src/rendering/culling/culling-types.ts)): `low` / `medium` / `high` / `ultra`.

- Dropping a tier removes **cost** (probe volume, GTAO, DoF, shadow cascades), never **hue**.
- The `low` fallback for a feature is the pre-feature graph plus its pastel ambient — not a
  flat grey approximation of it.
- Verify the cheap path visually, not just by frame time. See [`TIER_PARITY.md`](./TIER_PARITY.md).

---

## PR checklist

- [ ] Screenshot attached, or the look described in words ("pastel bounce off the pink caps").
- [ ] **If it looks like a renderer sample, it is wrong.** Re-tune before merging.
- [ ] No new grey: shadows, cavities, and bounce still carry hue.
- [ ] Albedo untouched — light was tinted, base colours were not desaturated.
- [ ] `low` tier checked visually and still reads as candy.
- [ ] Motion-heavy effects respect `prefers-reduced-motion`.
- [ ] Tuned constants carry a `// PALETTE:` or `// Visual Impact:` comment.

---

## See also

- [`CANDY_MATERIAL_COOKBOOK.md`](./CANDY_MATERIAL_COOKBOOK.md) — presets, TSL patterns, surface knobs
- [`AGENTS.md`](../AGENTS.md) — Visual / Aesthetic Conventions
- [`POSTFX_STACK.md`](./POSTFX_STACK.md) · [`SHADOW_SOFTNESS.md`](./SHADOW_SOFTNESS.md) · [`IRRADIANCE_PROBES.md`](./IRRADIANCE_PROBES.md)

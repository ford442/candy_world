# Shadow softness (PCF + cheap PCSS)

Candy World wants **buttery contact shadows** on glossy surfaces, not razor
silhouettes and not film-grain PCSS. Softness is artist-tunable without a
shader recode.

## Why `pcfRadius` used to be a no-op

Three r171's WebGPU/node shadow path picks a filter from
`renderer.shadowMap.type`:

| Type | Filter | `shadow.radius` |
| ---- | ------ | ---------------- |
| `BasicShadowMap` (0) | 1-tap compare | ignored |
| `PCFShadowMap` (1) | 17-tap PCF | **read** |
| `PCFSoftShadowMap` (2) | bilinear 3×3, **1 texel** | **ignored** |
| `VSMShadowMap` (3) | variance | used as blur |

We used to request `PCFSoftShadowMap` and set `pcfRadius: 2`. On the node path
that filter never samples `radius`, so contacts stayed hard. The candy filter
is now a custom `shadow.filterNode` (3×3 or 5×5) that `reference()`s
`shadow.radius` and `shadow.pcssLightSize`.

`renderer.shadowMap.type` is `PCFShadowMap` as a fallback for any light that
does not get a `filterNode`.

## Knobs

All under `CONFIG.lighting.shadows` (`src/core/config/defaults.ts`), resolved
by `resolveShadowSettings()`:

| Knob | Default | Live? |
| ---- | ------- | ----- |
| `softness` | `0.6` | **Yes** — writes `shadow.radius` |
| `pcfRadius` | `4` | radius at softness `1` |
| `pcssEnabled` | `false` | **Yes** — writes `pcssLightSize` (0 = off) |
| `pcssLightSize` | `0.4` | with the toggle |
| `bias` / `normalBias` | `-0.0005` / `0.02` | boot (acne) |

`setShadowSoftness(0..1)` / `setShadowPcssEnabled(bool)` are the runtime API.
The `?debug=1` panel exposes a slider. URL: `?shadowSoft=0.8`, `?pcss=1`.

Per-light optional override: `createPointLight({ castShadow: true, shadowSoftness: 0.3 })`.

## Quality tiers

| Shadow resolution | Kernel | Notes |
| ----------------- | ------ | ----- |
| `off` (`low` graphics / CI) | — | no shadow pass, no filter cost |
| `low` (default / medium) | 3×3 PCF | 13 compares / fragment / cascade |
| `high` | 5×5 PCF | 29 compares / fragment / cascade; PCSS allowed |

Kernel size is **boot-time** (unrolled TSL). Softness is **not**.

## Cheap PCSS-style contact

Not production blocker-search PCSS (that is a non-goal). The 3×3 / 5×5 kernels
always take a 4-tap ring to estimate "am I on a shadow edge?". When
`pcssLightSize > 0` the filter **shrinks interiors** toward a hard umbra and
keeps the full radius on the penumbra — buttery candy contact, readable cores.

r171's `ShadowNode` always binds a comparison depth sampler, so a real blocker
average is not available without forking Three.

## Acne on `Gummy` / `Crystal`

Those presets are transmission + low roughness + clearcoat, which show shadow
acne first. Keep the existing `bias` / `normalBias` pairing. CSM still scales
`bias` per cascade (`× cascadeIndex`). `LightShadow.clone()` drops
`normalBias` — we restore it when attaching the filter. If softness is pushed
past ~0.8 and speckles return, raise `normalBias` toward `0.03` before touching
`bias`.

## Cost

| Path | Taps / fragment / map | Default session (2 cascades) | High (3 cascades) |
| ---- | --------------------- | ---------------------------- | ----------------- |
| Old `PCFSoft` (1-texel 3×3) | 9 | 18 | 27 |
| Default candy 3×3 + ring | 13 | 26 | — |
| High 5×5 + ring | 29 | — | 87 |

CI / headless / `low` graphics skip the shadow pass entirely, so smoke boot
does not pay the high kernel. The 5×5 path is gated to the high shadow tier.

## CSM

Softness attaches **after** `initSunCascades()`. Cascade lights are clones;
`filterNode` is not copied by `LightShadow.copy()`, so each cascade is bound
explicitly. Works with the single follow map if CSM is off or WebGL.

## Files

- `src/rendering/shadow-softness.ts` — TSL kernels, live API
- `src/core/config/postfx.ts` — `resolveShadowSettings()` softness fields
- `src/systems/shadow-cascades.ts` — radius + restored `normalBias`
- `src/debug/panel.ts` — `?debug=1` slider

# Arpeggio Grove Channel Accumulate (WASM)

Migration tracker slice **#2** / GitHub **#1364**: move `arpeggio_grove` shimmer + hueShift
volume accumulation + `nightGate` scale out of the TypeScript hot path into AssemblyScript.

## Pipeline

1. **Bindings** — `assets/music-bindings.json` → pre-parsed consts in
   `music-reactivity-defaults.ts` → live lists on `MRState` (map overrides via
   `applyMapMusicContext`). No JSON parsing in WASM.
2. **Pack** — `applyArpeggioGroveChannelAccum()` (`music-reactivity-core.ts`)
   copies channel `.volume` into a fixed `Float32Array` (shimmer first, then hueShift).
3. **Accumulate** — `accumulateArpeggioChannels` (AS) or `accumulateArpeggioChannelsTS`
   writes `[shimmer, hueShift]` already scaled by `nightGate * intensityScale`.
4. **Uniforms** — TS mutates `BiomeUniforms.arpeggioGrove.{shimmer,hueShift}.value` in place.
5. **Orchestration** — noteColor lerp, sky-wave, beat sync stay in `MusicReactivitySystem` (TS).

## Feature flag (A/B)

| Query | Behavior |
|-------|----------|
| *(absent)* | Prefer AS when `candy_physics` export is present (default ON) |
| `?nativeMusicAccum=1` | Prefer AS (same as default when ready) |
| `?nativeMusicAccum=0` | Force TS fallback for visual / perf A/B |

## Files

| Layer | Path |
|-------|------|
| AS | `assembly/music_reactivity.ts` |
| Wrapper | `src/utils/wasm-music-reactivity.ts` |
| Hot path | `src/systems/music-reactivity-core.ts` → `applyArpeggioGroveChannelAccum` |
| Caller | `src/systems/music-reactivity.ts` → `updateBiomeChannelBindings` |
| Parity | `tests/parity.mjs`, `tests/fixtures/parity/arpeggio-accumulate.json` |
| Unit | `tests/atmosphere-reactivity.test.mjs` (arpeggio section) |

## Fallback

If WASM is missing, malloc fails, or the flag forces TS, the typed-array reference
path runs — identical math to the previous inline loops.

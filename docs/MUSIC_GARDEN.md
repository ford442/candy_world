# Music Garden

Candy World is a music-reactive candy nature preserve. The music drives the
world: the libopenmpt tracker, the generative engine (`src/audio/generative/`),
Living Score row cues and the reactivity uniforms. Music Garden lets the player
push back. You plant musical flora, the world plays what you planted in time
with the track and the biome, and shared worlds let other players hear and
co-edit those patterns.

Most of the pieces already exist: build mode and world commands
(`systems/authoring`), the `WorldDocument` command log, shared-world
co-editing, Living Score edge detection, the generative sequencer, the unlock
loop and Melodies objectives. What was missing was an audio engine that can
play dozens of planted voices without stutter. That engine is slice A.

## Slices

| Slice | Scope                                                                                                                                  | Status                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **A** | DSP engine in an AudioWorklet (`emscripten/dsp/`), offline render tests, generative engine ported. No gameplay change                  | built (below)                                               |
| **B** | Chime Tulips + Drum Puffballs as entity kinds, the garden sequencer (`src/audio/garden/sequencer.ts`), build-mode placement, save/load | built ([Slice B](#slice-b-chime-tulips-and-drum-puffballs)) |
| C     | Bass Roots + Arp Vines, Living Score `gardenStep` cues, seed-packet unlocks, the "First Bloom" Melodies chain                          | planned                                                     |
| D     | Shared-world jams (schema + migration, sync convergence case), `validate-world` flora limits, `.mid` export, WebMIDI input             | planned                                                     |

The grove composer (music stones: an authored 8 × 16 pattern played through the
generative engine, `compose` commands, cue bindings) is built and documented
in [`GROVE_COMPOSER.md`](./GROVE_COMPOSER.md).

Slices B–D follow the original proposal: flora are `world-commands.ts`
commands, so undo, the command log, `.candyworld` export and shared-world sync
come for free (slice B proved it: it added no command). Scale and key come from `biome-profiles.ts` and the season.
Their patches go in `PATCH_RANGE.free` (below).

## Slice A: the garden DSP engine

### Why

`SynthVoice` builds an oscillator + gain + filter (+ panner) graph on the main
thread for every note. That is fine for a sparse generative line. It does not
hold up for dozens of planted voices, and scheduling jittered whenever the main
thread stalled: the old engine scheduled each step from `update()` at frame
rate, 20 ms ahead.

### Shape

```
main thread                                     audio thread (AudioWorkletGlobalScope)
───────────                                     ──────────────────────────────────────
GenerativeEngine.update()  ── steps 200 ms ahead on the audio clock
  └ DspVoiceSink.playNote(note, ch, vel, when)
      └ GardenAudioEngine.noteOn(when, patch, midi, …)
          └ EventRing (SharedArrayBuffer, SPSC) ──▶ GardenProcessor.process()
            or EventBatch (postMessage, per task) ──▶   └ GardenDspHost.drain()  time → frame
                                                         └ candy_dsp.wasm: dsp_note_on(frame, …)
                                                           dsp_render(currentFrame) → 128 frames
                                                           └ outputs[0] (stereo) → master gain
```

| File                                    | Role                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `emscripten/dsp/garden_dsp.cpp`         | The engine (C++17, SIMD). Static memory, no imports                                                |
| `emscripten/dsp/build.sh`               | `npm run build:dsp` (also the second half of `build:emcc`) → `public/candy_dsp.wasm`               |
| `src/audio/worklet/dsp-abi.ts`          | Parameter ids, enum values, defaults and limits, mirrored from the C++ (tested against the binary) |
| `src/audio/worklet/event-ring.ts`       | The event record, the SPSC ring and the posted-batch fallback                                      |
| `src/audio/worklet/garden-dsp-host.ts`  | One module instance: events in, quanta out. Shared by the worklet and the Node tests               |
| `src/audio/worklet/garden-processor.ts` | The `candy-garden` AudioWorkletProcessor, bundled on its own (`?worker&url`)                       |
| `src/audio/worklet/garden-engine.ts`    | Main-thread `GardenAudioEngine`: loads the wasm and the worklet, queues events, reads stats        |
| `src/audio/generative/voice-sink.ts`    | `GenerativeVoiceSink` (what the generative engine plays into) and `DspVoiceSink`                   |
| `src/audio/generative/dsp-patches.ts`   | The generative channels' patches and engine settings                                               |
| `scripts/check-dsp-wasm.mjs`            | The linked binary's contract (no imports, exports, fixed memory)                                   |

The main-thread files form the lazy `garden-audio` chunk (`docs/APP_CHUNK_SPLIT.md`),
which only the generative engine's `import()` reaches. The processor is a
separate 5 KB bundle with no imports.

### The engine

64 voices. Each voice runs an oscillator, an optional SVF, an ADSR, and an
equal-power pan. Its output goes to a bus and to a mono reverb send.

| Engine (`DspEngine`) | Oscillator                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Wavetable`          | Band-limited tables: `Sine`, `Triangle`, `Saw`, `Square`, `Glass` (bell-ish), `Organ` (drawbars). Optional detuned second oscillator (`detune` cents, `osc2Mix`) |
| `Fm`                 | Two-operator phase modulation: `fmRatio`, `fmIndex` (radians), and an index envelope (`fmDecay`)                                                                 |
| `Kick`               | Sine swept from `pitchStart` × the note's frequency down to it (`pitchDecay`)                                                                                    |
| `Noise`              | xorshift white noise, usually through the high-pass filter                                                                                                       |

- **Wavetables** are built at `dsp_init` (~7 ms) by additive synthesis: 2048
  samples, 10 mip levels of 512 >> k harmonics. A note picks the richest level
  that stays below Nyquist, so nothing aliases. The tests check each table's
  measured harmonic levels against its Fourier series to 0.5 dB.
- **Filter**: Cytomic trapezoidal SVF (low/band/high-pass), stable under
  modulation. Coefficients update every 16 frames. The cutoff is `cutoff` ×
  2^(`brightness` + `filterEnv` × envelope + `keyTrack` × octaves from C4).
- **Envelope**: linear attack. Decay and release are exponential, given as T60
  (seconds to fall 60 dB). A voice ends at −80 dB.
- **Reverb**: one shared Freeverb (8 combs + 4 allpasses per side, tunings
  scaled from 44.1 kHz, buffers sized for 96 kHz). `reverbRoom`, `reverbDamp`,
  `reverbWet`.
- **Beat duck** (sidechain): voices whose patch has `duck: Ducked` (the
  default) and the reverb go through the duck bus. A `Source` voice (the kick)
  or a `dsp_duck` event dips that bus by `duckDepth` with a 1.5 ms attack and a
  `duckRelease` T60. `Bypass` voices are never ducked.
- **Master**: `masterGain`, then a tanh-like rational soft clip. NaN becomes 0
  and |x| ≤ 1.
- **SIMD** (`wasm_simd128.h`) covers the block work: clears, the voice ×
  envelope × gain multiply-accumulate into the buses, the duck and master stage,
  and the soft clip. Phases, envelopes and filter state are recursive and stay
  scalar per voice.
- **Denormals**: wasm has no flush-to-zero mode. Voices die at −80 dB, the
  decaying side-chains (FM index, kick pitch, duck) flush below 1e-6, and the
  reverb input carries a 1e-18 DC offset so every comb and allpass stays normal.
  `dsp_scan_denormals()` (test-only) checks all of it.
- **Hostile input**: non-finite parameters are ignored. Notes, velocities and
  pans are clamped. An event with a NaN or infinite frame is refused. A voice
  whose state goes non-finite is dropped before it reaches the mix.

**Events** carry absolute frames. `dsp_render(frame)` applies everything due
before `frame + 128` in time order, so a note-off follows its note-on even
inside one quantum. At equal frames note-offs go first, so retriggering a tag
releases the old voice and keeps the new one. A note starts on its exact frame
(fractional frames floor). `durationSec ≤ 0` holds a note until
`dsp_note_off(tag)`. The queue holds 1024 events. When it is full,
`dsp_note_on` returns 0 and `dsp_dropped_events()` counts the refusal. When
voices run out, the quietest releasing voice is stolen, else the oldest.

### Patches

A patch is one of 32 slots of 21 parameters (`PATCH_PARAMS`, defaults in
`PATCH_DEFAULTS`). The owner of a slot writes it once, through
`GardenAudioEngine.create({ patches })`, or later through `setPatch`. A changed
patch applies to notes started after the change.

| Range (`PATCH_RANGE`) | Slots | Owner                                                             |
| --------------------- | ----- | ----------------------------------------------------------------- |
| `generative`          | 0–7   | One per sequencer channel (`src/audio/generative/dsp-patches.ts`) |
| `free`                | 8–31  | Garden flora (8–11: slice B's chime, kick, snare, hat), effects   |

The generative patches keep each channel's waveform and register from
`CHANNEL_VOICES`. They add real envelopes, a detuned saw pad that pumps under
the kick (`duck: Source` on channel 0, `duckDepth` 0.35), FM bells on melody and
shimmer, and plucks on the arpeggios. The biome's `brightness` maps to the same
cutoff `SynthVoice` used (`brightnessOctaves`). The season's reverb adds to a
base room.

### Transports and timing

- **Clock**: `GenerativeEngine.update()` still runs at frame rate. It now queues
  every step on the audio clock up to `SCHEDULE_AHEAD_SEC` (200 ms) ahead, on an
  exact 16th grid, so a main-thread stall shorter than that moves no note. A
  stall longer than `MAX_LATE_SEC` (400 ms; a background tab, say) skips the
  missed steps instead of playing them in a burst. Visuals and note callbacks
  wait in a step queue and fire when `ctx.currentTime` less the output latency
  reaches the step. Lighting therefore lands on the note you hear, not on the
  moment it was queued. This applies to the `SynthVoice` fallback as well.
- **`EventRing`** (cross-origin isolated pages: dev, preview, and a deploy host
  that sends COOP/COEP): a lock-free single-producer, single-consumer ring of
  64-byte records in a `SharedArrayBuffer`. The producer writes a record, then
  publishes its write index with `Atomics.store`. The consumer copies records
  out, then publishes its read index. Neither side waits. The worklet drains up
  to 256 records per quantum and writes its stats (`activeVoices`, `quanta`,
  `dspDropped`, `lateEvents`) into the ring header.
- **`EventBatch`** (no isolation, so no `SharedArrayBuffer`): records collect
  into one batch per task, posted with a transferred buffer. Stats come back as
  a message every ~0.25 s.

Both transports carry the same records, and the tests check that they render
the same samples as direct calls.

### Fallback

`GardenAudioEngine.create()` resolves `null` when the engine cannot run: no
`AudioWorklet`, no `candy_dsp.wasm` (a build without emsdk; a dev server that
answers with `index.html` is caught by the wasm magic check), a load error, or
no `ready` within 4 s. `GenerativeEngine.start()` waits at most 5 s for it and
then plays through `SynthVoice`. A worklet that reports an error, or fires
`processorerror`, marks itself unhealthy, and notes from then on go to
`SynthVoice`. `?no_dsp` (`FEATURE_FLAGS.gardenDsp`) skips the engine entirely.

### Toolchain contract

`candy_dsp.wasm` is a standalone reactor: `-O2 -flto -msimd128`, `--no-entry`,
`STANDALONE_WASM=1`, `FILESYSTEM=0`, 2 MB fixed memory, 64 KB stack,
`ERROR_ON_UNDEFINED_SYMBOLS=1`. It has no pthreads, shared memory, OpenMP,
`-ffast-math` or memory growth. `AGENTS.md` ("Garden DSP module") has the full
list and the reasons. `npm run verify:emcc:manifest` enforces it, and
`scripts/check-dsp-wasm.mjs` checks the linked binary.

**ABI**: every `EMSCRIPTEN_KEEPALIVE` function in `emscripten/dsp/*.cpp`, all
named `dsp_*` (nothing else may use the prefix). There is no export list.
`check:native-exports` treats it as a third module: every export needs a caller
(a `.dsp_x` call or a `'dsp_x'` string in `src/`, `tests/` or `scripts/`), and
every `.dsp_x` must exist. `gen:native-types` generates `DspExports` from the
definitions. To add an export:

1. Write it in `garden_dsp.cpp` with `EMSCRIPTEN_KEEPALIVE` and a `dsp_` name.
2. Call it from `src/` (or a test).
3. Run `npm run gen:native-types`, then `npm run build:dsp`.

A parameter or enum change is one edit in the C++ and one in `dsp-abi.ts`;
`test:dsp-render` fails until they agree.

### Tests

| Script                      | Needs               | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:garden-events`        | —                   | Ring FIFO, wrap through int32 overflow, full/drop accounting, stats slots, 200k records across two real threads with none lost or reordered; batch flushing; the browser `queueMicrotask` binding                                                                                                                                                                                                                                                                                                  |
| `test:generative-scheduler` | —                   | Notes on the exact grid under jittery frames and a 90 ms stall, never queued late; a 2 s stall skips rather than bursts; callbacks fire once heard; DSP sink while healthy, fallback after; `stop()` releases                                                                                                                                                                                                                                                                                      |
| `test:dsp-render`           | `build:dsp` (emsdk) | Binary contract; `dsp-abi.ts` matches the module; golden RMS (±0.5 dB) and spectral centroid (±3%) for 12 scenes (`tests/fixtures/dsp-golden.json`); Fourier-series harmonics; NaN/Inf/clip safety; no denormals after a 60 s tail; sample-accurate onsets and releases; duck depth and recovery; voice stealing; queue overflow; 64-voice budget; both transports sample-identical to direct calls; the generative engine rendered through the module, on the grid, no late notes through a stall |

`test:dsp-render` skips without the binary; `CANDY_DSP_REQUIRE=1` (the
`Garden DSP`, `Emscripten Verify` and `release stable` workflows) makes a
missing binary fail. Refresh the golden file with
`npm run test:dsp-render -- --update` after an intended change to the sound.

Measured (Node 24, x86-64 container, 48 kHz): 64 detuned, filtered saw voices
plus reverb and duck render in **86 µs** per 128-frame quantum (median; p99
104 µs), and 64 FM bells in **218 µs**. The acceptance budget is 1 ms. A
quantum is 2.67 ms of audio.

In Chromium (Playwright, an `OfflineAudioContext` against the dev server), the
worklet loads, a note queued for 0.5 s starts on its frame, 64 voices sound,
and the ring and batch transports render identical output. In the full app,
after the first click the generative soundtrack runs on `candy-garden`, with
the worklet's ring stats showing notes flowing and none dropped.

### Known limits

- A main-thread stall longer than 200 ms makes the notes it covers late (they
  play at once and `lateEvents` counts them). A headless Chromium boot still
  produced 0–4 per run, all during world load; steady play produced none. Moving the sequencer onto
  the audio thread removes the limit. The garden sequencer (slice B) is the
  natural place to do that.
- `AudioWorkletGlobalScope` has no `performance.now()`, so render cost is
  measured offline (`test:dsp-render`), not live.
- The reverb buffers are sized for 96 kHz. Above that, the comb lengths clamp
  and the room gets smaller.
- The generative engine does not run while a tracker module plays. The garden
  sequencer (slice B) keeps its own clock then and locks it to the tracker's
  tempo and beat, below.

## Slice B: chime tulips and drum puffballs

The first slice a player can touch. Plant them in build mode and the garden plays
what you planted, in time, through the DSP engine.

### Playing

1. Open build mode (**B**) and pick a **Chime tulip** (🔔) or a **Drum puffball** (🥁) from
   _Music objects_. Place as many as you like.
2. Listen. Plants within 36 m sound, the 24 nearest at most, louder the closer they are, panned by
   which side of you they stand on. Walking away fades them out; walking up swells them.
3. Each plant swells (tulip) or squashes (puffball) on the note you hear.
4. Move, undo, redo, remove, save a slot, export `.candyworld`: all as for any other plant.

Nothing here edits a plant's notes yet: what a plant plays comes from its id (below). Editing
(and the other two instruments) is slice C's seed packets.

### What they play

A figure is a 16-step bar of sixteenths, the grove pattern's grid.

| Kind          | Params (all optional)                         | Plays                                                                                                                                    |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Chime tulip   | `degree` 0..13, `step` 0..15                  | Its scale degree, in the key of the biome where you are, an octave above the lead; on `step` and again 8 steps later (the second softer) |
| Drum puffball | `drum` `kick` / `snare` / `hat`, `shift` 0..3 | Kick on 0 and 8 (on the key's root), snare on 4 and 12, hat on 2, 6, 10, 14; all rotated by `shift` sixteenths                           |

A plant with no params plays the figure rolled from its entity id (`defaultChimeTulip`,
`defaultDrumPuffball`), the same on every client, as an uncomposed music stone plays its seeded
default. Chimes roll consonant degrees (root, third, fifth, sixth and their octaves) on mostly
even steps; puffballs roll 40% kick, 30% snare, 30% hat.

The model is `src/world/document/garden-flora.ts`, renderer-free, beside `grove-pattern.ts`. The
document schema checks the params of every chime tulip and drum puffball snapshot wherever one
appears (a place, a move, inside a batch), so the shared-world validator, the `validate-world` path
and the co-editing room parser refuse a forged one. Other params (`provenance`, ...) pass
through. `WORLD_DOCUMENT_SCHEMA` stays 1. Both kinds are `place` / `move` / `remove` commands
like any plant; there is no garden-specific command.

### Timing

`src/audio/garden/conductor.ts` picks how the garden keeps time from what the audio system is
doing. Notes are queued on the audio clock up to 200 ms ahead (the same lookahead as the
generative engine); a hitch under that moves no note and one over 400 ms skips steps, keeping the
bar, rather than bursting them.

| Mode         | When                      | Clock                                                                                         | Key and tempo                                     |
| ------------ | ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `generative` | the soundtrack is running | The engine's own grid: `GenerativeEngine.addScheduleListener` gives each step's exact time    | The engine's active profile (biome blend, season) |
| `tracker`    | a module is playing       | Its own `GardenClock` at the tracker's `bpm`; each `BeatSync.onBeat` trims it toward the beat | The biome at your feet                            |
| `idle`       | no music                  | Its own clock at the biome's tempo times the season's tempo scale                             | The biome at your feet                            |

The tracker lock is to the **tempo and the beat the visuals follow**. `BeatSync` reports the
wrap of the main thread's beat phase, not the tracker's rows (those are not exposed with audio
times), so the lock is approximate: the first beat puts a downbeat on a beat, later beats close a
quarter of any error beyond 8% of a step (at most 10% of a step at once), so a jittery frame
cannot yank the grid. Nothing is sample-exact against the module.

If a tracker file was loaded before the generative engine ever existed, the conductor asks the audio
system to build and attach it (without starting the soundtrack), so the worklet loads. With
nothing planted the garden never touches the audio system. Before the first user gesture the
context is not running and the garden stays silent.

Visuals use the heard-step path the grove composer uses: in `generative` mode the engine's
heard-step listener releases each planted step's visuals; in the other modes the audio clock less
the output latency does. Either way the plant moves on the sound, not on the moment the note was
queued.

### Voices

Slice B's patches are the first four of `PATCH_RANGE.free`, in `generative/dsp-patches.ts`
(`GARDEN_PATCH`, `GARDEN_PATCHES`; written by the same `GardenAudioEngine.create({ patches })`
call as the generative ones, `ENGINE_PATCHES`):

| Slot | Instrument | Patch                                                                                         |
| ---- | ---------- | --------------------------------------------------------------------------------------------- |
| 8    | `chime`    | Glass wavetable, a detuned second oscillator, 1.4 s tail, lowpass 6 kHz, reverb send 0.5      |
| 9    | `kick`     | The generative kick's shape (swept sine); a duck **Source**, so a planted kick pumps the pads |
| 10   | `snare`    | Noise, bandpass 1.9 kHz, 160 ms                                                               |
| 11   | `hat`      | Noise, highpass 7.5 kHz, 45 ms                                                                |

The `brightness` and reverb globals the biome and season set apply to them as to the soundtrack.
Without the worklet (`?no_dsp`, no `candy_dsp.wasm`, a failed load, or before it has loaded)
`voices.ts` plays the same notes through `SynthVoice`: chimes and the kick through its channels 4
and 0, the snare and hat through a short seeded noise burst (SynthVoice has no noise voice).

### Files

| File                                                                                    | Role                                                                                                  |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/world/document/garden-flora.ts`                                                    | The params model, the id-rolled defaults, the figures (`chimeHitsOn`, `drumHitsOn`), the schema check |
| `src/foliage/chime-tulip.ts`, `drum-puffball.ts`                                        | The plants: plain meshes over shared geometry and materials (no batcher)                              |
| `src/world/foliage-registry.ts`, `map-entity-record.ts`, `systems/authoring/palette.ts` | Registration, export type and category, the palette entry                                             |
| `src/audio/garden/sequencer.ts`                                                         | Pure: plants + key + step → notes (distance, pan, the 24-plant cap)                                   |
| `src/audio/garden/clock.ts`                                                             | The sixteenth-note clock on the audio clock, with the tracker beat lock                               |
| `src/audio/garden/player.ts`                                                            | Schedules a step's notes, queues its visuals until heard                                              |
| `src/audio/garden/voices.ts`                                                            | DSP patch or `SynthVoice` fallback                                                                    |
| `src/audio/garden/conductor.ts`                                                         | Picks the mode each frame; injected world and audio, so it is testable                                |
| `src/audio/garden/index.ts`, `pulses.ts`                                                | The real wiring (live flora, camera, biome, season) and the swell/squash                              |
| `src/audio/garden-lazy.ts`, `garden-hooks.ts`                                           | The `app`-side stub and import-free hook leaf; the `garden` chunk loads on the first plant            |
| `GenerativeEngine.addScheduleListener`, `.gardenOutput`                                 | What the garden rides: step times and the engine's context, bus and voices                            |

The `garden-sequencer` frame system (`audio` phase, after `living-score`) is free until a plant
loads the chunk (`docs/APP_CHUNK_SPLIT.md`).

### Tests

| Script                  | Needs                     | Proves                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test:garden-flora`     | —                         | Both kinds register, classify and reach the palette; the params model; place, move, remove, undo, redo, save, `.candyworld` export, reload and replay (twice, idempotently) through the real spawn and despawn paths; the schema, the shared-world validator and the room parser refuse bad params                                                                       |
| `test:garden-sequencer` | —                         | Garden patches sit in `PATCH_RANGE.free`; the clock stays on the exact grid under jitter, a hitch and a stall, and its beat lock converges; the sequencer's key, falloff, pan, cap and id-rolled defaults; DSP path and `SynthVoice` fallback; the real `GenerativeEngine` grid ridden step for step; tracker and idle modes; `?no_dsp`; nothing planted touches nothing |
| `test:dsp-render`       | `build:dsp` (emsdk)       | The four garden patches alone (golden RMS and centroid), and a planted garden rendered through the real module: clean, audible, on the grid, no late or dropped events                                                                                                                                                                                                   |
| `test:garden-placement` | —                         | The build-mode path in Node: palette entry, `buildPlacementSnapshot`, `PlaceCommand` through the history, the real plant, the garden's world scan, the sequencer's notes in the biome key, the pulse on the real object, undo                                                                                                                                            |
| `test:garden-live`      | `npm run build`, Chromium | The built app with plants beside the spawn: the `garden` chunk loads, `garden-sequencer` never throws, notes reach the worklet (default) or `SynthVoice` (`?no_dsp`), no console errors. Not in `test:fast`                                                                                                                                                              |

### Not done, and not verified

- A plant's notes cannot be edited yet: they come from its id (or from params in a hand-edited
  document). The editor, the other two instruments, `gardenStep` cues and seed packets are slice C.
- Garden notes do not feed music reactivity (`onNote`): the plant swells, the world does not.
- `GenerativeEngine.stop()` ends with `allOff`, which also cuts garden voices sounding at that
  moment, once (switching to a tracker file).
- The tracker lock is to the beat phase, not the module's rows (above).
- The garden has been heard only as numbers: offline renders through `candy_dsp.wasm`, with levels
  checked against the kick (the snare and hat gains were raised after the first render put them
  15 dB under it), and a live headless page (`test:garden-live`) that counts the notes sent. Nobody
  has listened to it, so the patches' character and the mix balance are unjudged.
- `test:garden-live` boots with the soundtrack running, so the live `generative` mode and both voice
  paths are covered. Tracker and idle modes, and the swell animation on screen, are covered by node
  tests with fakes only. Planting through the real build-mode pointer (ghost, strip buttons) is
  `tests/build-mode.test.ts`'s ground plus `test:garden-placement`; no browser drives the click.

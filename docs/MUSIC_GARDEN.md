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

| Slice | Scope                                                                                                                                  | Status        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **A** | DSP engine in an AudioWorklet (`emscripten/dsp/`), offline render tests, generative engine ported. No gameplay change                  | **this file** |
| B     | Chime Tulips + Drum Puffballs as entity kinds, the garden sequencer (`src/audio/garden/sequencer.ts`), build-mode placement, save/load | planned       |
| C     | Bass Roots + Arp Vines, Living Score `gardenStep` cues, seed-packet unlocks, the "First Bloom" Melodies chain                          | planned       |
| D     | Shared-world jams (schema + migration, sync convergence case), `validate-world` flora limits, `.mid` export, WebMIDI input             | planned       |

Slices B–D follow the original proposal: flora are `world-commands.ts`
commands, so undo, the command log, `.candyworld` export and shared-world sync
come for free. Scale and key come from `biome-profiles.ts` and the season.
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
| `free`                | 8–31  | Garden flora (slice B on), effects                                |

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
- Tempo lock to the tracker (`beat-sync.ts`) arrives with the garden sequencer
  (slice B). The generative engine does not run while a tracker module plays.

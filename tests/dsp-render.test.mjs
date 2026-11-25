/**
 * The garden DSP module (emscripten/dsp/, public/candy_dsp.wasm), rendered
 * offline in Node through the same GardenDspHost the AudioWorklet uses.
 *
 *   ABI       the binary meets scripts/check-dsp-wasm.mjs; the numbers
 *             mirrored in src/audio/worklet/dsp-abi.ts match the module
 *   golden    one render per voice type: RMS (dBFS) and spectral centroid
 *             against tests/fixtures/dsp-golden.json, plus physical checks
 *             that do not depend on the fixture (a sine A4 is at 440 Hz, ...)
 *   safety    no NaN/Inf, |x| <= 1, hostile parameters, no denormals in any
 *             state after the tails die
 *   timing    sample-accurate onsets and releases, event order within a quantum
 *   mixing    beat duck, voice stealing, queue overflow
 *   budget    64 voices render in < 1 ms per quantum (median; override with
 *             CANDY_DSP_BUDGET_MS)
 *   path      EventRing and posted-batch transports give the same samples as
 *             direct calls; the generative engine renders through the module
 *
 * Without public/candy_dsp.wasm (no emsdk: `npm run build:dsp`) it skips,
 * unless CANDY_DSP_REQUIRE=1 (the Garden DSP and Emscripten Verify workflows).
 *
 * Run:     npm run test:dsp-render
 * Refresh: npm run test:dsp-render -- --update   (rewrites the golden fixture)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDspWasm, DSP_WASM } from '../scripts/check-dsp-wasm.mjs';
import { DspVoiceSink } from '../src/audio/generative/voice-sink.ts';
import { GenerativeEngine } from '../src/audio/generative/generative-engine.ts';
import {
    DSP_MAX_VOICES,
    DSP_QUANTUM,
    DspDuck,
    DspEngine,
    DspFilter,
    DspWave,
    GLOBAL_DEFAULTS,
    GLOBAL_PARAMS,
    PATCH_DEFAULTS,
    PATCH_PARAMS,
} from '../src/audio/worklet/dsp-abi.ts';
import { EventBatch, EventKind, EventRing } from '../src/audio/worklet/event-ring.ts';
import { GardenDspHost } from '../src/audio/worklet/garden-dsp-host.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'dsp-golden.json');
const UPDATE = process.argv.includes('--update');
const SR = 48000;

if (!fs.existsSync(DSP_WASM)) {
    const msg = 'public/candy_dsp.wasm not built (npm run build:dsp needs emsdk)';
    if (process.env.CANDY_DSP_REQUIRE === '1') {
        console.error(`❌ ${msg}, and CANDY_DSP_REQUIRE=1`);
        process.exit(1);
    }
    console.log(`⏭ ${msg}; garden DSP render tests skipped`);
    process.exit(0);
}
const BYTES = fs.readFileSync(DSP_WASM);
const MODULE = new WebAssembly.Module(BYTES);

let passed = 0;
const test = (name, fn) => {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function newHost(globals = { reverbWet: 0 }) {
    const host = GardenDspHost.fromBytes(MODULE, SR);
    for (const [k, v] of Object.entries(globals)) host.setGlobal(k, v);
    return host;
}

/** Render `seconds` (whole quanta) from frame 0; returns { left, right, active[] }. */
function renderFor(host, seconds, onQuantum) {
    const quanta = Math.ceil((seconds * SR) / DSP_QUANTUM);
    const left = new Float32Array(quanta * DSP_QUANTUM);
    const right = new Float32Array(quanta * DSP_QUANTUM);
    const active = [];
    for (let q = 0; q < quanta; q++) {
        const frame = q * DSP_QUANTUM;
        onQuantum?.(frame, q);
        active.push(host.render(frame, left, right, frame));
    }
    return { left, right, active };
}

const rms = (x, from = 0, to = x.length) => {
    let s = 0;
    for (let i = from; i < to; i++) s += x[i] * x[i];
    return Math.sqrt(s / Math.max(1, to - from));
};
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

/** In-place radix-2 FFT (re, im: Float64Array, length a power of two). */
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci;
                const ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                const nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

/** Magnitude-weighted mean frequency (Hz) of `size` samples from `start`, Hann-windowed. */
function centroid(x, start, size = 8192) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = 1; k < size / 2; k++) {
        const mag = Math.hypot(re[k], im[k]);
        num += mag * ((k * SR) / size);
        den += mag;
    }
    return den > 0 ? num / den : 0;
}

/**
 * Level of harmonic `h` of `f0` relative to the fundamental (dB): a
 * Hann-windowed DTFT evaluated at exactly h * f0, so there is no bin
 * scalloping to correct for.
 */
function harmonicDb(x, start, f0, h, size = 16384) {
    const at = (f) => {
        let re = 0;
        let im = 0;
        const w = (2 * Math.PI * f) / SR;
        for (let i = 0; i < size; i++) {
            const v = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
            re += v * Math.cos(w * i);
            im -= v * Math.sin(w * i);
        }
        return Math.hypot(re, im);
    };
    return db(at(f0 * h)) - db(at(f0));
}

function assertClean(x, label) {
    for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (!Number.isFinite(v) || v > 1 || v < -1) {
            assert.fail(`${label}: sample ${i} is ${v}`);
        }
    }
}

function firstNonZero(x) {
    for (let i = 0; i < x.length; i++) if (x[i] !== 0) return i;
    return -1;
}

// -----------------------------------------------------------------------------
// ABI
// -----------------------------------------------------------------------------

console.log('garden DSP: ABI');

test('the binary meets the module contract (no imports, dsp_* exports, fixed memory)', () => {
    assert.deepEqual(checkDspWasm(BYTES), []);
});

test('dsp-abi.ts mirrors the module: limits, parameter counts, every default', () => {
    const host = newHost({});
    const dsp = host.dsp;
    assert.equal(host.quantum, DSP_QUANTUM);
    assert.equal(dsp.dsp_max_voices(), DSP_MAX_VOICES);
    assert.equal(dsp.dsp_patch_param_count(), PATCH_PARAMS.length);
    assert.equal(dsp.dsp_global_param_count(), GLOBAL_PARAMS.length);
    PATCH_PARAMS.forEach((name, i) => {
        assert.equal(
            dsp.dsp_get_patch(5, i),
            Math.fround(PATCH_DEFAULTS[name]),
            `patch default ${name}`
        );
    });
    GLOBAL_PARAMS.forEach((name, i) => {
        assert.equal(
            dsp.dsp_get_global(i),
            Math.fround(GLOBAL_DEFAULTS[name]),
            `global default ${name}`
        );
    });
});

test('setPatch / setGlobal write the parameter they name', () => {
    const host = newHost({});
    host.setPatch(9, { cutoff: 1234, duck: DspDuck.Source });
    assert.equal(host.dsp.dsp_get_patch(9, PATCH_PARAMS.indexOf('cutoff')), 1234);
    assert.equal(host.dsp.dsp_get_patch(9, PATCH_PARAMS.indexOf('duck')), DspDuck.Source);
    assert.equal(
        host.dsp.dsp_get_patch(9, PATCH_PARAMS.indexOf('gain')),
        Math.fround(PATCH_DEFAULTS.gain)
    );
    host.setGlobal('duckDepth', 0.5);
    assert.equal(host.dsp.dsp_get_global(GLOBAL_PARAMS.indexOf('duckDepth')), 0.5);
});

test('dsp_init rejects an unusable rate; the host refuses it', () => {
    assert.throws(() => GardenDspHost.fromBytes(MODULE, 1000), /dsp_init\(1000\) returned 0/);
});

// -----------------------------------------------------------------------------
// Golden renders
// -----------------------------------------------------------------------------

console.log('garden DSP: golden renders');

const { GARDEN_PATCHES: GARDEN_PATCHES_SCENES, GARDEN_PATCH: GARDEN_SLOTS } =
    await import('../src/audio/generative/dsp-patches.ts');
const gardenSpec = (slot) => GARDEN_PATCHES_SCENES.find(([s]) => s === slot)[1];

const sustain = { attack: 0.005, decay: 0.2, sustain: 1, release: 0.2, reverbSend: 0 };
const SCENES = {
    // Music Garden slice B: each planted instrument alone, with its real patch (reverb off).
    'garden-chime': { patch: { ...gardenSpec(GARDEN_SLOTS.chime), reverbSend: 0 }, note: 72 },
    'garden-kick': { patch: { ...gardenSpec(GARDEN_SLOTS.kick), reverbSend: 0 }, note: 36, window: 0 },
    'garden-snare': {
        patch: { ...gardenSpec(GARDEN_SLOTS.snare), reverbSend: 0 },
        note: 60,
        window: 0,
        size: 4096,
    },
    // Short transients: measure the burst, not the silence after it.
    'garden-hat': {
        patch: { ...gardenSpec(GARDEN_SLOTS.hat), reverbSend: 0 },
        note: 60,
        window: 0,
        size: 1024,
    },
    'sine-a4': { patch: { ...sustain, wave: DspWave.Sine }, note: 69 },
    'triangle-a3': { patch: { ...sustain, wave: DspWave.Triangle }, note: 57 },
    'saw-a3': { patch: { ...sustain, wave: DspWave.Saw }, note: 57 },
    'square-a3': { patch: { ...sustain, wave: DspWave.Square }, note: 57 },
    'glass-a4': { patch: { ...sustain, wave: DspWave.Glass }, note: 69 },
    'organ-a3': { patch: { ...sustain, wave: DspWave.Organ }, note: 57 },
    'saw-lowpass-600': {
        patch: {
            ...sustain,
            wave: DspWave.Saw,
            filterMode: DspFilter.Lowpass,
            cutoff: 600,
            resonance: 0.2,
        },
        note: 57,
    },
    'saw-detuned-pad': {
        patch: {
            ...sustain,
            wave: DspWave.Saw,
            detune: 9,
            osc2Mix: 0.7,
            filterMode: DspFilter.Lowpass,
            cutoff: 1200,
            filterEnv: 0.8,
            reverbSend: 0.35,
        },
        note: 45,
        globals: { reverbWet: 0.3 },
    },
    'fm-bell': {
        patch: { ...sustain, engine: DspEngine.Fm, fmRatio: 3.5, fmIndex: 2, fmDecay: 2 },
        note: 69,
    },
    kick: {
        patch: {
            engine: DspEngine.Kick,
            attack: 0.002,
            decay: 0.32,
            sustain: 0,
            pitchStart: 3.5,
            pitchDecay: 0.14,
            reverbSend: 0,
        },
        note: 28,
        window: 0,
    },
    'hat-highpass': {
        patch: {
            engine: DspEngine.Noise,
            filterMode: DspFilter.Highpass,
            cutoff: 6000,
            attack: 0.001,
            decay: 0.6,
            sustain: 0,
            reverbSend: 0,
        },
        note: 60,
        window: 0,
    },
};

/** A 0.4 s render of one note; analysis window from `window` s (0.05 s default). */
function renderScene(scene) {
    const host = newHost({ reverbWet: 0, ...(scene.globals ?? {}) });
    host.setPatch(1, scene.patch);
    host.dsp.dsp_note_on(0, 1, scene.note, 0.8, 0, 0, 1);
    const { left, right } = renderFor(host, 0.4);
    const start = Math.round((scene.window ?? 0.05) * SR);
    const size = scene.size ?? 8192;
    return {
        left,
        right,
        rmsDb: db(rms(left, start, start + size)),
        centroidHz: centroid(left, start, size),
    };
}

const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
const measured = {};
const results = {};
for (const [name, scene] of Object.entries(SCENES)) {
    const r = renderScene(scene);
    results[name] = r;
    measured[name] = { rmsDb: +r.rmsDb.toFixed(3), centroidHz: +r.centroidHz.toFixed(1) };
}

test('every scene is clean (finite, within [-1, 1]) and audible', () => {
    for (const [name, r] of Object.entries(results)) {
        assertClean(r.left, name);
        assertClean(r.right, name);
        assert.ok(r.rmsDb > -45, `${name} is audible (${r.rmsDb.toFixed(1)} dBFS)`);
    }
});

test('physics: a sine A4 is at 440 Hz; centred pan is equal power', () => {
    const r = results['sine-a4'];
    assert.ok(Math.abs(r.centroidHz - 440) / 440 < 0.02, `centroid ${r.centroidHz.toFixed(1)} Hz`);
    // gain 0.3 * velocity 0.8 * cos(pi/4) pan * masterGain 0.8, as a sine: RMS = peak / sqrt(2)
    const expected = 0.3 * 0.8 * Math.SQRT1_2 * GLOBAL_DEFAULTS.masterGain * Math.SQRT1_2;
    const got = rms(r.left, 2400, 2400 + 8192);
    assert.ok(
        Math.abs(db(got) - db(expected)) < 0.3,
        `RMS ${got.toFixed(4)} vs ${expected.toFixed(4)}`
    );
    assert.ok(Math.abs(rms(r.left) - rms(r.right)) < 1e-6, 'left == right at pan 0');
});

test('physics: brightness orders as the spectra say it should', () => {
    const c = (n) => results[n].centroidHz;
    assert.ok(c('saw-a3') > 4 * 220, `saw is bright (${c('saw-a3').toFixed(0)} Hz)`);
    assert.ok(c('square-a3') > c('triangle-a3') * 1.5, 'square brighter than triangle');
    assert.ok(c('saw-lowpass-600') < c('saw-a3') * 0.5, 'a 600 Hz lowpass darkens the saw');
    assert.ok(c('fm-bell') > c('sine-a4') * 1.5, 'FM adds sidebands above the carrier');
    assert.ok(c('kick') < 160, `kick is low (${c('kick').toFixed(0)} Hz)`);
    assert.ok(c('hat-highpass') > 5000, `hat is high (${c('hat-highpass').toFixed(0)} Hz)`);
});

test('physics: each wavetable has its Fourier series (harmonic levels within 0.5 dB)', () => {
    const f0 = 220; // A3
    const at = 2400;
    const h = (scene, n) => harmonicDb(results[scene].left, at, f0, n);
    const near = (got, want, label) =>
        assert.ok(
            Math.abs(got - want) < 0.5,
            `${label}: ${got.toFixed(2)} dB, theory ${want.toFixed(2)} dB`
        );
    near(h('saw-a3', 2), db(1 / 2), 'saw H2'); // 1/h
    near(h('saw-a3', 3), db(1 / 3), 'saw H3');
    near(h('saw-a3', 7), db(1 / 7), 'saw H7');
    near(h('square-a3', 3), db(1 / 3), 'square H3'); // odd 1/h
    near(h('square-a3', 5), db(1 / 5), 'square H5');
    near(h('triangle-a3', 3), db(1 / 9), 'triangle H3'); // odd 1/h^2
    near(h('triangle-a3', 5), db(1 / 25), 'triangle H5');
    for (const scene of ['square-a3', 'triangle-a3']) {
        assert.ok(
            h(scene, 2) < -50,
            `${scene} has no even harmonics (H2 ${h(scene, 2).toFixed(1)} dB)`
        );
    }
    near(h('organ-a3', 2), db(0.7), 'organ drawbar 2');
    assert.ok(h('organ-a3', 5) < -50, 'organ has no 5th drawbar');
});

test('golden RMS (±0.5 dB) and spectral centroid (±3%) per scene', () => {
    if (UPDATE) return;
    const missing = Object.keys(measured).filter((n) => !golden.scenes?.[n]);
    assert.deepEqual(missing, [], 'scenes missing from the fixture: run with --update');
    for (const [name, m] of Object.entries(measured)) {
        const g = golden.scenes[name];
        assert.ok(
            Math.abs(m.rmsDb - g.rmsDb) <= 0.5,
            `${name}: RMS ${m.rmsDb} dB, golden ${g.rmsDb}`
        );
        assert.ok(
            Math.abs(m.centroidHz / g.centroidHz - 1) <= 0.03,
            `${name}: centroid ${m.centroidHz} Hz, golden ${g.centroidHz}`
        );
    }
});

// -----------------------------------------------------------------------------
// Safety
// -----------------------------------------------------------------------------

console.log('garden DSP: safety');

test('hostile parameters and events cannot produce NaN, Inf or clipping', () => {
    const host = newHost({ reverbWet: 0.5 });
    const dsp = host.dsp;
    const cutoff = PATCH_PARAMS.indexOf('cutoff');
    dsp.dsp_set_patch(2, cutoff, NaN);
    assert.equal(dsp.dsp_get_patch(2, cutoff), PATCH_DEFAULTS.cutoff, 'NaN parameter ignored');
    dsp.dsp_set_patch(2, cutoff, Infinity);
    assert.equal(dsp.dsp_get_patch(2, cutoff), PATCH_DEFAULTS.cutoff, 'Inf parameter ignored');
    host.setPatch(2, {
        filterMode: DspFilter.Bandpass,
        cutoff: 1e9,
        resonance: 1,
        attack: 0,
        decay: 0,
        release: 0,
        gain: 50,
        detune: 5000,
        osc2Mix: 3,
        wave: 99,
        engine: -4,
    });
    host.setPatch(3, { engine: DspEngine.Fm, fmRatio: 1e6, fmIndex: 1e4, fmDecay: -1 });
    host.setPatch(4, { engine: DspEngine.Kick, pitchStart: 1e6, pitchDecay: 0 });
    assert.equal(dsp.dsp_note_on(NaN, 2, 60, 1, 1, 0, 0), 0, 'NaN frame refused');
    assert.equal(dsp.dsp_note_on(Infinity, 2, 60, 1, 1, 0, 0), 0, 'infinite frame refused');
    dsp.dsp_note_on(0, 2, NaN, NaN, NaN, NaN, 0);
    dsp.dsp_note_on(0, 2, 1e9, 9, 1, 99, 0);
    dsp.dsp_note_on(0, 2, -1e9, -9, 1, -99, 0);
    dsp.dsp_note_on(0, 3, 127, 1, 1, 0, 0);
    dsp.dsp_note_on(0, 4, 0, 1, 1, 0, 0);
    dsp.dsp_note_on(0, 99, 60, 1, 1, 0, 0); // unknown patch -> slot 0
    dsp.dsp_note_on(0, -1, 60, 1, 1, 0, 0);
    const { left, right } = renderFor(host, 1.5);
    assertClean(left, 'hostile L');
    assertClean(right, 'hostile R');
});

test('no denormal anywhere in the engine once a dense chord and its reverb tail die out', () => {
    const host = newHost({ reverbWet: 0.6, reverbRoom: 1, reverbDamp: 0, duckDepth: 1 });
    host.setPatch(1, {
        wave: DspWave.Saw,
        filterMode: DspFilter.Lowpass,
        cutoff: 3000,
        release: 0.5,
        reverbSend: 1,
    });
    host.setPatch(2, {
        engine: DspEngine.Fm,
        fmIndex: 3,
        fmDecay: 0.2,
        sustain: 0,
        decay: 0.5,
        reverbSend: 1,
    });
    host.setPatch(3, { engine: DspEngine.Kick, sustain: 0, duck: DspDuck.Source });
    for (let i = 0; i < 24; i++)
        host.dsp.dsp_note_on(i * 300, 1 + (i % 2), 40 + i * 2, 1, 0.5, 0, i);
    host.dsp.dsp_note_on(0, 3, 30, 1, 0.1, 0, 99);
    const { left, active } = renderFor(host, 60);
    assertClean(left, 'tail');
    assert.equal(active.at(-1), 0, 'every voice ended');
    assert.equal(host.dsp.dsp_scan_denormals(), 0, 'denormal floats in engine state');
    const tail = left.subarray(left.length - 48000);
    for (const v of tail) {
        if (v !== 0 && Math.abs(v) < 1.17549435e-38) assert.fail(`denormal output sample ${v}`);
    }
});

// -----------------------------------------------------------------------------
// Timing
// -----------------------------------------------------------------------------

console.log('garden DSP: timing');

const click = {
    engine: DspEngine.Noise,
    attack: 0.0005,
    decay: 0.05,
    sustain: 1,
    release: 0.001,
    reverbSend: 0,
};

test('a note starts on its exact frame, mid-quantum or on a boundary', () => {
    for (const at of [1000, 1024, 0, 127, 128 * 50 + 1]) {
        const host = newHost();
        host.setPatch(1, click);
        host.dsp.dsp_note_on(at, 1, 60, 1, 0, 0, 1);
        const { left } = renderFor(host, (at + 2000) / SR);
        assert.equal(firstNonZero(left), at, `note at frame ${at}`);
    }
});

test('a fractional frame starts on the frame it falls in', () => {
    const host = newHost();
    host.setPatch(1, click);
    host.dsp.dsp_note_on(1000.75, 1, 60, 1, 0, 0, 1);
    assert.equal(firstNonZero(renderFor(host, 0.1).left), 1000);
});

test('duration and note-off release on their frame; note-on/off order holds within a quantum', () => {
    const hold = (events) => {
        const host = newHost();
        host.setPatch(1, { ...click, release: 0.02 });
        events(host.dsp);
        return renderFor(host, 0.3).left;
    };
    // Sustain at full level until the release frame, then fall.
    const level = (x, at) => rms(x, at - 64, at);
    const after = (x, at) => rms(x, at + 960, at + 1024); // 20 ms (one T60) later
    const byDuration = hold((d) => d.dsp_note_on(0, 1, 60, 1, 4800 / SR, 0, 1));
    assert.ok(db(after(byDuration, 4800)) - db(level(byDuration, 4800)) < -40, 'duration release');
    assert.ok(
        db(level(byDuration, 4700)) - db(level(byDuration, 4800)) > -1,
        'held until its frame'
    );
    const byOff = hold((d) => {
        d.dsp_note_on(0, 1, 60, 1, 0, 0, 7);
        d.dsp_note_off(6000, 7);
    });
    assert.ok(db(after(byOff, 6000)) - db(level(byOff, 6000)) < -40, 'note-off release');
    // Both events land in the same quantum (frames 1030 and 1100), queued up front.
    const sameQuantum = hold((d) => {
        d.dsp_note_off(1100, 3);
        d.dsp_note_on(1030, 1, 60, 1, 0, 0, 3);
    });
    assert.equal(firstNonZero(sameQuantum), 1030);
    assert.ok(rms(sameQuantum, 1040, 1100) > 0.05, 'played between its on and off');
    assert.ok(rms(sameQuantum, 2500, 3000) < 1e-3, 'and released at 1100');
});

test('retriggering a tag on one frame releases the old voice and keeps the new one', () => {
    const host = newHost();
    host.setPatch(1, { ...click, release: 0.01 });
    host.dsp.dsp_note_on(0, 1, 60, 1, 0, 0, 5);
    host.dsp.dsp_note_on(2000, 1, 72, 1, 0, 0, 5);
    host.dsp.dsp_note_off(2000, 5);
    const { left, active } = renderFor(host, 0.5);
    assert.equal(active.at(-1), 1, 'one voice left: the new one');
    assert.ok(rms(left, 20000, 24000) > 0.05, 'and it still sounds');
});

// -----------------------------------------------------------------------------
// Mixing
// -----------------------------------------------------------------------------

console.log('garden DSP: mixing');

/** Deepest 1 ms RMS (dB, relative to the 50 ms before `hit`) in the 20 ms after it. */
function duckDip(x, hit) {
    const before = db(rms(x, hit - 2400, hit));
    let deepest = 0;
    for (let i = hit; i < hit + 960; i += 48)
        deepest = Math.min(deepest, db(rms(x, i, i + 48)) - before);
    return deepest;
}

// An A7 sine (3520 Hz): a 1 ms window holds whole-ish cycles, so its RMS tracks the gain.
const DUCK_NOTE = 105;

test('the beat duck dips the ducked bus by its depth and recovers; bypass voices are untouched', () => {
    const render = (duckMode) => {
        const host = newHost({ reverbWet: 0, duckDepth: 0.8, duckRelease: 0.2 });
        host.setPatch(1, { ...sustain, wave: DspWave.Sine, duck: duckMode });
        host.dsp.dsp_note_on(0, 1, DUCK_NOTE, 1, 0, 0, 1);
        host.dsp.dsp_duck(24000, 1);
        return renderFor(host, 2).left;
    };
    const ducked = render(DspDuck.Ducked);
    // depth 0.8 -> gain 0.2 (-14 dB) at full duck; the 1.5 ms attack reaches ~93% in its 4 ms.
    const dip = duckDip(ducked, 24000);
    assert.ok(dip < -10 && dip > -14.5, `dips ${dip.toFixed(1)} dB`);
    const later = db(rms(ducked, 24000 + SR, 24000 + SR + 4800)) - db(rms(ducked, 21600, 24000));
    assert.ok(Math.abs(later) < 0.5, `recovers within a second (${later.toFixed(2)} dB)`);
    assert.ok(duckDip(render(DspDuck.Bypass), 24000) > -0.3, 'bypass is not ducked');
});

test('a duck source triggers the duck by itself (sidechain)', () => {
    const host = newHost({ reverbWet: 0, duckDepth: 0.8 });
    host.setPatch(1, { ...sustain, wave: DspWave.Sine });
    host.setPatch(2, { ...click, sustain: 0, decay: 0.01, gain: 0.0001, duck: DspDuck.Source });
    host.dsp.dsp_note_on(0, 1, DUCK_NOTE, 1, 0, 0, 1);
    host.dsp.dsp_note_on(24000, 2, 60, 1, 0.01, 0, 2);
    const { left } = renderFor(host, 0.8);
    const dip = duckDip(left, 24000);
    assert.ok(dip < -10, `a velocity-1 source ducks ${dip.toFixed(1)} dB`);
});

test('more notes than voices steal voices; nothing drops, nothing breaks', () => {
    const host = newHost({ reverbWet: 0.3 });
    host.setPatch(1, {
        wave: DspWave.Saw,
        sustain: 0.8,
        filterMode: DspFilter.Lowpass,
        cutoff: 2000,
    });
    for (let i = 0; i < 100; i++)
        host.dsp.dsp_note_on(i * 10, 1, 36 + (i % 50), 0.7, 0, (i % 7) / 3 - 1, i);
    const { left, active } = renderFor(host, 0.5);
    assert.ok(Math.max(...active) <= DSP_MAX_VOICES);
    assert.equal(active.at(-1), DSP_MAX_VOICES);
    assert.equal(host.droppedEvents, 0);
    assertClean(left, 'stolen');
});

test('a full event queue refuses and counts instead of overwriting', () => {
    const host = newHost();
    let queued = 0;
    for (let i = 0; i < 1100; i++) queued += host.dsp.dsp_note_on(SR * 10 + i, 1, 60, 1, 0.1, 0, i);
    assert.equal(queued, 1024);
    assert.equal(host.droppedEvents, 1100 - 1024);
    assert.equal(host.pendingEvents, 1024);
    host.dsp.dsp_all_off();
    assert.equal(host.pendingEvents, 0, 'all-off drops the queue');
});

// -----------------------------------------------------------------------------
// Budget
// -----------------------------------------------------------------------------

console.log('garden DSP: render budget');

const BUDGET_MS = Number(process.env.CANDY_DSP_BUDGET_MS ?? 1);

function timeVoices(spec, label) {
    const host = newHost({ reverbWet: 0.3, duckDepth: 0.4 });
    host.setPatch(1, spec);
    for (let i = 0; i < DSP_MAX_VOICES; i++)
        host.dsp.dsp_note_on(0, 1, 36 + (i % 48), 0.6, 0, (i % 9) / 4 - 1, i);
    const left = new Float32Array(DSP_QUANTUM);
    const right = new Float32Array(DSP_QUANTUM);
    const times = [];
    let active = 0;
    for (let q = 0; q < 2400; q++) {
        const t0 = performance.now();
        active = host.render(q * DSP_QUANTUM, left, right);
        if (q >= 200) times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    const p99 = times[Math.floor(times.length * 0.99)];
    assert.equal(active, DSP_MAX_VOICES, `${label}: all voices sounding while timed`);
    console.log(
        `    ${label}: median ${(median * 1000).toFixed(0)} µs, p99 ${(p99 * 1000).toFixed(0)} µs per quantum (budget ${BUDGET_MS} ms; ${((DSP_QUANTUM / SR) * 1000).toFixed(2)} ms of audio)`
    );
    assert.ok(median < BUDGET_MS, `${label}: median ${median.toFixed(3)} ms per quantum`);
}

test(`64 detuned, filtered saw voices + reverb + duck: median < ${BUDGET_MS} ms per quantum`, () => {
    timeVoices(
        {
            wave: DspWave.Saw,
            detune: 9,
            osc2Mix: 0.7,
            sustain: 0.8,
            filterMode: DspFilter.Lowpass,
            cutoff: 1500,
            filterEnv: 1,
            resonance: 0.3,
            reverbSend: 0.4,
        },
        'saw pad x64'
    );
});

test(`64 FM bells + reverb: median < ${BUDGET_MS} ms per quantum`, () => {
    timeVoices(
        {
            engine: DspEngine.Fm,
            fmRatio: 3.5,
            fmIndex: 2,
            fmDecay: 5,
            sustain: 0.8,
            filterMode: DspFilter.Lowpass,
            cutoff: 6000,
            reverbSend: 0.5,
        },
        'FM bell x64'
    );
});

// -----------------------------------------------------------------------------
// Event path
// -----------------------------------------------------------------------------

console.log('garden DSP: event path');

const PATH_PATCH = {
    wave: DspWave.Saw,
    filterMode: DspFilter.Lowpass,
    cutoff: 2000,
    reverbSend: 0.3,
};
const PATH_NOTES = [
    [0.01, 48, 0.9, 0.25, -0.5],
    [0.0137, 55, 0.7, 0.4, 0.5],
    [0.2, 60, 1, 0, 0],
];

function renderDirect() {
    const host = newHost({ reverbWet: 0.2 });
    host.setPatch(1, PATH_PATCH);
    PATH_NOTES.forEach(([t, n, v, d, p], i) => host.dsp.dsp_note_on(t * SR, 1, n, v, d, p, i));
    host.dsp.dsp_note_off(0.3 * SR, 2);
    return renderFor(host, 0.6).left;
}

test('records through the shared ring render the same samples as direct calls', () => {
    const host = newHost({ reverbWet: 0.2 });
    const ring = EventRing.create(64, true);
    for (const [i, value] of Object.entries(PATH_PATCH)) {
        ring.push(EventKind.Patch, 0, 1, PATCH_PARAMS.indexOf(i), value);
    }
    PATH_NOTES.forEach(([t, n, v, d, p], i) => ring.push(EventKind.NoteOn, t, 1, n, v, d, p, i));
    ring.push(EventKind.NoteOff, 0.3, 2);
    const viaRing = renderFor(host, 0.6, (frame) => host.drain(ring, frame)).left;
    assert.deepEqual(viaRing, renderDirect());
    assert.equal(host.lateEvents, 0);
});

test('posted batches render the same samples; late notes are counted', async () => {
    const host = newHost({ reverbWet: 0.2 });
    host.setPatch(1, PATH_PATCH);
    const batches = [];
    const batch = new EventBatch(
        (data, count) => batches.push([data, count]),
        2,
        (fn) => fn()
    );
    PATH_NOTES.forEach(([t, n, v, d, p], i) => batch.push(EventKind.NoteOn, t, 1, n, v, d, p, i));
    batch.push(EventKind.NoteOff, 0.3, 2);
    batch.flush();
    for (const [data, count] of batches) host.applyBatch(data, count, 0);
    assert.deepEqual(renderFor(host, 0.6).left, renderDirect());
    host.applyBatch(new Float64Array([EventKind.NoteOn, 0.5, 1, 60, 1, 0.1, 0, 9]), 1, SR);
    assert.equal(host.lateEvents, 1, 'a note for 0.5 s arriving at 1 s is late');
});

// -----------------------------------------------------------------------------
// The generative engine on the module
// -----------------------------------------------------------------------------

console.log('garden DSP: generative engine');

/**
 * The generative soundtrack rendered through the real module: GenerativeEngine
 * -> DspVoiceSink -> EventRing -> GardenDspHost, with a main thread that
 * updates at 60 Hz (plus a 90 ms hitch) while the "audio thread" renders.
 */
function renderGenerative(seconds) {
    const host = newHost({});
    const ring = EventRing.create(1024, true);
    const ctx = {
        currentTime: 0,
        state: 'running',
        outputLatency: 0,
        baseLatency: 0,
        resume: async () => {},
    };
    const target = {
        healthy: true,
        noteOns: [],
        noteOn(time, patch, note, velocity, duration, pan = 0, tag = 0) {
            this.noteOns.push(time);
            return ring.push(EventKind.NoteOn, time, patch, note, velocity, duration, pan, tag);
        },
        setGlobal(name, value) {
            ring.push(EventKind.Global, 0, GLOBAL_PARAMS.indexOf(name), value);
        },
        allOff() {
            ring.push(EventKind.AllOff, 0);
        },
    };
    const engine = new GenerativeEngine({ seed: 0xca4d0001 });
    const fallback = { playNote() {}, setBrightness() {}, setReverbWet() {} };
    engine.attach(ctx, {}, { dsp: false, fallback });
    engine.useDspSink(new DspVoiceSink(target));
    const heard = [];
    engine.onNote(() => heard.push(ctx.currentTime));
    for (const [slot, spec] of GENERATIVE_PATCHES_REF) host.setPatch(slot, spec);
    return engine.start().then(() => {
        assert.equal(engine.voiceBackend, 'dsp');
        const quanta = Math.ceil((seconds * SR) / DSP_QUANTUM);
        const left = new Float32Array(quanta * DSP_QUANTUM);
        const right = new Float32Array(quanta * DSP_QUANTUM);
        const framePeriod = SR / 60;
        let nextUpdate = 0;
        let lastUpdate = 0;
        for (let q = 0; q < quanta; q++) {
            const frame = q * DSP_QUANTUM;
            ctx.currentTime = frame / SR;
            if (frame >= nextUpdate) {
                engine.update(ctx.currentTime - lastUpdate);
                lastUpdate = ctx.currentTime;
                // One 90 ms hitch two seconds in (shader warmup, chunk streaming).
                nextUpdate += Math.abs(ctx.currentTime - 2) < 0.01 ? 0.09 * SR : framePeriod;
            }
            host.drain(ring, frame);
            host.render(frame, left, right, frame);
        }
        return {
            left,
            right,
            noteOns: target.noteOns,
            heard,
            host,
            bpm: engine.getVisualState().bpm,
        };
    });
}

const { GENERATIVE_PATCHES: GENERATIVE_PATCHES_REF } =
    await import('../src/audio/generative/dsp-patches.ts');
const gen = await renderGenerative(8);

test('the generative soundtrack renders through the module: clean, audible, on the step grid', () => {
    assertClean(gen.left, 'generative L');
    assertClean(gen.right, 'generative R');
    const level = db(rms(gen.left, SR, 8 * SR));
    assert.ok(level > -40 && level < -3, `level ${level.toFixed(1)} dBFS`);
    assert.ok(gen.noteOns.length > 50, `${gen.noteOns.length} notes`);
    // Every note sits on the 16th grid from the first step, hitch or not.
    const step = 60 / (gen.bpm * 4); // 16ths at the engine's tempo (constant here: one biome, fixed bias)
    const t0 = gen.noteOns[0];
    for (const t of gen.noteOns) {
        const k = (t - t0) / step;
        assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `note at ${t.toFixed(5)} s is off the grid`);
    }
    assert.equal(
        gen.host.lateEvents,
        0,
        'no note reached the module after its time, despite the hitch'
    );
});

test('generative golden RMS (±0.5 dB) and centroid (±3%)', () => {
    measured['generative-8s'] = {
        rmsDb: +db(rms(gen.left, SR, 8 * SR)).toFixed(3),
        centroidHz: +centroid(gen.left, 2 * SR, 65536).toFixed(1),
    };
    if (UPDATE) return;
    const g = golden.scenes?.['generative-8s'];
    assert.ok(g, 'generative-8s missing from the fixture: run with --update');
    const m = measured['generative-8s'];
    assert.ok(Math.abs(m.rmsDb - g.rmsDb) <= 0.5, `RMS ${m.rmsDb} dB, golden ${g.rmsDb}`);
    assert.ok(
        Math.abs(m.centroidHz / g.centroidHz - 1) <= 0.03,
        `centroid ${m.centroidHz} Hz, golden ${g.centroidHz}`
    );
});

test('note callbacks (the visuals) fire when their step is heard, never before', () => {
    assert.ok(gen.heard.length > 50);
    const onsets = [...gen.noteOns].sort((a, b) => a - b);
    // Each callback time is at or after some onset, and no more than a frame plus the hitch late.
    for (const t of gen.heard) {
        const due = onsets.filter((o) => o <= t + 1e-9).at(-1);
        assert.ok(due !== undefined, `callback at ${t} before any note`);
        assert.ok(t - due < 0.1, `callback ${((t - due) * 1000).toFixed(1)} ms after its note`);
    }
});

// -----------------------------------------------------------------------------
// The garden sequencer on the module (Music Garden slice B)
// -----------------------------------------------------------------------------

console.log('garden DSP: garden flora');

const { GardenSequencer } = await import('../src/audio/garden/sequencer.ts');
const { GardenPlayer } = await import('../src/audio/garden/player.ts');
const { stepSeconds } = await import('../src/audio/garden/clock.ts');
const { getBiomeProfile } = await import('../src/audio/generative/biome-profiles.ts');
const { GARDEN_PATCHES: GARDEN_PATCHES_REF } =
    await import('../src/audio/generative/dsp-patches.ts');

/**
 * Chimes, a kick, a snare and a hat planted around the listener, played by the garden player on
 * its own clock into the real module: GardenSequencer -> GardenPlayer -> EventRing ->
 * GardenDspHost, with a 60 Hz main thread and a 90 ms hitch while the "audio thread" renders.
 */
function renderGarden(seconds, bpm) {
    const host = newHost({});
    const ring = EventRing.create(1024, true);
    for (const [slot, spec] of GARDEN_PATCHES_REF) host.setPatch(slot, spec);
    const noteOns = [];
    const target = {
        healthy: true,
        noteOn(time, patch, note, velocity, duration, pan = 0, tag = 0) {
            noteOns.push({ time, patch });
            return ring.push(EventKind.NoteOn, time, patch, note, velocity, duration, pan, tag);
        },
        setGlobal() {},
        allOff() {},
    };
    const ctx = { currentTime: 0, state: 'running', outputLatency: 0, baseLatency: 0 };
    const seq = new GardenSequencer();
    seq.setKey(getBiomeProfile('global'));
    const plant = (id, type, x, params) => ({ id, type, x, z: 3, params });
    seq.setPlants(
        [
            plant('c1', 'chime_tulip', -4, { degree: 4, step: 0 }),
            plant('c2', 'chime_tulip', 4, { degree: 7, step: 6 }),
            plant('k', 'drum_puffball', -2, { drum: 'kick', shift: 0 }),
            plant('s', 'drum_puffball', 2, { drum: 'snare', shift: 0 }),
            plant('h', 'drum_puffball', 0, { drum: 'hat', shift: 0 }),
        ],
        { x: 0, z: 0, rightX: 1, rightZ: 0 }
    );
    const heard = [];
    const player = new GardenPlayer(
        seq,
        () => ({ ctx, dsp: target, synth: null, destination: null }),
        (h) => heard.push({ time: ctx.currentTime, step: h.step })
    );
    const quanta = Math.ceil((seconds * SR) / DSP_QUANTUM);
    const left = new Float32Array(quanta * DSP_QUANTUM);
    const right = new Float32Array(quanta * DSP_QUANTUM);
    let nextUpdate = 0;
    for (let q = 0; q < quanta; q++) {
        const frame = q * DSP_QUANTUM;
        ctx.currentTime = frame / SR;
        if (frame >= nextUpdate) {
            player.run(ctx.currentTime, bpm);
            player.fireDue(ctx.currentTime);
            nextUpdate += Math.abs(ctx.currentTime - 2) < 0.01 ? 0.09 * SR : SR / 60;
        }
        host.drain(ring, frame);
        host.render(frame, left, right, frame);
    }
    return { left, right, noteOns, heard, host };
}

const garden = renderGarden(6, 120);

test('the garden renders through the module: clean, audible, every note on the 16th grid', () => {
    assertClean(garden.left, 'garden L');
    assertClean(garden.right, 'garden R');
    const level = db(rms(garden.left, SR, 6 * SR));
    assert.ok(level > -45 && level < -3, `level ${level.toFixed(1)} dBFS`);
    const patches = new Set(garden.noteOns.map((n) => n.patch));
    for (const slot of Object.values(GARDEN_SLOTS)) assert.ok(patches.has(slot), `patch ${slot} played`);
    const step = stepSeconds(120);
    const t0 = garden.noteOns[0].time;
    for (const { time } of garden.noteOns) {
        const k = (time - t0) / step;
        assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `note at ${time.toFixed(5)} s is off the grid`);
    }
    assert.equal(garden.host.lateEvents, 0, 'no garden note reached the module late, hitch or not');
    assert.equal(garden.host.droppedEvents, 0, 'no garden event was dropped');
});

test('heard steps fire at or after their time, never before', () => {
    assert.ok(garden.heard.length > 8);
    const onsets = garden.noteOns.map((n) => n.time).sort((a, b) => a - b);
    for (const { time } of garden.heard) {
        const due = onsets.filter((o) => o <= time + 1e-9).at(-1);
        assert.ok(due !== undefined, `heard at ${time} before any note`);
    }
});

if (UPDATE) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(
        GOLDEN,
        JSON.stringify(
            {
                about: 'tests/dsp-render.test.mjs golden renders (48 kHz). Refresh: npm run test:dsp-render -- --update',
                scenes: measured,
            },
            null,
            4
        ) + '\n'
    );
    console.log(`\nWrote ${path.relative(ROOT, GOLDEN)} (${Object.keys(measured).length} scenes)`);
}

console.log(`\n✅ ${passed} garden DSP tests passed`);

/**
 * Music Garden slice B, iteration 2: the garden sequencer on the audio clock.
 *
 * Deterministic, no wasm and no browser: a fake AudioContext, recording voice targets and fake
 * world/audio dependencies, as tests/generative-scheduler.test.ts. The module path (the real
 * candy_dsp.wasm playing the garden patches) is tests/dsp-render.test.mjs.
 *
 * Run: npm run test:garden-sequencer
 */
import assert from 'node:assert/strict';
import {
    GARDEN_PATCH,
    GARDEN_PATCHES,
    ENGINE_PATCHES,
} from '../src/audio/generative/dsp-patches.ts';
import { GenerativeEngine } from '../src/audio/generative/generative-engine.ts';
import { getBiomeProfile } from '../src/audio/generative/biome-profiles.ts';
import { scaleNote, noteNameToMidi } from '../src/audio/generative/scales.ts';
import {
    DspVoiceSink,
    type GardenNoteTarget,
    type GenerativeVoiceSink,
} from '../src/audio/generative/voice-sink.ts';
import { PATCH_RANGE } from '../src/audio/worklet/dsp-abi.ts';
import {
    GardenClock,
    GARDEN_AHEAD_SEC,
    GARDEN_MAX_LATE_SEC,
    stepSeconds,
} from '../src/audio/garden/clock.ts';
import {
    GardenConductor,
    type GardenAudioLike,
    type GardenBeatsLike,
    type GardenEngineLike,
    type GardenPlantView,
} from '../src/audio/garden/conductor.ts';
import { GardenPlayer } from '../src/audio/garden/player.ts';
import {
    GARDEN_HEAR_RADIUS,
    GARDEN_MAX_PLANTS,
    GardenSequencer,
    type GardenListener,
    type GardenPlant,
} from '../src/audio/garden/sequencer.ts';
import { midiToNoteName, playGardenNote } from '../src/audio/garden/voices.ts';
import { CHIME_TULIP_TYPE, DRUM_PUFFBALL_TYPE } from '../src/world/document/garden-flora.ts';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

const HERE: GardenListener = { x: 0, z: 0, rightX: 1, rightZ: 0 };
const tulip = (
    id: string,
    x: number,
    z: number,
    params: unknown = { degree: 0, step: 0 }
): GardenPlant => ({
    id,
    type: CHIME_TULIP_TYPE,
    x,
    z,
    params,
});
const puff = (
    id: string,
    x: number,
    z: number,
    params: unknown = { drum: 'kick', shift: 0 }
): GardenPlant => ({
    id,
    type: DRUM_PUFFBALL_TYPE,
    x,
    z,
    params,
});

interface Played {
    when: number;
    patch: number;
    note: number;
    velocity: number;
    duration: number;
    pan: number;
}

class RecordingTarget implements GardenNoteTarget {
    healthy = true;
    notes: Played[] = [];
    noteOn(
        time: number,
        patch: number,
        note: number,
        velocity: number,
        duration: number,
        pan = 0
    ): boolean {
        this.notes.push({ when: time, patch, note, velocity, duration, pan });
        return true;
    }
    setGlobal(): void {}
    allOff(): void {}
}

interface FakeCtx {
    currentTime: number;
    state: string;
    outputLatency: number;
    baseLatency: number;
    resume(): Promise<void>;
}
const makeCtx = (latency = 0): FakeCtx => ({
    currentTime: 0,
    state: 'running',
    outputLatency: latency,
    baseLatency: 0,
    resume: async () => {},
});

class RecordingSynth implements GenerativeVoiceSink {
    notes: Array<{ note: string; channel: number; when: number }> = [];
    playNote(note: string, channel: number, _v: number, when: number): void {
        this.notes.push({ note, channel, when });
    }
    setBrightness(): void {}
    setReverbWet(): void {}
}

function assertOnGrid(times: number[], step: number, label: string): void {
    for (const t of times) {
        const k = (t - times[0]) / step;
        assert.ok(
            Math.abs(k - Math.round(k)) < 1e-6,
            `${label}: ${t.toFixed(6)} s is off the grid`
        );
    }
}

// ---------------------------------------------------------------------------
console.log('patches');

await test('garden patches sit in PATCH_RANGE.free, distinct, and ship with the engine', () => {
    const slots = Object.values(GARDEN_PATCH);
    assert.equal(new Set(slots).size, slots.length);
    const { first, count } = PATCH_RANGE.free;
    for (const slot of slots) assert.ok(slot >= first && slot < first + count, `slot ${slot}`);
    assert.deepEqual(
        GARDEN_PATCHES.map(([slot]) => slot).sort((a, b) => a - b),
        [...slots].sort((a, b) => a - b)
    );
    const all = ENGINE_PATCHES.map(([slot]) => slot);
    assert.equal(new Set(all).size, all.length, 'no slot is written twice');
    for (const [slot] of ENGINE_PATCHES.filter(([s]) => s < first)) {
        assert.ok(slot < PATCH_RANGE.generative.first + PATCH_RANGE.generative.count);
    }
});

// ---------------------------------------------------------------------------
console.log('clock');

await test('steps land on the exact grid however jittery the frames, queued ahead, never late', () => {
    const clock = new GardenClock();
    const times: Array<{ t: number; step: number; queuedAt: number }> = [];
    let now = 0;
    let seed = 11;
    for (let i = 0; i < 400; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        now += 0.008 + (seed / 2 ** 32) * 0.032;
        clock.run(now, 120, (t, step) => times.push({ t, step, queuedAt: now }));
    }
    assert.ok(times.length > 60);
    assertOnGrid(
        times.map((x) => x.t),
        stepSeconds(120),
        'jitter'
    );
    times.forEach((x, i) => {
        assert.equal(x.step, i % 16, 'steps count 0..15 in order');
        assert.ok(x.t >= x.queuedAt, 'never queued late');
        assert.ok(x.t - x.queuedAt <= GARDEN_AHEAD_SEC + 1e-9, 'never beyond the lookahead');
    });
});

await test('a hitch under the lookahead moves no step; one over MAX_LATE skips but keeps the bar', () => {
    const a = new GardenClock();
    const b = new GardenClock();
    const ta: number[] = [];
    const tb: number[] = [];
    let now = 0;
    for (let i = 0; i < 60; i++) {
        now += 1 / 60;
        a.run(now, 120, (t) => ta.push(t));
    }
    // Same run with a 150 ms frame in the middle.
    now = 0;
    for (let i = 0; i < 60; i++) {
        now += i === 30 ? 0.15 : 1 / 60;
        b.run(now, 120, (t) => tb.push(t));
    }
    const n = Math.min(ta.length, tb.length, 10);
    for (let i = 0; i < n; i++)
        assert.ok(Math.abs(ta[i] - tb[i]) < 1e-9, 'steps sit where they sat');

    const c = new GardenClock();
    const steps: Array<{ t: number; step: number }> = [];
    now = 0;
    for (let i = 0; i < 60; i++) {
        now += 1 / 60;
        c.run(now, 120, (t, step) => steps.push({ t, step }));
    }
    const before = steps.length;
    now += 2; // a background tab
    c.run(now, 120, (t, step) => steps.push({ t, step }));
    const burst = steps.slice(before);
    assert.ok(burst.length <= Math.ceil(GARDEN_AHEAD_SEC / stepSeconds(120)) + 1, 'no burst');
    assert.ok(burst[0].t >= now, 'nothing from the past is played');
    // Stayed on the bar: step numbers kept counting through the skipped time.
    const lost = Math.round((burst[0].t - steps[before - 1].t) / stepSeconds(120)) - 1;
    assert.equal(burst[0].step, (steps[before - 1].step + 1 + lost) % 16);
    assert.ok(GARDEN_MAX_LATE_SEC < 2);
});

await test('lockBeat puts the bar on a beat once, then trims the grid toward the beats it hears', () => {
    const clock = new GardenClock();
    const bpm = 120;
    const sec = stepSeconds(bpm);
    clock.run(1.0, bpm, () => {});
    // The tracker's beats fall at 1.03 + k * 0.5, 17 ms off our grid of 1.05 + k * sec.
    const beat = (k: number) => 1.03 + k * 4 * sec;
    clock.lockBeat(beat(1), bpm);
    assert.equal(clock.isLocked, true);
    assert.equal(clock.step % 4, ((clock.step % 4) + 4) % 4);
    // The step the grid has at a beat is a multiple of 4.
    const stepAt = (t: number) =>
        (((clock.step + Math.round((t - clock.nextTime) / sec)) % 16) + 16) % 16;
    assert.equal(stepAt(beat(2)) % 4, 0, 'a beat is a downbeat of the beat grid');
    // Converges: each beat closes a quarter of the error.
    let err = Infinity;
    for (let k = 2; k < 40; k++) {
        clock.run(beat(k) - 0.1, bpm, () => {});
        clock.lockBeat(beat(k), bpm);
        const n = Math.round((beat(k + 1) - clock.nextTime) / sec);
        err = Math.abs(beat(k + 1) - (clock.nextTime + n * sec));
    }
    assert.ok(
        err < 0.08 * sec + 1e-6,
        `grid within tolerance of the beat (${(err * 1000).toFixed(2)} ms)`
    );
    // A single wild observation cannot yank the grid more than a tenth of a step.
    const before = clock.nextTime;
    const nudge = clock.lockBeat(beat(41) + 0.4 * sec, bpm);
    assert.ok(Math.abs(nudge) <= 0.1 * sec + 1e-12);
    assert.ok(Math.abs(clock.nextTime - before) <= 0.1 * sec + 1e-12);
    clock.unlock();
    assert.equal(clock.isLocked, false);
});

// ---------------------------------------------------------------------------
console.log('sequencer');

await test('a chime rings its degree in the biome key, twice a bar, the second softer', () => {
    const seq = new GardenSequencer();
    const profile = getBiomeProfile('arpeggio_grove');
    seq.setKey(profile);
    seq.setPlants([tulip('t1', 2, 0, { degree: 4, step: 3 })], HERE);
    const expected = noteNameToMidi(scaleNote(profile.root, profile.scale, 4, 5));
    const hits: Array<{ step: number; midi: number; velocity: number; instrument: string }> = [];
    for (let s = 0; s < 16; s++) {
        for (const n of seq.notesAt(s))
            hits.push({ step: s, midi: n.midi, velocity: n.velocity, instrument: n.instrument });
    }
    assert.deepEqual(
        hits.map((h) => h.step),
        [3, 11]
    );
    assert.ok(hits.every((h) => h.midi === expected && h.instrument === 'chime'));
    assert.ok(hits[1].velocity < hits[0].velocity);
    // The same pattern in another biome is in that biome's key.
    const other = getBiomeProfile('global');
    seq.setKey(other);
    assert.equal(seq.notesAt(3)[0].midi, noteNameToMidi(scaleNote(other.root, other.scale, 4, 5)));
});

await test('drums keep their grid, the kick sits on the key root, the others ignore pitch', () => {
    const seq = new GardenSequencer();
    const profile = getBiomeProfile('global');
    seq.setKey(profile);
    seq.setPlants(
        [
            puff('k', 1, 0, { drum: 'kick', shift: 0 }),
            puff('s', -1, 0, { drum: 'snare', shift: 0 }),
            puff('h', 0, 1, { drum: 'hat', shift: 0 }),
        ],
        HERE
    );
    const stepsOf = (instrument: string) =>
        [...Array(16).keys()].filter((s) =>
            seq.notesAt(s).some((n) => n.instrument === instrument)
        );
    assert.deepEqual(stepsOf('kick'), [0, 8]);
    assert.deepEqual(stepsOf('snare'), [4, 12]);
    assert.deepEqual(stepsOf('hat'), [2, 6, 10, 14]);
    const kick = seq.notesAt(0).find((n) => n.instrument === 'kick')!;
    assert.equal(kick.midi, noteNameToMidi(scaleNote(profile.root, profile.scale, 0, 2)));
});

await test('plants fade with distance, are silent past earshot, and pan by side', () => {
    const seq = new GardenSequencer();
    seq.setPlants(
        [
            tulip('near', 3, 0),
            tulip('far', 24, 0),
            tulip('gone', GARDEN_HEAR_RADIUS + 1, 0),
            tulip('left', -10, 0),
            tulip('right', 10, 0),
        ],
        HERE
    );
    const byId = new Map(seq.notesAt(0).map((n) => [n.plantId, n]));
    assert.ok(byId.get('near')!.velocity > byId.get('far')!.velocity);
    assert.ok(!byId.has('gone'));
    assert.ok(byId.get('left')!.pan < -0.3 && byId.get('right')!.pan > 0.3);
    // Behind a listener facing the other way the sides swap.
    seq.setPlants([tulip('right', 10, 0)], { ...HERE, rightX: -1 });
    assert.ok(seq.notesAt(0)[0].pan < -0.3);
});

await test('only the nearest GARDEN_MAX_PLANTS sound, the same set on every client', () => {
    const plants: GardenPlant[] = [];
    for (let i = 0; i < 100; i++) plants.push(tulip(`p${i}`, (i % 10) * 3, Math.floor(i / 10) * 3));
    const a = new GardenSequencer();
    const b = new GardenSequencer();
    a.setPlants(plants, HERE);
    b.setPlants([...plants].reverse(), HERE);
    assert.equal(a.playing, GARDEN_MAX_PLANTS);
    const ids = (s: GardenSequencer) =>
        s
            .notesAt(0)
            .map((n) => n.plantId)
            .sort();
    assert.deepEqual(ids(a), ids(b));
});

await test('no params: the figure comes from the id, so two clients agree', () => {
    const a = new GardenSequencer();
    const b = new GardenSequencer();
    const plants = [tulip('x1', 4, 4, undefined), puff('x2', -4, 4, undefined)];
    a.setPlants(plants, HERE);
    b.setPlants(plants, HERE);
    const dump = (s: GardenSequencer) =>
        [...Array(16).keys()].map((st) =>
            s
                .notesAt(st)
                .map((n) => `${n.plantId}:${n.instrument}:${n.midi}`)
                .join(',')
        );
    assert.deepEqual(dump(a), dump(b));
    assert.ok(dump(a).some((d) => d.length > 0));
});

// ---------------------------------------------------------------------------
console.log('voices');

await test('notes go to the DSP garden patch while it is healthy, else to SynthVoice', () => {
    const ctx = makeCtx();
    const target = new RecordingTarget();
    const synth = new RecordingSynth();
    const out = (dsp: GardenNoteTarget | null) =>
        ({ ctx, dsp, synth, destination: {} }) as unknown as Parameters<typeof playGardenNote>[0];
    assert.equal(playGardenNote(out(target), 'chime', 72, 0.5, 1, 0.5, 0.2), 'dsp');
    assert.equal(target.notes[0].patch, GARDEN_PATCH.chime);
    assert.equal(playGardenNote(out(target), 'kick', 36, 0.5, 1, 0.2, 0), 'dsp');
    assert.equal(target.notes[1].patch, GARDEN_PATCH.kick);
    assert.equal(target.notes[1].note, 36);

    assert.equal(playGardenNote(out(null), 'chime', 72, 0.5, 1, 0.5, 0.2), 'synth');
    assert.deepEqual(synth.notes[0], { note: 'C5', channel: 4, when: 1 });
    assert.equal(playGardenNote(out(null), 'kick', 36, 0.5, 2, 0.2, 0), 'synth');
    assert.equal(synth.notes[1].channel, 0);
    assert.equal(midiToNoteName(61), 'C#4');
});

// ---------------------------------------------------------------------------
console.log('player');

function makePlayer(dsp: GardenNoteTarget | null, synth: GenerativeVoiceSink) {
    const ctx = makeCtx();
    const heard: Array<{ step: number; ids: string[] }> = [];
    const seq = new GardenSequencer();
    seq.setPlants(
        [tulip('t', 2, 0, { degree: 0, step: 0 }), puff('d', -2, 0, { drum: 'kick', shift: 0 })],
        HERE
    );
    const player = new GardenPlayer(
        seq,
        () => ({ ctx, dsp, synth, destination: {} }) as never,
        (h) => heard.push({ step: h.step, ids: h.ids.slice(0, h.count) })
    );
    return { ctx, heard, seq, player };
}

await test('own clock: notes are queued ahead on the grid; visuals wait until the step is heard', () => {
    const target = new RecordingTarget();
    const { ctx, heard, player } = makePlayer(target, new RecordingSynth());
    const latency = 0.05;
    for (let i = 0; i < 240; i++) {
        ctx.currentTime += 1 / 60;
        player.run(ctx.currentTime, 120);
        const before = heard.length;
        player.fireDue(ctx.currentTime - latency);
        void before;
    }
    assert.ok(target.notes.length > 4, `${target.notes.length} notes`);
    assertOnGrid(
        target.notes.map((n) => n.when),
        stepSeconds(120),
        'garden'
    );
    assert.ok(heard.length > 0);
    // A step's visuals fire only once its time has been heard, never before.
    const fresh = makePlayer(new RecordingTarget(), new RecordingSynth());
    fresh.ctx.currentTime = 1;
    fresh.player.run(1, 120);
    assert.ok(fresh.player.pending > 0, 'queued');
    fresh.player.fireDue(0.9);
    assert.equal(fresh.heard.length, 0, 'not heard yet');
    fresh.player.fireDue(1.2);
    assert.ok(fresh.heard.length > 0);
    assert.deepEqual(fresh.heard[0].ids.sort(), ['d', 't']);
    assert.equal(fresh.heard[0].step, 0);
});

await test('the SynthVoice fallback plays the same steps when the worklet is absent (?no_dsp)', () => {
    const synth = new RecordingSynth();
    const { ctx, player } = makePlayer(null, synth);
    ctx.currentTime = 0.5;
    player.run(ctx.currentTime, 120);
    assert.ok(synth.notes.length > 0);
    assert.equal(player.sent.synth, synth.notes.length);
    assert.equal(player.sent.dsp, 0);
});

await test('no output yet (no audio context): nothing is sent or queued', () => {
    const seq = new GardenSequencer();
    seq.setPlants([tulip('t', 2, 0)], HERE);
    const player = new GardenPlayer(
        seq,
        () => null,
        () => assert.fail('nothing to hear')
    );
    assert.equal(player.scheduleStep(1, 0, 0.125), 0);
    assert.equal(player.pending, 0);
    player.fireDue(10);
    assert.equal(player.sent.steps, 0);
});

// ---------------------------------------------------------------------------
console.log('conductor');

class FakeEngine implements GardenEngineLike {
    schedule: Array<(t: number, s: number, sec: number) => void> = [];
    heard: Array<() => void> = [];
    dsp: GardenNoteTarget | null;
    constructor(
        readonly ctx: FakeCtx,
        dsp: GardenNoteTarget | null,
        readonly synth: GenerativeVoiceSink
    ) {
        this.dsp = dsp;
    }
    get gardenOutput() {
        return { ctx: this.ctx, dsp: this.dsp, synth: this.synth, destination: {} } as never;
    }
    getActiveProfile() {
        return getBiomeProfile('arpeggio_grove');
    }
    addScheduleListener(l: (t: number, s: number, sec: number) => void) {
        this.schedule.push(l);
        return () => void this.schedule.splice(this.schedule.indexOf(l), 1);
    }
    addStepListener(l: () => void) {
        this.heard.push(l);
        return () => void this.heard.splice(this.heard.indexOf(l), 1);
    }
}

class FakeAudio implements GardenAudioLike {
    generativeEngine: FakeEngine | null;
    audioContext: unknown = {};
    musicSourceMode: 'tracker' | 'generative' = 'generative';
    isPlaying = false;
    visualState = { bpm: 140 };
    generativeActive = false;
    ensured = 0;
    constructor(
        public ctx: FakeCtx,
        engine: FakeEngine | null
    ) {
        this.generativeEngine = engine;
    }
    isGenerativeActive() {
        return this.generativeActive;
    }
    async ensureGenerativeEngine() {
        this.ensured++;
        return this.generativeEngine;
    }
}

function makeConductor(
    audio: FakeAudio | null,
    beats: GardenBeatsLike | null,
    plants: GardenPlantView[]
) {
    const pulses: string[][] = [];
    const conductor = new GardenConductor({
        audio: () => audio,
        beats: () => beats,
        plants: () => plants,
        biomeKey: () => getBiomeProfile('global'),
        seasonTempoScale: () => 1,
        onHeard: (ps) => pulses.push(ps.map((p) => p.id)),
    });
    return { conductor, pulses };
}

const view = (p: GardenPlant): GardenPlantView => ({ ...p, object: { id: p.id } });
const frame = { dt: 1 / 60, x: 0, z: 0, rightX: 1, rightZ: 0 };

await test('generative mode rides the engine grid: same times, no clock of its own, visuals when heard', async () => {
    const ctx = makeCtx();
    const target = new RecordingTarget();
    const engineSynth = new RecordingSynth();
    // The real engine, with a recording DSP target as its voices.
    const engine = new GenerativeEngine({ seed: 0xca4d0001 });
    engine.attach(ctx as unknown as AudioContext, {} as GainNode, {
        dsp: false,
        fallback: engineSynth,
    });
    engine.useDspSink(new DspVoiceSink(target));
    await engine.start();

    const audio = new FakeAudio(ctx, null);
    audio.generativeEngine = engine as unknown as FakeEngine;
    audio.generativeActive = true;
    const plants = [
        view(tulip('t', 2, 0, { degree: 0, step: 0 })),
        view(puff('k', -2, 0, { drum: 'kick', shift: 0 })),
    ];
    const { conductor, pulses } = makeConductor(audio, null, plants);

    const gardenAt: number[] = [];
    const engineAt: number[] = [];
    const stepSec = () => 60 / (engine.getVisualState().bpm * 4);
    for (let i = 0; i < 600; i++) {
        ctx.currentTime += 1 / 60;
        engine.update(1 / 60);
        conductor.update(frame);
    }
    for (const n of target.notes) {
        if (n.patch >= PATCH_RANGE.free.first) gardenAt.push(n.when);
        else engineAt.push(n.when);
    }
    assert.equal(conductor.mode, 'generative');
    assert.ok(gardenAt.length >= 8, `${gardenAt.length} garden notes`);
    assert.ok(engineAt.length > 0);
    // Every garden note sits on the soundtrack's own 16th grid (same origin, same tempo).
    const origin = engineAt[0];
    for (const t of gardenAt) {
        const k = (t - origin) / stepSec();
        assert.ok(
            Math.abs(k - Math.round(k)) < 1e-6,
            `garden note at ${t} is off the soundtrack grid`
        );
    }
    assert.equal(conductor.player.clock.nextTime, 0, 'its own clock never ran');
    // Kick on the one and the three, chime on the one: step 0 of the engine's bar is step 0 here.
    const kicks = target.notes.filter((n) => n.patch === GARDEN_PATCH.kick).map((n) => n.when);
    const gap = kicks[1] - kicks[0];
    assert.ok(Math.abs(gap - 8 * stepSec()) < 1e-6, 'kicks half a bar apart');
    assert.ok(pulses.length > 0 && pulses.every((p) => p.length > 0), 'plants pulse when heard');
    // Visuals never run ahead of the sound: after a stop, nothing more fires.
    engine.stop();
});

await test('tracker mode: its own clock at the tracker tempo, locked to BeatSync beats', () => {
    const ctx = makeCtx();
    const target = new RecordingTarget();
    const engine = new FakeEngine(ctx, target, new RecordingSynth());
    const audio = new FakeAudio(ctx, engine);
    audio.musicSourceMode = 'tracker';
    audio.isPlaying = true;
    audio.visualState.bpm = 150;
    let onBeat: ((s: { bpm: number }) => void) | null = null;
    const beats: GardenBeatsLike = {
        onBeat: (cb) => (onBeat = cb),
        offBeat: () => (onBeat = null),
    };
    const { conductor } = makeConductor(audio, beats, [view(tulip('t', 2, 0))]);
    for (let i = 0; i < 180; i++) {
        ctx.currentTime += 1 / 60;
        conductor.update(frame);
    }
    assert.equal(conductor.mode, 'tracker');
    assert.ok(onBeat, 'registered with BeatSync');
    assertOnGrid(
        target.notes.map((n) => n.when),
        stepSeconds(150),
        'tracker tempo'
    );
    // A beat arrives: the clock locks.
    onBeat!({ bpm: 150 });
    assert.equal(conductor.player.clock.isLocked, true);
    // The module stops: back to idle, lock dropped, the beat hook is not used.
    audio.isPlaying = false;
    ctx.currentTime += 0.1;
    conductor.update(frame);
    assert.equal(conductor.mode, 'idle');
    assert.equal(conductor.player.clock.isLocked, false);
    conductor.dispose();
    assert.equal(onBeat, null, 'dispose unhooks BeatSync');
});

await test('idle mode plays at the biome tempo; without a running context it stays silent', () => {
    const ctx = makeCtx();
    const target = new RecordingTarget();
    const audio = new FakeAudio(ctx, new FakeEngine(ctx, target, new RecordingSynth()));
    audio.musicSourceMode = 'tracker';
    const { conductor } = makeConductor(audio, null, [view(tulip('t', 2, 0))]);
    ctx.state = 'suspended';
    for (let i = 0; i < 60; i++) {
        ctx.currentTime += 1 / 60;
        conductor.update(frame);
    }
    assert.equal(target.notes.length, 0, 'no gesture yet: nothing queued');
    ctx.state = 'running';
    for (let i = 0; i < 240; i++) {
        ctx.currentTime += 1 / 60;
        conductor.update(frame);
    }
    assert.equal(conductor.mode, 'idle');
    assert.ok(target.notes.length > 0);
    assertOnGrid(
        target.notes.map((n) => n.when),
        stepSeconds(getBiomeProfile('global').tempo),
        'idle'
    );
});

await test('?no_dsp or a broken worklet: the same garden through SynthVoice, no crash', () => {
    const ctx = makeCtx();
    const synth = new RecordingSynth();
    const audio = new FakeAudio(ctx, new FakeEngine(ctx, null, synth));
    audio.musicSourceMode = 'tracker';
    const { conductor } = makeConductor(audio, null, [
        view(tulip('t', 2, 0)),
        view(puff('k', -2, 0)),
    ]);
    for (let i = 0; i < 240; i++) {
        ctx.currentTime += 1 / 60;
        conductor.update(frame);
    }
    assert.ok(synth.notes.length > 0);
    assert.ok(synth.notes.every((n) => n.channel === 0 || n.channel === 4));
    assert.equal(conductor.player.sent.dsp, 0);
});

await test('a tracker file from the start: the engine is built once so the worklet can load', async () => {
    const ctx = makeCtx();
    const audio = new FakeAudio(ctx, null);
    audio.musicSourceMode = 'tracker';
    audio.isPlaying = true;
    const { conductor } = makeConductor(audio, null, [view(tulip('t', 2, 0))]);
    for (let i = 0; i < 30; i++) conductor.update(frame);
    await Promise.resolve();
    assert.equal(audio.ensured, 1, 'asked once, not every frame');
});

await test('nothing planted: the garden never touches the audio system', () => {
    const ctx = makeCtx();
    const audio = new FakeAudio(ctx, null);
    const { conductor } = makeConductor(audio, null, []);
    for (let i = 0; i < 120; i++) conductor.update(frame);
    assert.equal(audio.ensured, 0);
    assert.equal(conductor.player.pending, 0);
});

console.log(`\n✅ garden sequencer: ${passed} tests passed`);
process.exit(0);

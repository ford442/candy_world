/**
 * GenerativeEngine scheduling on the audio clock (src/audio/generative/
 * generative-engine.ts): notes are queued SCHEDULE_AHEAD_SEC ahead on an exact
 * 16th-note grid however irregular the frame updates are, a hitch shorter
 * than the lookahead moves no note, a long one skips steps instead of
 * bursting them, visuals fire only once their step is heard, and notes go to
 * the DSP sink while it is healthy and to the fallback otherwise.
 *
 * No wasm, no browser: a fake AudioContext and recording sinks. The real
 * module path is tests/dsp-render.test.mjs.
 *
 * Run: npm run test:generative-scheduler
 */
import assert from 'node:assert/strict';
import {
    GenerativeEngine,
    MAX_LATE_SEC,
    SCHEDULE_AHEAD_SEC,
} from '../src/audio/generative/generative-engine.ts';
import { DspVoiceSink, type GenerativeVoiceSink } from '../src/audio/generative/voice-sink.ts';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

interface FakeCtx {
    currentTime: number;
    state: string;
    outputLatency: number;
    baseLatency: number;
    resume(): Promise<void>;
}

class RecordingSink implements GenerativeVoiceSink {
    notes: Array<{ when: number; scheduledAt: number; channel: number }> = [];
    allOffs = 0;
    healthy = true;
    constructor(private readonly ctx: FakeCtx) {}
    playNote(_note: string, channel: number, _velocity: number, when: number): void {
        this.notes.push({ when, scheduledAt: this.ctx.currentTime, channel });
    }
    setBrightness(): void {}
    setReverbWet(): void {}
    allOff(): void {
        this.allOffs++;
    }
}

function makeCtx(latency = 0): FakeCtx {
    return {
        currentTime: 0,
        state: 'running',
        outputLatency: latency,
        baseLatency: 0,
        resume: async () => {},
    };
}

async function startEngine(ctx: FakeCtx, fallback: GenerativeVoiceSink): Promise<GenerativeEngine> {
    const engine = new GenerativeEngine({ seed: 0xca4d0001 });
    engine.attach(ctx as unknown as AudioContext, {} as GainNode, { dsp: false, fallback });
    await engine.start();
    return engine;
}

/** Drive updates at `dt(i)` seconds apart for `seconds` of audio time. */
function drive(
    engine: GenerativeEngine,
    ctx: FakeCtx,
    seconds: number,
    dt: (i: number) => number
): void {
    let i = 0;
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end) {
        const d = dt(i++);
        ctx.currentTime += d;
        engine.update(d);
    }
}

function stepOf(engine: GenerativeEngine): number {
    return 60 / (engine.getVisualState().bpm * 4);
}

function assertOnGrid(times: number[], step: number, label: string): void {
    const t0 = times[0];
    for (const t of times) {
        const k = (t - t0) / step;
        assert.ok(
            Math.abs(k - Math.round(k)) < 1e-6,
            `${label}: ${t.toFixed(6)} s is off the grid`
        );
    }
}

console.log('generative scheduler');

await test('jittery frames and a 90 ms hitch: every note lands on the 16th grid, queued ahead', async () => {
    const ctx = makeCtx();
    const sink = new RecordingSink(ctx);
    const engine = await startEngine(ctx, sink);
    // 8-40 ms frames, deterministic, and one 90 ms frame at the 3 s mark.
    let seed = 7;
    drive(engine, ctx, 6, () => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        if (Math.abs(ctx.currentTime - 3) < 0.02) return 0.09;
        return 0.008 + (seed / 2 ** 32) * 0.032;
    });
    assert.ok(sink.notes.length > 40, `${sink.notes.length} notes`);
    assertOnGrid(
        sink.notes.map((n) => n.when),
        stepOf(engine),
        'jitter'
    );
    for (const n of sink.notes) {
        assert.ok(
            n.when >= n.scheduledAt,
            `a note was queued ${((n.scheduledAt - n.when) * 1000).toFixed(1)} ms late`
        );
        assert.ok(
            n.when - n.scheduledAt <= SCHEDULE_AHEAD_SEC + 1e-9,
            'never queued beyond the lookahead'
        );
    }
});

await test('a hitch longer than MAX_LATE_SEC skips the missed steps instead of bursting them', async () => {
    const ctx = makeCtx();
    const sink = new RecordingSink(ctx);
    const engine = await startEngine(ctx, sink);
    drive(engine, ctx, 1, () => 1 / 60);
    const before = sink.notes.length;
    // The tab was in the background for two seconds.
    ctx.currentTime += 2;
    engine.update(2);
    const burst = sink.notes.slice(before);
    const step = stepOf(engine);
    const maxSteps = Math.ceil((SCHEDULE_AHEAD_SEC + 0.05) / step) + 1;
    const steps = new Set(burst.map((n) => n.when.toFixed(6))).size;
    assert.ok(steps <= maxSteps, `${steps} steps queued at once after the hitch (max ${maxSteps})`);
    assert.ok(
        burst.every((n) => n.when >= ctx.currentTime),
        'nothing queued in the past'
    );
    assert.ok(2 > MAX_LATE_SEC);
    drive(engine, ctx, 2, () => 1 / 60);
    assertOnGrid(
        sink.notes.slice(before).map((n) => n.when),
        step,
        'after resync'
    );
});

await test('visuals and note callbacks fire when the step is heard (clock less output latency)', async () => {
    const latency = 0.04;
    const ctx = makeCtx(latency);
    const sink = new RecordingSink(ctx);
    const engine = await startEngine(ctx, sink);
    const heard: number[] = [];
    engine.onNote(() => heard.push(ctx.currentTime));
    let kicks = 0;
    let last = 0;
    drive(engine, ctx, 4, () => {
        const k = engine.getVisualState().kickTrigger;
        if (k > last + 0.5) kicks++;
        last = k;
        return 1 / 60;
    });
    assert.ok(heard.length > 30 && kicks > 3);
    const onsets = sink.notes.map((n) => n.when).sort((a, b) => a - b);
    for (const t of heard) {
        const due = onsets.filter((o) => o + latency <= t + 1e-9).at(-1);
        assert.ok(
            due !== undefined,
            `a callback at ${t.toFixed(3)} s fired before its note was heard`
        );
        assert.ok(t - (due + latency) < 1 / 60 + 1e-9, 'and within a frame of it');
    }
});

await test('notes go to the DSP sink while healthy, to the fallback otherwise; stop() releases', async () => {
    const ctx = makeCtx();
    const fallback = new RecordingSink(ctx);
    const engine = await startEngine(ctx, fallback);
    assert.equal(engine.voiceBackend, 'synth');
    const target = {
        healthy: true,
        notes: 0,
        offs: 0,
        globals: new Map<string, number>(),
        noteOn() {
            this.notes++;
            return true;
        },
        setGlobal(name: string, value: number) {
            this.globals.set(name, value);
        },
        allOff() {
            this.offs++;
        },
    };
    engine.useDspSink(new DspVoiceSink(target));
    assert.equal(engine.voiceBackend, 'dsp');
    assert.ok(
        target.globals.has('duckDepth') && target.globals.has('brightness'),
        'globals sent on attach'
    );
    drive(engine, ctx, 1, () => 1 / 60);
    assert.ok(target.notes > 0 && fallback.notes.length === 0, 'all notes on the DSP');
    target.healthy = false;
    drive(engine, ctx, 1, () => 1 / 60);
    assert.equal(engine.voiceBackend, 'synth');
    assert.ok(fallback.notes.length > 0, 'the fallback took over');
    engine.stop();
    assert.equal(fallback.allOffs, 1, 'stop() released the active sink');
    const n = fallback.notes.length;
    drive(engine, ctx, 1, () => 1 / 60);
    assert.equal(fallback.notes.length, n, 'nothing scheduled while stopped');
});

console.log(`\n✅ ${passed} generative scheduler tests passed`);

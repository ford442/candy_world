/**
 * The garden worklet's event transports (src/audio/worklet/event-ring.ts):
 * the SharedArrayBuffer SPSC ring (FIFO, wrap-around, full/drop accounting,
 * stats slots, a real producer thread against a consumer) and the posted
 * EventBatch fallback (one send per task, capacity flushes).
 *
 * No wasm needed: this is part of the PR gate. The DSP side is
 * tests/dsp-render.test.mjs.
 *
 * Run: npm run test:garden-events
 */
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { EVENT_WORDS, EventBatch, EventKind, EventRing } from '../src/audio/worklet/event-ring.ts';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

console.log('garden event ring');

await test('capacity must be a power of two; the size implies it on attach', () => {
    assert.throws(() => EventRing.create(3), /power of two/);
    assert.throws(() => EventRing.create(1), /power of two/);
    const ring = EventRing.create(16, false);
    assert.equal(new EventRing(ring.buffer).capacity, 16);
    assert.throws(() => new EventRing(new ArrayBuffer(100)), /not a ring buffer/);
});

await test('records come out in order with every field intact', () => {
    const ring = EventRing.create(8, false);
    const rec = new Float64Array(EVENT_WORDS);
    assert.equal(ring.pop(rec), false, 'empty ring pops nothing');
    assert.ok(ring.push(EventKind.NoteOn, 1.25, 3, 61.5, 0.8, 0.5, -0.25, 42));
    assert.ok(ring.push(EventKind.NoteOff, 2.5, 42));
    assert.equal(ring.size(), 2);
    assert.ok(ring.pop(rec));
    assert.deepEqual([...rec], [EventKind.NoteOn, 1.25, 3, 61.5, 0.8, 0.5, -0.25, 42]);
    assert.ok(ring.pop(rec));
    assert.deepEqual([...rec], [EventKind.NoteOff, 2.5, 42, 0, 0, 0, 0, 0]);
    assert.equal(ring.size(), 0);
});

await test('a full ring drops and counts, and recovers after a pop', () => {
    const ring = EventRing.create(4, false);
    for (let i = 0; i < 4; i++) assert.ok(ring.push(EventKind.Duck, i, i));
    assert.equal(ring.push(EventKind.Duck, 9, 9), false);
    assert.equal(ring.dropped, 1);
    const rec = new Float64Array(EVENT_WORDS);
    assert.ok(ring.pop(rec));
    assert.equal(rec[2], 0);
    assert.ok(ring.push(EventKind.Duck, 4, 4));
    const seen: number[] = [];
    while (ring.pop(rec)) seen.push(rec[2]);
    assert.deepEqual(seen, [1, 2, 3, 4]);
});

await test('indices wrap through int32 overflow without losing order', () => {
    const ring = EventRing.create(8, false);
    // Start both indices just below 2^31 so they overflow mid-test.
    const header = new Int32Array(ring.buffer, 0, 8);
    header[0] = header[1] = 2 ** 31 - 5;
    const rec = new Float64Array(EVENT_WORDS);
    let next = 0;
    for (let round = 0; round < 50; round++) {
        for (let i = 0; i < 5; i++) assert.ok(ring.push(EventKind.Duck, 0, round * 5 + i));
        assert.equal(ring.size(), 5);
        for (let i = 0; i < 5; i++) {
            assert.ok(ring.pop(rec));
            assert.equal(rec[2], next++);
        }
    }
    assert.ok(header[0] < 0, 'write index went through the overflow');
});

await test('stats slots round-trip and do not touch the queue', () => {
    const ring = EventRing.create(8, false);
    ring.writeStat('activeVoices', 17);
    ring.writeStat('quanta', 123456);
    ring.writeStat('lateEvents', 2);
    assert.equal(ring.readStat('activeVoices'), 17);
    assert.equal(ring.readStat('quanta'), 123456);
    assert.equal(ring.readStat('lateEvents'), 2);
    assert.equal(ring.size(), 0);
});

await test('SPSC across two threads: 200k records, a 64-slot ring, none lost or reordered', async () => {
    const count = 200_000;
    const ring = EventRing.create(64, true);
    const worker = new Worker(new URL('./support/event-ring-producer.ts', import.meta.url), {
        workerData: { buffer: ring.buffer, count },
    });
    const done = new Promise<{ fullSpins: number; dropped: number }>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
    });
    const rec = new Float64Array(EVENT_WORDS);
    let got = 0;
    const deadline = Date.now() + 60_000;
    while (got < count) {
        if (!ring.pop(rec)) {
            assert.ok(Date.now() < deadline, `consumer starved at ${got}/${count}`);
            continue;
        }
        const i = got;
        if (
            rec[0] !== EventKind.NoteOn ||
            rec[1] !== i * 0.001 ||
            rec[2] !== i % 32 ||
            rec[3] !== 60 + (i % 12) ||
            rec[4] !== i / count ||
            rec[5] !== 0.25 ||
            rec[6] !== -i ||
            rec[7] !== i
        ) {
            assert.fail(`record ${i} arrived as [${[...rec].join(', ')}]`);
        }
        got++;
        // Pause now and then so the producer certainly meets a full ring.
        if (got % 8192 === 0) {
            const until = performance.now() + 0.2;
            while (performance.now() < until) {
                /* spin */
            }
        }
    }
    const result = await done;
    await worker.terminate();
    assert.equal(ring.size(), 0);
    assert.ok(
        result.fullSpins > 0,
        'the producer outran the consumer at least once (the ring filled)'
    );
    console.log(
        `    (producer found the ring full ${result.fullSpins} times; ${result.dropped} pushes refused)`
    );
});

console.log('garden event batch (no SharedArrayBuffer)');

await test('records pushed in one task go out as one batch', async () => {
    const sent: Array<{ data: Float64Array; count: number }> = [];
    const batch = new EventBatch((data, count) => sent.push({ data, count }), 16);
    batch.push(EventKind.NoteOn, 1, 0, 60, 1, 0.5, 0, 7);
    batch.push(EventKind.NoteOff, 1.5, 7);
    assert.equal(sent.length, 0, 'nothing is sent synchronously');
    await Promise.resolve();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].count, 2);
    assert.equal(sent[0].data.length, 2 * EVENT_WORDS);
    assert.deepEqual([...sent[0].data.subarray(8, 11)], [EventKind.NoteOff, 1.5, 7]);
    assert.equal(batch.pending, 0);
});

await test('a full batch flushes early; the buffer it sent is a copy', async () => {
    const sent: Float64Array[] = [];
    const batch = new EventBatch((data) => sent.push(data), 4);
    for (let i = 0; i < 10; i++) batch.push(EventKind.Duck, i, i);
    assert.equal(sent.length, 2, 'two full batches went out synchronously');
    await Promise.resolve();
    assert.equal(sent.length, 3);
    const values = sent.flatMap((d) => {
        const out: number[] = [];
        for (let o = 0; o < d.length; o += EVENT_WORDS) out.push(d[o + 2]);
        return out;
    });
    assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    sent[0][2] = -1; // the receiver owns its copy
    batch.push(EventKind.Duck, 0, 99);
    await Promise.resolve();
    assert.equal(sent[3][2], 99);
});

await test('the default scheduler calls queueMicrotask unbound (browsers throw "Illegal invocation" otherwise)', async () => {
    const real = globalThis.queueMicrotask;
    // Browser semantics: the global function rejects any `this` but the global object.
    globalThis.queueMicrotask = function (this: unknown, fn: () => void) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        real(fn);
    };
    try {
        const sent: number[] = [];
        const batch = new EventBatch((_d, count) => sent.push(count));
        batch.push(EventKind.AllOff, 0);
        await Promise.resolve();
        assert.deepEqual(sent, [1]);
    } finally {
        globalThis.queueMicrotask = real;
    }
});

console.log(`\n✅ ${passed} garden event ring tests passed`);

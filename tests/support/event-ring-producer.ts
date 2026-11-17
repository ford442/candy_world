/**
 * Worker for tests/garden-event-ring.test.ts: the producer side of a real
 * two-thread EventRing run. Pushes `count` NoteOn records whose fields encode
 * their sequence number, retrying (never blocking) while the ring is full.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { EventKind, EventRing } from '../../src/audio/worklet/event-ring.ts';

const { buffer, count } = workerData as { buffer: SharedArrayBuffer; count: number };
const ring = new EventRing(buffer);
let fullSpins = 0;
for (let i = 0; i < count; i++) {
    while (!ring.push(EventKind.NoteOn, i * 0.001, i % 32, 60 + (i % 12), i / count, 0.25, -i, i)) {
        fullSpins++;
    }
}
parentPort?.postMessage({ fullSpins, dropped: ring.dropped });

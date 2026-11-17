/**
 * Note events from the main thread to the garden AudioWorklet.
 *
 * Every event is one fixed record of EVENT_WORDS float64s:
 *
 *   [kind, timeSec, a, b, c, d, e, f]
 *
 *   NoteOn   a patch, b MIDI note (fractional ok), c velocity 0..1,
 *            d duration s (<= 0: hold until NoteOff), e pan -1..1, f tag
 *   NoteOff  a tag
 *   Duck     a amount 0..1
 *   Patch    a patch id, b param id, c value        (applied on arrival)
 *   Global   a param id, b value                    (applied on arrival)
 *   AllOff   -                                       (applied on arrival)
 *
 * timeSec is AudioContext time; the worklet turns it into a sample frame, so
 * a note plays on its frame however late the main thread got to it.
 *
 * Two transports carry the same records:
 *
 * - EventRing: a lock-free single-producer / single-consumer ring in a
 *   SharedArrayBuffer (cross-origin isolated pages). The producer writes a
 *   record, then publishes it with Atomics.store on the write index; the
 *   consumer reads the write index with Atomics.load, reads records, then
 *   publishes the read index. Neither side ever waits, so a main-thread hitch
 *   cannot stall the audio thread. Indices are free-running int32 counters
 *   (capacity is a power of two), so `write - read` is the fill level.
 *   The header also carries the worklet's stats back (activeVoices, ...).
 * - EventBatch: without isolation there is no SharedArrayBuffer. Records go
 *   into a batch that is posted (transferred) once per task, at the latest.
 *
 * Import-free on purpose: both the worklet bundle and the main thread use it.
 */

export const EventKind = {
    NoteOn: 1,
    NoteOff: 2,
    Duck: 3,
    Patch: 4,
    Global: 5,
    AllOff: 6,
} as const;

export type EventKindId = (typeof EventKind)[keyof typeof EventKind];

/** float64 words per record. */
export const EVENT_WORDS = 8;

/** Int32 header slots (the data starts after HEADER_BYTES). */
const H_WRITE = 0;
const H_READ = 1;
const H_DROPPED = 2;
/** Stats the consumer (worklet) writes for the producer to read. */
export const RingStat = {
    activeVoices: 3,
    quanta: 4,
    dspDropped: 5,
    lateEvents: 6,
} as const;
export type RingStatName = keyof typeof RingStat;
const HEADER_SLOTS = 8;
const HEADER_BYTES = HEADER_SLOTS * 4;

export interface EventWriter {
    /** Queue one record. Returns false if it was dropped (transport full). */
    push(
        kind: EventKindId,
        timeSec: number,
        a?: number,
        b?: number,
        c?: number,
        d?: number,
        e?: number,
        f?: number
    ): boolean;
}

export class EventRing implements EventWriter {
    readonly buffer: SharedArrayBuffer | ArrayBuffer;
    readonly capacity: number;
    private readonly mask: number;
    private readonly header: Int32Array;
    private readonly data: Float64Array;

    /** Bytes for a ring of `capacity` records (a power of two). */
    static bytesFor(capacity: number): number {
        return HEADER_BYTES + capacity * EVENT_WORDS * 8;
    }

    /** A ring in a new SharedArrayBuffer (or ArrayBuffer, for single-threaded use and tests). */
    static create(capacity = 1024, shared = typeof SharedArrayBuffer !== 'undefined'): EventRing {
        if (!Number.isInteger(capacity) || capacity < 2 || (capacity & (capacity - 1)) !== 0) {
            throw new RangeError(
                `EventRing capacity must be a power of two >= 2 (got ${capacity})`
            );
        }
        const bytes = EventRing.bytesFor(capacity);
        return new EventRing(shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
    }

    /** Attach to a ring another thread created (the capacity is implied by the size). */
    constructor(buffer: SharedArrayBuffer | ArrayBuffer) {
        const capacity = (buffer.byteLength - HEADER_BYTES) / (EVENT_WORDS * 8);
        if (!Number.isInteger(capacity) || capacity < 2 || (capacity & (capacity - 1)) !== 0) {
            throw new RangeError(`EventRing: ${buffer.byteLength} bytes is not a ring buffer`);
        }
        this.buffer = buffer;
        this.capacity = capacity;
        this.mask = capacity - 1;
        this.header = new Int32Array(buffer, 0, HEADER_SLOTS);
        this.data = new Float64Array(buffer, HEADER_BYTES, capacity * EVENT_WORDS);
    }

    /** Producer side. */
    push(kind: EventKindId, timeSec: number, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0): boolean {
        const write = Atomics.load(this.header, H_WRITE);
        const read = Atomics.load(this.header, H_READ);
        if (((write - read) | 0) >= this.capacity) {
            Atomics.add(this.header, H_DROPPED, 1);
            return false;
        }
        const o = (write & this.mask) * EVENT_WORDS;
        const r = this.data;
        r[o] = kind;
        r[o + 1] = timeSec;
        r[o + 2] = a;
        r[o + 3] = b;
        r[o + 4] = c;
        r[o + 5] = d;
        r[o + 6] = e;
        r[o + 7] = f;
        // Publish: the record writes above happen-before a consumer's load of this index.
        Atomics.store(this.header, H_WRITE, (write + 1) | 0);
        return true;
    }

    /** Consumer side: copy the oldest record into `into` (EVENT_WORDS long). False when empty. */
    pop(into: Float64Array): boolean {
        const read = Atomics.load(this.header, H_READ);
        const write = Atomics.load(this.header, H_WRITE);
        if (read === write) return false;
        const o = (read & this.mask) * EVENT_WORDS;
        for (let i = 0; i < EVENT_WORDS; i++) into[i] = this.data[o + i];
        // Release the slot only after copying it out.
        Atomics.store(this.header, H_READ, (read + 1) | 0);
        return true;
    }

    /** Records waiting (either side may call it; the answer is a snapshot). */
    size(): number {
        return (Atomics.load(this.header, H_WRITE) - Atomics.load(this.header, H_READ)) | 0;
    }

    /** Records the producer dropped because the ring was full. */
    get dropped(): number {
        return Atomics.load(this.header, H_DROPPED);
    }

    writeStat(name: RingStatName, value: number): void {
        Atomics.store(this.header, RingStat[name], value | 0);
    }

    readStat(name: RingStatName): number {
        return Atomics.load(this.header, RingStat[name]);
    }
}

/**
 * The no-SharedArrayBuffer transport: records accumulate into a batch that is
 * handed to `send` at the end of the current task (or as soon as it is full).
 */
export class EventBatch implements EventWriter {
    private buf: Float64Array;
    private count = 0;
    private scheduled = false;
    private readonly capacity: number;
    private readonly send: (data: Float64Array, count: number) => void;
    private readonly schedule: (fn: () => void) => void;

    constructor(
        send: (data: Float64Array, count: number) => void,
        capacity = 256,
        // Wrapped: browsers throw "Illegal invocation" if queueMicrotask is called with a `this`.
        schedule: (fn: () => void) => void = (fn) => queueMicrotask(fn)
    ) {
        this.send = send;
        this.capacity = capacity;
        this.schedule = schedule;
        this.buf = new Float64Array(capacity * EVENT_WORDS);
    }

    push(kind: EventKindId, timeSec: number, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0): boolean {
        if (this.count >= this.capacity) this.flush();
        const o = this.count * EVENT_WORDS;
        const r = this.buf;
        r[o] = kind;
        r[o + 1] = timeSec;
        r[o + 2] = a;
        r[o + 3] = b;
        r[o + 4] = c;
        r[o + 5] = d;
        r[o + 6] = e;
        r[o + 7] = f;
        this.count++;
        if (!this.scheduled) {
            this.scheduled = true;
            this.schedule(() => {
                this.scheduled = false;
                this.flush();
            });
        }
        return true;
    }

    /** Hand the queued records to `send` as a copy it may transfer; the batch buffer is reused. */
    flush(): void {
        if (this.count === 0) return;
        const data = this.buf.slice(0, this.count * EVENT_WORDS);
        const count = this.count;
        this.count = 0;
        this.send(data, count);
    }

    get pending(): number {
        return this.count;
    }
}

/**
 * GPU frame time from `timestamp-query`, for the performance budget (#1824).
 *
 * The renderer is built with `trackTimestamp` when the device granted
 * `timestamp-query` (`?debug` or `?graphics=high`). Three 0.171 then writes
 * begin/end timestamps for every render and compute pass and resolves them
 * into a per-pass result buffer, but only reads them back from `renderAsync()`
 * / `computeAsync()`. The game loop renders synchronously, so
 * `renderer.info.render.timestamp` stayed 0 and the budget never saw a GPU
 * time. This reads those result buffers itself.
 *
 * Every pass that resolves timestamps goes through the backend's
 * `prepareTimestampBuffer(context, encoder)`; the timer wraps it to note which
 * contexts ran this frame. Every {@link SAMPLE_INTERVAL_FRAMES} frames it maps
 * their result buffers and reports the sum of pass durations. One sample is in
 * flight at a time, and while a buffer is mapped Three skips its copy into it
 * (it checks `mapState`), so the readback never stalls or races a frame.
 */

/** Frames between readbacks. */
export const SAMPLE_INTERVAL_FRAMES = 30;

/** Duration in ms between two raw GPU timestamps (nanoseconds). */
export function passDurationMs(begin: bigint, end: bigint): number {
    return end > begin ? Number(end - begin) / 1e6 : 0;
}

interface TimestampBuffers {
    resultBuffer: GPUBuffer;
}

interface TimestampBackend {
    trackTimestamp?: boolean;
    prepareTimestampBuffer?: (context: object, encoder: unknown) => void;
    get(context: object): { currentTimestampQueryBuffers?: TimestampBuffers };
}

export interface GpuFrameTimer {
    /** Call once per frame, after rendering. */
    endFrame(): void;
}

const NOOP_TIMER: GpuFrameTimer = { endFrame() {} };

async function readPassMs(buffer: GPUBuffer): Promise<number> {
    if (buffer.mapState !== 'unmapped') return 0;
    await buffer.mapAsync(GPUMapMode.READ);
    try {
        const times = new BigUint64Array(buffer.getMappedRange(), 0, 2);
        return passDurationMs(times[0], times[1]);
    } finally {
        buffer.unmap();
    }
}

/**
 * Start timing GPU frames, reporting each sample to `report`. Returns a no-op
 * timer when the renderer is not tracking timestamps (WebGL2, or the device
 * lacks `timestamp-query`).
 */
export function createGpuFrameTimer(
    renderer: unknown,
    report: (ms: number) => void
): GpuFrameTimer {
    const backend = (renderer as { backend?: TimestampBackend } | null)?.backend;
    if (!backend?.trackTimestamp || typeof backend.prepareTimestampBuffer !== 'function') {
        return NOOP_TIMER;
    }

    let frameContexts = new Set<object>();
    const prepare = backend.prepareTimestampBuffer.bind(backend);
    backend.prepareTimestampBuffer = (context, encoder) => {
        frameContexts.add(context);
        prepare(context, encoder);
    };

    let frame = 0;
    let inFlight = false;

    return {
        endFrame() {
            const contexts = frameContexts;
            frameContexts = new Set();
            if (inFlight || ++frame % SAMPLE_INTERVAL_FRAMES !== 0) return;

            const buffers: GPUBuffer[] = [];
            for (const context of contexts) {
                const result = backend.get(context).currentTimestampQueryBuffers?.resultBuffer;
                if (result) buffers.push(result);
            }
            if (buffers.length === 0) return;

            inFlight = true;
            void Promise.all(buffers.map(readPassMs))
                .then((durations) => {
                    const total = durations.reduce((sum, ms) => sum + ms, 0);
                    if (total > 0) report(total);
                })
                .catch(() => {
                    /* device lost or buffer destroyed mid-read: skip this sample */
                })
                .finally(() => {
                    inFlight = false;
                });
        },
    };
}

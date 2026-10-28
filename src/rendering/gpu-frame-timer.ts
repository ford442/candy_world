/**
 * GPU frame time from `timestamp-query`, for the performance budget (#1824).
 *
 * The renderer is built with `trackTimestamp` when the device granted
 * `timestamp-query` (`?debug` or `?graphics=high`). Three then writes
 * begin/end timestamps for every render and compute pass into a query pool per
 * type, and `renderer.resolveTimestampsAsync(type)` reads the pool back,
 * returning the GPU time of the last frame it holds. Nothing in the game loop
 * resolves it otherwise (it renders synchronously), so `info.render.timestamp`
 * would stay 0.
 *
 * Every {@link SAMPLE_INTERVAL_FRAMES} frames this resolves the `render` and
 * `compute` pools and reports their sum. One resolve is in flight at a time;
 * Three skips the copy into a result buffer that is still mapped, so the
 * readback never stalls a frame. Thirty frames of passes stay well inside the
 * pool's 2048 queries (it resolves itself if it ever fills).
 */

/** Frames between readbacks. */
export const SAMPLE_INTERVAL_FRAMES = 30;

type TimestampType = 'render' | 'compute';

interface TimestampRenderer {
    backend?: { trackTimestamp?: boolean };
    resolveTimestampsAsync?: (type?: TimestampType) => Promise<number | undefined>;
}

export interface GpuFrameTimer {
    /** Call once per frame, after rendering. */
    endFrame(): void;
}

const NOOP_TIMER: GpuFrameTimer = { endFrame() {} };

/**
 * Start timing GPU frames, reporting each sample to `report`. Returns a no-op
 * timer when the renderer is not tracking timestamps (WebGL2, or the device
 * lacks `timestamp-query`).
 */
export function createGpuFrameTimer(
    renderer: unknown,
    report: (ms: number) => void
): GpuFrameTimer {
    const r = renderer as TimestampRenderer | null;
    if (!r?.backend?.trackTimestamp || typeof r.resolveTimestampsAsync !== 'function') {
        return NOOP_TIMER;
    }
    const resolve = r.resolveTimestampsAsync.bind(r);

    let frame = 0;
    let inFlight = false;

    return {
        endFrame() {
            if (inFlight || ++frame % SAMPLE_INTERVAL_FRAMES !== 0) return;
            inFlight = true;
            void Promise.all([resolve('render'), resolve('compute')])
                .then(([render, compute]) => {
                    const total = (render ?? 0) + (compute ?? 0);
                    if (total > 0) report(total);
                })
                .catch(() => {
                    /* device lost mid-read: skip this sample */
                })
                .finally(() => {
                    inFlight = false;
                });
        },
    };
}

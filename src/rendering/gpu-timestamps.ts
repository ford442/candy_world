/**
 * @file gpu-timestamps.ts
 * @description Real GPU pass times for the `?debug=1` systems-budget overlay.
 *
 * When the probe's device was granted `timestamp-query`, `init.ts` builds the
 * renderer with `trackTimestamp: true`, and three r171 then brackets every
 * render and compute pass with a 2-entry timestamp query set and copies the
 * result into a per-pass `MAP_READ` buffer. Three only *reads* those buffers
 * from `renderAsync` / `computeAsync`, which the game loop never calls, so this
 * module reads them itself.
 *
 * - Passes are discovered by wrapping `backend.finishRender` / `finishCompute`.
 * - Every {@link SAMPLE_INTERVAL_FRAMES} frames one read is started off the hot
 *   path (never awaited by the loop); a new one cannot start while one is in
 *   flight. On `low` tiers the feature is not even requested.
 * - Query sets are fixed per pass (count 2) in r171, so nothing grows; buffers
 *   Three is still copying into are skipped (`mapState !== 'unmapped'`).
 *
 * Fail closed: without the feature, {@link getGpuTimings} reports why and the
 * overlay stays CPU-only. Nothing here can block boot.
 */

import { GPU_TIMING_FEATURE, getWebGPUProbeReport, type GpuProbeResult } from './gpu-context.ts';

/** Read cadence. ~2 Hz at 60 fps — often enough for an overlay, cheap enough to ignore. */
export const SAMPLE_INTERVAL_FRAMES = 30;

type PassType = 'render' | 'compute';

interface TimestampBackend {
    trackTimestamp?: boolean;
    get(key: object): { currentTimestampQueryBuffers?: { resultBuffer?: GPUBuffer } } | undefined;
    finishRender(ctx: object): unknown;
    finishCompute(group: object): unknown;
}

export type GpuTimings =
    | {
          available: true;
          /** Sum of the most recent duration of every render pass seen in the window. */
          gpuRenderMs: number;
          gpuComputeMs: number;
          renderPasses: number;
          computePasses: number;
          /** False until the first read resolves. */
          sampled: boolean;
      }
    | { available: false; reason: string };

let backend: TimestampBackend | null = null;
let offReason = 'renderer not initialised';
const seen = new Map<object, PassType>();
let frame = 0;
let inFlight = false;
let last = { gpuRenderMs: 0, gpuComputeMs: 0, renderPasses: 0, computePasses: 0, sampled: false };

function notGrantedReason(probe: GpuProbeResult): string {
    const features = getWebGPUProbeReport()?.features;
    if (!features?.timingWanted) return 'not requested (use ?debug=1 or ?postfx=high)';
    if (!features.adapter.includes(GPU_TIMING_FEATURE))
        return 'timestamp-query not supported by adapter';
    return probe.requiredFeatures.includes(GPU_TIMING_FEATURE)
        ? 'timestamp-query not granted'
        : 'timestamp-query not requested';
}

/** Hook the renderer's backend. Call once, after `armGpuContext`. */
export function installGpuTimestamps(renderer: unknown, probe: GpuProbeResult): void {
    if (!probe.timestampQuery) {
        offReason = notGrantedReason(probe);
        return;
    }
    const b = (renderer as { backend?: TimestampBackend }).backend;
    if (!b?.trackTimestamp || typeof b.finishRender !== 'function') {
        offReason = 'renderer did not enable trackTimestamp';
        return;
    }

    const finishRender = b.finishRender;
    const finishCompute = b.finishCompute;
    b.finishRender = function (ctx: object) {
        const out = finishRender.call(this, ctx);
        seen.set(ctx, 'render');
        return out;
    };
    b.finishCompute = function (group: object) {
        const out = finishCompute.call(this, group);
        seen.set(group, 'compute');
        return out;
    };
    backend = b;
}

/** Per-frame tick from the game loop: a counter, plus a fire-and-forget read every N frames. */
export function tickGpuTimestamps(): void {
    if (!backend) return;
    if (++frame < SAMPLE_INTERVAL_FRAMES || inFlight) return;
    frame = 0;
    inFlight = true;
    void sample(backend).finally(() => {
        inFlight = false;
    });
}

async function sample(b: TimestampBackend): Promise<void> {
    // Only passes that ran since the previous read count, so a render target
    // that stopped being drawn drops out instead of reporting a stale time.
    const passes = [...seen];
    seen.clear();

    const totals = { render: 0, compute: 0 };
    const counts = { render: 0, compute: 0 };
    const reads: Promise<void>[] = [];

    for (const [key, type] of passes) {
        const buffer = b.get(key)?.currentTimestampQueryBuffers?.resultBuffer;
        if (!buffer || buffer.mapState !== 'unmapped') continue;
        reads.push(
            buffer.mapAsync(GPUMapMode.READ).then(() => {
                const times = new BigUint64Array(buffer.getMappedRange());
                // Nanoseconds → ms. A pass whose queries never landed reads 0/0.
                const ms = times[1] > times[0] ? Number(times[1] - times[0]) / 1e6 : 0;
                buffer.unmap();
                totals[type] += ms;
                counts[type]++;
            })
        );
    }

    // A device loss or destroyed buffer rejects its read; the rest still count.
    await Promise.allSettled(reads);
    last = {
        gpuRenderMs: totals.render,
        gpuComputeMs: totals.compute,
        renderPasses: counts.render,
        computePasses: counts.compute,
        sampled: true,
    };
}

/** Latest GPU pass times, or why there are none. */
export function getGpuTimings(): GpuTimings {
    if (!backend) return { available: false, reason: offReason };
    return { available: true, ...last };
}

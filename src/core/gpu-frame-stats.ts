/**
 * Rolling GPU frame time from the timestamp-query sampler in `game-loop.ts`.
 *
 * The game loop used to feed the full `PerformanceBudget` every frame only for
 * this average (the debug panel reads it); nothing in production subscribed to
 * its violations or adaptive settings. This ring keeps the one reading and lets
 * `performance-budget-core.ts` stay out of the boot chunk.
 */

const HISTORY = 60;
const _samples = new Float64Array(HISTORY);
let _count = 0;
let _next = 0;

export function recordGpuFrameTime(ms: number | null): void {
    if (ms === null || !Number.isFinite(ms)) return;
    _samples[_next] = ms;
    _next = (_next + 1) % HISTORY;
    if (_count < HISTORY) _count++;
}

/** Mean of the last `frames` samples (at most 60), or null before the first one. */
export function getAverageGpuFrameTime(frames = HISTORY): number | null {
    const n = Math.min(frames, _count);
    if (n <= 0) return null;
    let total = 0;
    for (let i = 1; i <= n; i++) total += _samples[(_next - i + HISTORY) % HISTORY];
    return total / n;
}

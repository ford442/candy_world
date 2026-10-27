// src/core/scheduler/frame-scheduler.ts
// The scheduler animate() runs every frame (#1973). Kept in its own leaf module
// so a feature, the debug panel or a test can reach it without importing the
// game loop and everything the game loop imports.

import { profiler } from '../../utils/profiler.ts';
import { simRng } from '../../utils/sim-rng.ts';
import { SystemScheduler } from './scheduler.ts';
import type { System } from './types.ts';

export const frameScheduler = new SystemScheduler({
    rng: simRng,
    // `system.<id>` marks: the perf-budget telemetry and the profiler overlay
    // read the same per-system numbers the scheduler measures.
    mark: (label, ms) => profiler.mark(label, ms),
});

/** Add a system to the running frame. Returns a function that removes (and disposes) it. */
export function registerSystem(system: System): () => void {
    return frameScheduler.register(system);
}

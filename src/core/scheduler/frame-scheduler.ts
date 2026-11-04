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
    // game-loop.ts clamps a frame to 0.1s. 6 × 1/60s covers that whole clamp.
    // The default of 5 dropped the last step, so under ~12 fps the player
    // walked in slow motion on top of the hitch.
    maxSubsteps: 6,
    // `system.<id>` marks: the perf-budget telemetry and the profiler overlay
    // read the same per-system numbers the scheduler measures.
    mark: (label, ms) => profiler.mark(label, ms),
});

/** Add a system to the running frame. Returns a function that removes (and disposes) it. */
export function registerSystem(system: System): () => void {
    return frameScheduler.register(system);
}

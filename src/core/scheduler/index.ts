// src/core/scheduler/index.ts
// Public surface of the SystemScheduler (#1973). See docs/ARCHITECTURE.md.

export {
    SystemScheduler,
    BUDGET_WARMUP_FRAMES,
    DEFAULT_MAX_CONSECUTIVE_ERRORS,
    type SchedulerOptions,
} from './scheduler.ts';
export { FixedStepClock, DEFAULT_FIXED_DT, DEFAULT_MAX_SUBSTEPS } from './fixed-step.ts';
export { frameScheduler, registerSystem } from './frame-scheduler.ts';
export {
    PHASES,
    type Phase,
    type FrameClock,
    type FrameContext,
    type FrameInput,
    type FrameSource,
    type AudioFrame,
    type PlayerFrame,
    type System,
    type SystemStats,
} from './types.ts';

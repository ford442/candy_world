// src/core/scheduler/index.ts
// Public surface of the SystemScheduler (#1973). See docs/SCHEDULER.md.

export {
    SystemScheduler,
    DEFAULT_MAX_CONSECUTIVE_ERRORS,
    type SchedulerOptions,
} from './scheduler.ts';
export { FixedStepClock, DEFAULT_FIXED_DT, DEFAULT_MAX_SUBSTEPS } from './fixed-step.ts';
export {
    PHASES,
    type Phase,
    type FrameContext,
    type FrameInput,
    type AudioFrame,
    type PlayerFrame,
    type System,
    type SystemStats,
} from './types.ts';

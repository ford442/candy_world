// src/debug/index.ts
// Lightweight debug exports — heavy panel/tools load via lazy.ts / tools-stub.ts

export {
  DEBUG_CONFIG,
  DEBUG_STAGES,
  StageLoader,
  StageStatus,
  showDebugError,
  getAllStageStatuses,
  getStageStatus,
  isStageGatingActive,
  setStageGating,
  type DebugStages,
  type StageResult,
  type StageMetadata,
} from './stages.ts';

export {
  BOOT_PRESETS,
  STAGE_REGISTRY,
  getOrderedStageIds,
  parseBootPreset,
  type BootPresetId,
  type BootStageId,
} from './boot-registry.ts';

export {
  BootHaltError,
  PROGRESSIVE_BOOT_CONFIG,
  applyBootPreset,
  initProgressiveBoot,
  getBootPipelineState,
  printBootSummary,
  reportBootHalt,
  resetBootPipeline,
  runBootStage,
  installBootDebugHooks,
  type ProgressiveBootConfig,
  type BootPipelineState,
} from './progressive-bootstrap.ts';

export { initDebugPanelIfNeeded, initParticleEmitterDebugIfNeeded } from './lazy.ts';

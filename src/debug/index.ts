// src/debug/index.ts
// Debug system exports

export {
  DEBUG_CONFIG,
  DEBUG_STAGES,
  StageLoader,
  StageStatus,
  showDebugError,
  getAllStageStatuses,
  getStageStatus,
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
  PROGRESSIVE_BOOT_CONFIG,
  applyBootPreset,
  initProgressiveBoot,
  getBootPipelineState,
  printBootSummary,
  runBootStage,
  installBootDebugHooks,
  resetBootPipeline,
  type ProgressiveBootConfig,
  type BootPipelineState,
} from './progressive-bootstrap.ts';

export { DebugPanel, getDebugPanel, initDebugPanel } from './panel.ts';

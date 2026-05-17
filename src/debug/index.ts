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

export { DebugPanel, getDebugPanel, initDebugPanel } from './panel.ts';

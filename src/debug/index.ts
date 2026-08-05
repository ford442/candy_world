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
  type DebugStages,
  type StageResult,
  type StageMetadata,
} from './stages.ts';

export { initDebugPanelIfNeeded } from './lazy.ts';

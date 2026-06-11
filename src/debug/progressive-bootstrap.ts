// src/debug/progressive-bootstrap.ts
// Progressive boot orchestrator: ordered stages, dependency checks, halt-on-failure.

import {
  DEBUG_CONFIG,
  DEBUG_STAGES,
  StageLoader,
  StageStatus,
  showDebugError,
  updateStageStatus,
  type DebugStages,
  type StageResult,
} from './stages.ts';
import {
  BOOT_PRESETS,
  STAGE_REGISTRY,
  getOrderedStageIds,
  parseBootPreset,
  type BootPresetId,
  type BootStageId,
} from './boot-registry.ts';

export interface ProgressiveBootConfig {
  /** When true, critical stage failures stop the pipeline and surface an error */
  haltOnFailure: boolean;
  /** When true, skip stages whose dependencies failed or were skipped in debug mode */
  respectDependencies: boolean;
  /** Verbose grouped console summary after each stage */
  verbose: boolean;
  /** Active preset name (if any) */
  preset: BootPresetId | null;
}

export interface BootPipelineState {
  halted: boolean;
  haltStage?: BootStageId;
  haltError?: string;
  completed: BootStageId[];
  failed: BootStageId[];
  skipped: BootStageId[];
}

const pipelineState: BootPipelineState = {
  halted: false,
  completed: [],
  failed: [],
  skipped: [],
};

function readBootConfig(): ProgressiveBootConfig {
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const debug = params.has('debug');
  const haltExplicit = params.has('halt') || params.get('halt') === '1';
  const preset = parseBootPreset(params.toString());

  return {
    haltOnFailure: debug || haltExplicit,
    respectDependencies: debug || haltExplicit,
    verbose: debug || haltExplicit || params.has('boot'),
    preset,
  };
}

export const PROGRESSIVE_BOOT_CONFIG: ProgressiveBootConfig = readBootConfig();

/**
 * Apply a boot preset to DEBUG_STAGES (debug mode only).
 * Call once during startup before any stages run.
 */
export function applyBootPreset(presetId: BootPresetId): void {
  const preset = BOOT_PRESETS[presetId];
  if (!preset) return;

  (Object.keys(preset) as BootStageId[]).forEach((stage) => {
    const enabled = preset[stage];
    if (enabled !== undefined) {
      DEBUG_STAGES[stage] = enabled;
    }
  });

  console.log(
    `%c[Boot] Applied preset "${presetId}"`,
  'color: #7dd3fc; font-weight: bold'
  );
}

/**
 * Initialize progressive boot from URL params.
 * - ?debug=1&boot=sandbox   → limited sandbox preset + halt on failure
 * - ?halt=1                 → halt on critical failures without full debug UI
 */
export function initProgressiveBoot(): ProgressiveBootConfig {
  resetBootPipeline();

  const config = PROGRESSIVE_BOOT_CONFIG;

  if (config.preset) {
    applyBootPreset(config.preset);
  } else if (DEBUG_CONFIG.enabled) {
    // Debug mode without explicit preset keeps stages.ts defaults (limited/sandbox).
    applyBootPreset('limited');
  }

  if (config.verbose) {
    console.log(
      '%c[Boot] Progressive startup active',
      'color: #7dd3fc; font-weight: bold',
      {
        haltOnFailure: config.haltOnFailure,
        respectDependencies: config.respectDependencies,
        preset: config.preset ?? (DEBUG_CONFIG.enabled ? 'limited' : 'production'),
      }
    );
    console.log(
      '%c[Boot] Enable stages incrementally: ?debug=1&boot=sandbox → standard → full',
      'color: #94a3b8'
    );
  }

  return config;
}

export function resetBootPipeline(): void {
  pipelineState.halted = false;
  pipelineState.haltStage = undefined;
  pipelineState.haltError = undefined;
  pipelineState.completed = [];
  pipelineState.failed = [];
  pipelineState.skipped = [];
}

export function getBootPipelineState(): Readonly<BootPipelineState> {
  return pipelineState;
}

function dependencyBlocked(stage: BootStageId): string | null {
  if (!PROGRESSIVE_BOOT_CONFIG.respectDependencies) return null;

  const def = STAGE_REGISTRY[stage];
  for (const dep of def.dependsOn) {
    if (pipelineState.failed.includes(dep)) {
      return `dependency "${dep}" failed`;
    }
    if (pipelineState.skipped.includes(dep) && STAGE_REGISTRY[dep].critical) {
      return `critical dependency "${dep}" was skipped`;
    }
    if (
      DEBUG_CONFIG.enabled &&
      !DEBUG_STAGES[dep] &&
      STAGE_REGISTRY[dep].critical
    ) {
      return `critical dependency "${dep}" is disabled`;
    }
  }
  return null;
}

function recordStageOutcome(stage: BootStageId, result: StageResult, skipped = false): void {
  if (skipped) {
    if (!pipelineState.skipped.includes(stage)) pipelineState.skipped.push(stage);
    return;
  }
  if (result.success) {
    pipelineState.completed.push(stage);
  } else {
    pipelineState.failed.push(stage);
  }
}

function haltPipeline(stage: BootStageId, error: string): never {
  pipelineState.halted = true;
  pipelineState.haltStage = stage;
  pipelineState.haltError = error;

  printBootSummary(true);

  const message = `[Boot] HALTED at stage "${stage}": ${error}`;
  console.error(`%c${message}`, 'color: #f87171; font-weight: bold; font-size: 13px');

  showDebugError(stage, new Error(error));
  throw new Error(message);
}

/**
 * Run a single boot stage through the progressive pipeline.
 * Replaces direct StageLoader.loadStage calls in main.ts.
 */
export async function runBootStage(
  stage: BootStageId,
  initFn: () => Promise<void> | void
): Promise<StageResult> {
  if (pipelineState.halted) {
    const skipResult: StageResult = { success: false, duration: 0, error: 'pipeline already halted' };
    updateStageStatus(stage, StageStatus.SKIPPED, 0, skipResult.error);
    recordStageOutcome(stage, skipResult, true);
    return skipResult;
  }

  const blocked = dependencyBlocked(stage);
  if (blocked) {
    console.log(
      `%c[${stage}] ⏭️  SKIPPED (${blocked})`,
      'color: gray; font-weight: bold'
    );
    updateStageStatus(stage, StageStatus.SKIPPED, 0, blocked);
    recordStageOutcome(stage, { success: true, duration: 0 }, true);
    return { success: true, duration: 0 };
  }

  const result = await StageLoader.loadStage(stage, initFn);
  recordStageOutcome(stage, result);

  if (PROGRESSIVE_BOOT_CONFIG.verbose) {
    logStageProgress(stage, result);
  }

  if (!result.success) {
    const critical = STAGE_REGISTRY[stage].critical;
    if (PROGRESSIVE_BOOT_CONFIG.haltOnFailure && critical) {
      haltPipeline(stage, result.error ?? 'unknown error');
    } else if (PROGRESSIVE_BOOT_CONFIG.haltOnFailure) {
      console.warn(
        `%c[Boot] Non-critical stage "${stage}" failed — continuing. Re-enable after fix.`,
        'color: #fbbf24; font-weight: bold',
        result.error
      );
    }
  }

  return result;
}

function logStageProgress(stage: BootStageId, result: StageResult): void {
  const def = STAGE_REGISTRY[stage];
  const index = getOrderedStageIds().indexOf(stage) + 1;
  const total = getOrderedStageIds().length;
  const status = result.success ? 'ok' : 'FAIL';
  console.log(
    `%c[Boot ${index}/${total}] ${stage} (${def.label}) → ${status}`,
    `color: ${result.success ? '#86efac' : '#f87171'}`
  );
}

/**
 * Print a grouped summary of all stages — call at end of boot or on halt.
 */
export function printBootSummary(force = false): void {
  if (!PROGRESSIVE_BOOT_CONFIG.verbose && !force) return;

  const ordered = getOrderedStageIds();
  console.group(
    pipelineState.halted
      ? `%c🛑 Boot Halted${pipelineState.haltStage ? ` @ ${pipelineState.haltStage}` : ''}`
      : '%c✅ Boot Pipeline Summary',
    `color: ${pipelineState.halted ? '#f87171' : '#86efac'}; font-weight: bold`
  );

  for (const stage of ordered) {
    const def = STAGE_REGISTRY[stage];
    let icon = '⏸️';
    if (pipelineState.completed.includes(stage)) icon = '✓';
    else if (pipelineState.failed.includes(stage)) icon = '✗';
    else if (pipelineState.skipped.includes(stage)) icon = '⏭️';

    const enabled = !DEBUG_CONFIG.enabled || DEBUG_STAGES[stage];
    console.log(
      `  ${icon} ${stage.padEnd(18)} ${enabled ? '' : '(disabled) '}${def.label}`
    );
  }

  if (pipelineState.halted && pipelineState.haltError) {
    console.error('  Reason:', pipelineState.haltError);
    console.log(
      '%c  Next: fix the error above, or disable the stage via ?debug=1 panel and reload',
      'color: #94a3b8'
    );
  } else if (DEBUG_CONFIG.enabled) {
    const nextDisabled = ordered.find(
      (s) => !DEBUG_STAGES[s] && !pipelineState.skipped.includes(s)
    );
    if (nextDisabled) {
      console.log(
        `%c  Next stage to enable: ${nextDisabled} (${STAGE_REGISTRY[nextDisabled].label})`,
        'color: #7dd3fc'
      );
    }
  }

  console.groupEnd();
}

/** Expose on window for console debugging */
export function installBootDebugHooks(): void {
  if (typeof window === 'undefined') return;
  (window as any).__bootPipeline = {
    state: () => getBootPipelineState(),
    summary: () => printBootSummary(true),
    preset: (id: BootPresetId) => {
      applyBootPreset(id);
      console.log('[Boot] Preset applied — reload to take effect');
    },
    stages: () => ({ ...DEBUG_STAGES }),
  };
}

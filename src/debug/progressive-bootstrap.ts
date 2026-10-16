// src/debug/progressive-bootstrap.ts
// Progressive boot orchestrator: ordered stages, dependency checks, halt-on-failure.
// See docs/PROGRESSIVE_BOOT.md for the URL switches and presets.

/* eslint-disable no-console -- the per-stage trace and boot summary are this module's output */

import {
    BOOT_PRESETS,
    STAGE_REGISTRY,
    getOrderedStageIds,
    parseBootPreset,
    type BootPresetId,
    type BootStageId,
} from './boot-registry.ts';
import {
    DEBUG_CONFIG,
    DEBUG_STAGES,
    StageLoader,
    StageStatus,
    isStageGatingActive,
    setStageGating,
    showDebugError,
    updateStageStatus,
    type StageResult,
} from './stages.ts';

export interface ProgressiveBootConfig {
    /** When true, critical stage failures stop the pipeline and surface an error */
    haltOnFailure: boolean;
    /** When true, skip stages whose dependencies failed or were skipped */
    respectDependencies: boolean;
    /** Verbose grouped console summary after each stage */
    verbose: boolean;
    /** Active preset name (if any) */
    preset: BootPresetId | null;
    /** Stage forced to fail (?bootfail=<stage>) to exercise the halt path */
    injectFailure: BootStageId | null;
}

export interface BootPipelineState {
    halted: boolean;
    haltStage?: BootStageId;
    haltError?: string;
    completed: BootStageId[];
    failed: BootStageId[];
    skipped: BootStageId[];
}

/** Thrown by `runBootStage` when a critical stage fails while halting is on. */
export class BootHaltError extends Error {
    readonly stage: BootStageId;
    /** What the failed stage actually threw. */
    readonly cause: unknown;

    constructor(stage: BootStageId, message: string, cause?: unknown) {
        super(message);
        this.name = 'BootHaltError';
        this.stage = stage;
        this.cause = cause;
    }
}

const pipelineState: BootPipelineState = {
    halted: false,
    completed: [],
    failed: [],
    skipped: [],
};

/** Filled by `initProgressiveBoot()`; defaults leave boot exactly as it is without these switches. */
export const PROGRESSIVE_BOOT_CONFIG: ProgressiveBootConfig = {
    haltOnFailure: false,
    respectDependencies: false,
    verbose: false,
    preset: null,
    injectFailure: null,
};

const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

/** `?halt` and `?halt=1` are on; `?halt=0|false|off|no` and an absent param are off. */
function flagOn(params: URLSearchParams, key: string): boolean {
    const value = params.get(key);
    return value !== null && !OFF_VALUES.has(value.toLowerCase());
}

function readBootConfig(search: string): ProgressiveBootConfig {
    const params = new URLSearchParams(search);
    const staged = DEBUG_CONFIG.enabled || flagOn(params, 'halt');

    let injectFailure: BootStageId | null = null;
    const failParam = params.get('bootfail');
    if (failParam) {
        if (Object.prototype.hasOwnProperty.call(STAGE_REGISTRY, failParam)) {
            injectFailure = failParam as BootStageId;
        } else {
            console.warn(`[Boot] ?bootfail=${failParam} is not a stage — ignoring`);
        }
    }

    return {
        haltOnFailure: staged,
        respectDependencies: staged,
        verbose: staged || params.has('boot'),
        preset: parseBootPreset(search),
        injectFailure,
    };
}

/**
 * Apply a boot preset to DEBUG_STAGES. Stage flags only take effect while
 * staging is active (see `isStageGatingActive`).
 */
export function applyBootPreset(presetId: BootPresetId): void {
    const preset = BOOT_PRESETS[presetId];
    if (!preset) return;

    Object.assign(DEBUG_STAGES, preset);

    console.log(`%c[Boot] Applied preset "${presetId}"`, 'color: #7dd3fc; font-weight: bold');
}

/**
 * Initialize progressive boot from URL params. Call once, before any stage runs.
 * - ?halt=1                  → halt on critical failures, skip dependents of failures
 * - ?boot=<preset>           → apply a stage preset (implies stage gating)
 * - ?debug=1[&boot=<preset>] → debug panel; halts too, preset defaults to `limited`
 * - ?bootfail=<stage>        → force that stage to throw (needs one of the above)
 */
export function initProgressiveBoot(
    search: string = typeof window !== 'undefined' ? window.location.search : ''
): ProgressiveBootConfig {
    resetBootPipeline();

    const config = readBootConfig(search);
    Object.assign(PROGRESSIVE_BOOT_CONFIG, config);
    setStageGating(config.preset !== null);

    if (config.preset) {
        applyBootPreset(config.preset);
    } else if (DEBUG_CONFIG.enabled) {
        // Debug mode without an explicit preset starts from the limited sandbox.
        applyBootPreset('limited');
    }

    if (config.verbose) {
        console.log('%c[Boot] Progressive startup active', 'color: #7dd3fc; font-weight: bold', {
            haltOnFailure: config.haltOnFailure,
            respectDependencies: config.respectDependencies,
            preset: config.preset ?? (DEBUG_CONFIG.enabled ? 'limited' : 'production'),
        });
        console.log(
            '%c[Boot] Enable stages incrementally: ?boot=scene → sandbox → standard → full',
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
        if (isStageGatingActive() && !DEBUG_STAGES[dep] && STAGE_REGISTRY[dep].critical) {
            return `critical dependency "${dep}" is disabled`;
        }
    }
    return null;
}

function recordStageOutcome(stage: BootStageId, result: StageResult): void {
    const bucket = result.skipped
        ? pipelineState.skipped
        : result.success
          ? pipelineState.completed
          : pipelineState.failed;
    if (!bucket.includes(stage)) bucket.push(stage);
}

function haltPipeline(stage: BootStageId, error: string, cause: unknown): never {
    pipelineState.halted = true;
    pipelineState.haltStage = stage;
    pipelineState.haltError = error;

    printBootSummary(true);

    const message = `[Boot] HALTED at stage "${stage}": ${error}`;
    console.error(`%c${message}`, 'color: #f87171; font-weight: bold; font-size: 13px');

    throw new BootHaltError(stage, message, cause);
}

/**
 * Show the halt on screen, naming the stage. Skipped when the WebGPU fatal
 * screen is already up: it explains the fault in far more detail.
 */
export function reportBootHalt(err: BootHaltError): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('webgpu-fatal')) return;
    showDebugError(err.stage, err.cause ?? err);
}

/**
 * Run a single boot stage through the progressive pipeline.
 *
 * Without ?halt / ?debug / ?boot this is `StageLoader.loadStage` plus
 * bookkeeping: failures are returned, never thrown, and nothing is skipped.
 */
export async function runBootStage(
    stage: BootStageId,
    initFn: () => Promise<void> | void
): Promise<StageResult> {
    if (pipelineState.halted) {
        const result: StageResult = {
            success: false,
            skipped: true,
            duration: 0,
            error: 'pipeline already halted',
        };
        updateStageStatus(stage, StageStatus.SKIPPED, 0, result.error);
        recordStageOutcome(stage, result);
        return result;
    }

    const blocked = dependencyBlocked(stage);
    if (blocked) {
        console.log(`%c[${stage}] ⏭️  SKIPPED (${blocked})`, 'color: gray; font-weight: bold');
        const result: StageResult = { success: false, skipped: true, duration: 0, error: blocked };
        updateStageStatus(stage, StageStatus.SKIPPED, 0, blocked);
        recordStageOutcome(stage, result);
        return result;
    }

    const inject =
        PROGRESSIVE_BOOT_CONFIG.verbose && PROGRESSIVE_BOOT_CONFIG.injectFailure === stage;
    const result = await StageLoader.loadStage(stage, () => {
        if (inject) throw new Error(`injected failure (?bootfail=${stage})`);
        return initFn();
    });
    recordStageOutcome(stage, result);

    if (PROGRESSIVE_BOOT_CONFIG.verbose) {
        logStageProgress(stage, result);
    }

    if (!result.success) {
        const critical = STAGE_REGISTRY[stage].critical;
        if (PROGRESSIVE_BOOT_CONFIG.haltOnFailure && critical) {
            haltPipeline(stage, result.error ?? 'unknown error', result.cause);
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
    const ordered = getOrderedStageIds();
    const index = ordered.indexOf(stage) + 1;
    const status = result.skipped ? 'skipped' : result.success ? 'ok' : 'FAIL';
    console.log(
        `%c[Boot ${index}/${ordered.length}] ${stage} (${def.label}) → ${status}`,
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

        const enabled = !isStageGatingActive() || DEBUG_STAGES[stage];
        console.log(`  ${icon} ${stage.padEnd(18)} ${enabled ? '' : '(disabled) '}${def.label}`);
    }

    if (pipelineState.halted && pipelineState.haltError) {
        console.error('  Reason:', pipelineState.haltError);
        console.log(
            '%c  Next: fix the error above, or disable the stage via ?debug=1 panel and reload',
            'color: #94a3b8'
        );
    } else if (isStageGatingActive()) {
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

interface BootPipelineHooks {
    state: () => Readonly<BootPipelineState>;
    summary: () => void;
    /** Applies to stages that have not run yet; presets are also read from ?boot= at load. */
    preset: (id: BootPresetId) => void;
    stages: () => Record<BootStageId, boolean>;
}

/** Expose on window for console debugging */
export function installBootDebugHooks(): void {
    if (typeof window === 'undefined') return;
    const hooks: BootPipelineHooks = {
        state: () => getBootPipelineState(),
        summary: () => printBootSummary(true),
        preset: (id) => {
            applyBootPreset(id);
            setStageGating(true);
        },
        stages: () => ({ ...DEBUG_STAGES }),
    };
    (window as Window & { __bootPipeline?: BootPipelineHooks }).__bootPipeline = hooks;
}

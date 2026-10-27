/**
 * Dynamic resolution for the post-FX scene pass.
 *
 * The GPU frame timer (`gpu-frame-timer.ts`) reports the GPU time of a frame
 * every 30 frames. This keeps that time inside a budget by scaling the scene
 * pass (`PassNode.setResolutionScale`) between {@link DEFAULT_MIN_SCALE} and 1;
 * the post graph upscales the result (FSR 1, or TAA-U with TRAA). The cap set
 * by the tier's pixel ratio is never exceeded: 1 means "the drawing buffer".
 *
 * Hysteresis, so a single spike or a quiet moment does not make the image
 * pump: the scale drops only after {@link DynamicResolutionConfig.dropAfter}
 * samples in a row over budget (by the amount the pixel count says it should,
 * since GPU cost tracks pixels, i.e. scale²), and rises one step only after
 * {@link DynamicResolutionConfig.raiseAfter} samples in a row well under it.
 *
 * Leaf module (no imports): it lives in the `render-runtime` chunk.
 */

export const DEFAULT_MIN_SCALE = 0.6;

export interface DynamicResolutionConfig {
    minScale: number;
    maxScale: number;
    /** GPU ms per frame the controller aims to stay under. */
    budgetMs: number;
    /** Over `budgetMs × dropRatio` counts as over budget. */
    dropRatio: number;
    /** Under `budgetMs × raiseRatio` counts as headroom. */
    raiseRatio: number;
    /** Consecutive over-budget samples before the scale drops (~0.5 s each). */
    dropAfter: number;
    /** Consecutive headroom samples before the scale rises one step. */
    raiseAfter: number;
    /** Scale granularity; every scale the controller picks is a multiple. */
    step: number;
    /** Largest single drop, so one bad sample cannot crater the image. */
    maxDrop: number;
}

/** 60 FPS with headroom for the CPU half of the frame. */
export function defaultDynamicResolutionConfig(
    overrides: Partial<DynamicResolutionConfig> = {}
): DynamicResolutionConfig {
    return {
        minScale: DEFAULT_MIN_SCALE,
        maxScale: 1,
        budgetMs: 14,
        dropRatio: 1,
        raiseRatio: 0.7,
        dropAfter: 2,
        raiseAfter: 6,
        step: 0.05,
        maxDrop: 0.15,
        ...overrides,
    };
}

export interface DynamicResolutionState {
    scale: number;
    overCount: number;
    underCount: number;
}

function quantize(scale: number, cfg: DynamicResolutionConfig): number {
    const q = Math.round(scale / cfg.step) * cfg.step;
    return Math.min(cfg.maxScale, Math.max(cfg.minScale, Number(q.toFixed(4))));
}

/** Pure: the state after one GPU-time sample. */
export function stepDynamicResolution(
    state: Readonly<DynamicResolutionState>,
    gpuMs: number,
    cfg: DynamicResolutionConfig
): DynamicResolutionState {
    if (!Number.isFinite(gpuMs) || gpuMs <= 0) return { ...state };

    if (gpuMs > cfg.budgetMs * cfg.dropRatio) {
        const overCount = state.overCount + 1;
        if (overCount < cfg.dropAfter || state.scale <= cfg.minScale) {
            return { scale: state.scale, overCount, underCount: 0 };
        }
        // Pixels scale with scale², and GPU time roughly with pixels.
        const target = state.scale * Math.sqrt(cfg.budgetMs / gpuMs);
        const dropped = Math.max(
            state.scale - cfg.maxDrop,
            Math.min(state.scale - cfg.step, target)
        );
        return { scale: quantize(dropped, cfg), overCount: 0, underCount: 0 };
    }

    if (gpuMs < cfg.budgetMs * cfg.raiseRatio) {
        const underCount = state.underCount + 1;
        if (underCount < cfg.raiseAfter || state.scale >= cfg.maxScale) {
            return { scale: state.scale, overCount: 0, underCount };
        }
        return { scale: quantize(state.scale + cfg.step, cfg), overCount: 0, underCount: 0 };
    }

    // Inside the band: hold, and forget any streak.
    return { scale: state.scale, overCount: 0, underCount: 0 };
}

export interface DynamicResolution {
    /** Feed one GPU frame time (ms). Calls `apply` when the scale changes. */
    sample(gpuMs: number): void;
    readonly scale: number;
    readonly lastGpuMs: number | null;
    readonly config: Readonly<DynamicResolutionConfig>;
}

export function createDynamicResolution(
    apply: (scale: number) => void,
    config: DynamicResolutionConfig = defaultDynamicResolutionConfig()
): DynamicResolution {
    let state: DynamicResolutionState = { scale: config.maxScale, overCount: 0, underCount: 0 };
    let lastGpuMs: number | null = null;
    return {
        sample(gpuMs) {
            lastGpuMs = gpuMs;
            const next = stepDynamicResolution(state, gpuMs, config);
            const changed = next.scale !== state.scale;
            state = next;
            if (changed) apply(state.scale);
        },
        get scale() {
            return state.scale;
        },
        get lastGpuMs() {
            return lastGpuMs;
        },
        config,
    };
}

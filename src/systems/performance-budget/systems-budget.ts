/**
 * @file systems-budget.ts
 * @brief Per-system performance budgets, cap enforcement, and telemetry.
 *
 * The batcher budgets (`docs/PERF_BUDGETS.md`, `npm run budget:batchers`) only
 * cover foliage instancing. Everything that landed after it — cascaded shadows,
 * clustered lights, irradiance GI, post-FX, GPU particles, dynamic rigid bodies
 * and fauna — needs its own numbers, its own overlay lines, and a cap that is
 * actually *enforced* rather than merely logged.
 *
 * Three responsibilities live here:
 *
 * 1. `SYSTEM_BUDGETS` — the single table of frame-time / VRAM / count budgets.
 * 2. `enforceCap()` — clamps a requested count to its cap and records the
 *    overflow once. Callers must honour the returned value; that is what makes
 *    the cap enforced instead of advisory.
 * 3. A telemetry registry so the `?debug=1` overlay can read live counts
 *    without this module importing THREE or any GPU-side code — which is also
 *    what keeps it unit-testable in a headless CI process.
 *
 * **Frame-time budgets are authoritative on real GPUs only.** CI runs on
 * SwiftShader and cannot hit them; headless runs assert that marks exist and
 * that caps are enforced logically, never that a frame fits in 16.7 ms.
 */

import { MAX_DYNAMIC_BODIES } from '../physics/rigid-body-types.ts';

/** Systems that carry an independent budget. */
export type SystemBudgetId =
    | 'shadows'
    | 'clusteredLights'
    | 'gi'
    | 'postfx'
    | 'particles'
    | 'rigidBodies'
    | 'fauna';

export interface SystemBudget {
    /** Human label for the overlay and the docs table. */
    label: string;
    /**
     * Per-frame CPU+GPU cost target in ms on a mid-range discrete GPU at 1080p.
     * The seven budgets sum to well under 16.67 ms; the rest is scene draw.
     */
    frameMs: number;
    /** Steady-state VRAM allowance in MB. 0 when the system owns no GPU memory. */
    vramMb: number;
    /**
     * Hard counts. Exceeding one of these is a *rejection*, not a warning —
     * see `enforceCap`.
     */
    caps: Readonly<Record<string, number>>;
    /** Whether the system is expected to be switched off on `low` / in CI. */
    skipOnLow: boolean;
}

/**
 * Starter numbers. Each is a ceiling to design against, not a measurement;
 * feature PRs are expected to replace them with profiled values and to update
 * the table in `docs/PERF_BUDGETS.md` in the same change.
 */
export const SYSTEM_BUDGETS: Readonly<Record<SystemBudgetId, SystemBudget>> = {
    shadows: {
        label: 'Shadows (CSM)',
        frameMs: 3.0,
        vramMb: 48,
        caps: { cascades: 4, localShadowLights: 2 },
        skipOnLow: true,
    },
    clusteredLights: {
        label: 'Clustered lights',
        frameMs: 1.5,
        vramMb: 8,
        caps: { lights: 128, lightsPerCluster: 32 },
        skipOnLow: true,
    },
    gi: {
        label: 'Irradiance GI',
        frameMs: 1.0,
        vramMb: 12,
        caps: { probes: 4096, probesPerFrame: 32 },
        skipOnLow: true,
    },
    postfx: {
        label: 'Post-FX stack',
        frameMs: 2.5,
        vramMb: 64,
        caps: { passes: 6 },
        skipOnLow: true,
    },
    particles: {
        label: 'Particles',
        frameMs: 2.0,
        vramMb: 32,
        caps: { totalParticles: 65536, emitters: 32 },
        skipOnLow: false,
    },
    rigidBodies: {
        label: 'Rigid bodies',
        frameMs: 1.0,
        vramMb: 0,
        // Body-body collision is an O(n²) sweep, so this cap is load-bearing;
        // it is the WASM pool size itself, not a copy of it.
        caps: { bodies: MAX_DYNAMIC_BODIES },
        skipOnLow: false,
    },
    fauna: {
        label: 'Fauna',
        frameMs: 1.5,
        vramMb: 6,
        caps: { instances: 96, perSpecies: 40 },
        skipOnLow: false,
    },
};

/** A cap that was hit. Kept per (system, cap) — first occurrence wins. */
export interface BudgetCapViolation {
    system: SystemBudgetId;
    cap: string;
    limit: number;
    /** Largest amount ever requested for this cap. */
    peakRequested: number;
    /** How many times the cap has rejected work. */
    hits: number;
    /** `performance.now()` of the first rejection. */
    firstSeen: number;
}

const _violations = new Map<string, BudgetCapViolation>();

function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function key(system: SystemBudgetId, cap: string): string {
    return `${system}.${cap}`;
}

/** The configured limit for a cap, or `Infinity` when the cap is unknown. */
export function getCap(system: SystemBudgetId, cap: string): number {
    const limit = SYSTEM_BUDGETS[system]?.caps[cap];
    return typeof limit === 'number' ? limit : Infinity;
}

/**
 * Clamp `requested` to the system's cap, recording (and warning about) the
 * overflow the first time it happens.
 *
 * Callers **must** use the return value — a cap that is logged but not applied
 * is not a budget. Returns the number of units the caller may actually use.
 */
export function enforceCap(system: SystemBudgetId, cap: string, requested: number): number {
    const limit = getCap(system, cap);
    if (!(requested > limit)) return requested;

    const k = key(system, cap);
    const existing = _violations.get(k);
    if (existing) {
        existing.hits += 1;
        existing.peakRequested = Math.max(existing.peakRequested, requested);
    } else {
        _violations.set(k, {
            system,
            cap,
            limit,
            peakRequested: requested,
            hits: 1,
            firstSeen: now(),
        });
        // Once per cap per session: the rejection itself is the enforcement,
        // the log just tells you which knob to look at.
        console.warn(
            `[PerfBudget] ${SYSTEM_BUDGETS[system].label}: ${cap} capped at ${limit} ` +
                `(requested ${requested}). Excess work is rejected, not queued.`
        );
    }
    return limit;
}

/**
 * Record a rejection a subsystem made under its *own* (possibly tighter) limit
 * — the local shadow-slot pool, a device-tier clamp — so it surfaces in the
 * overlay alongside the caps enforced here. `limitApplied` is the limit that
 * actually did the rejecting, which may be below the table's ceiling.
 */
export function recordCapRejection(
    system: SystemBudgetId,
    cap: string,
    requested: number,
    limitApplied: number
): void {
    const k = key(system, cap);
    const existing = _violations.get(k);
    if (existing) {
        existing.hits += 1;
        existing.peakRequested = Math.max(existing.peakRequested, requested);
        return;
    }
    _violations.set(k, {
        system,
        cap,
        limit: limitApplied,
        peakRequested: requested,
        hits: 1,
        firstSeen: now(),
    });
    console.warn(
        `[PerfBudget] ${SYSTEM_BUDGETS[system].label}: ${cap} limited to ${limitApplied} ` +
            `(requested ${requested}).`
    );
}

/** True when the request fits; records the overflow otherwise. Sugar over `enforceCap`. */
export function withinCap(system: SystemBudgetId, cap: string, requested: number): boolean {
    return enforceCap(system, cap, requested) === requested;
}

/** Every cap that has rejected work this session. */
export function getBudgetCapViolations(): BudgetCapViolation[] {
    return [..._violations.values()];
}

/** Test hook — clears recorded violations and registered telemetry providers. */
export function __resetSystemBudgetsForTests(): void {
    _violations.clear();
    _providers.clear();
}

// ---------------------------------------------------------------------------
// Telemetry registry
// ---------------------------------------------------------------------------

/** One overlay row. `counts` are rendered against the system's caps. */
export interface SystemTelemetry {
    /** False when the system is off (low tier, CI, feature flag) — still shown. */
    enabled: boolean;
    /** Why it is off, when it is. */
    reason?: string;
    /** Live counts keyed by cap name where one exists. */
    counts?: Record<string, number>;
    /** Last measured cost in ms, when the system self-reports one. */
    frameMs?: number;
    /** Estimated GPU memory in MB. */
    vramMb?: number;
}

export type SystemTelemetryProvider = () => SystemTelemetry;

const _providers = new Map<SystemBudgetId, SystemTelemetryProvider>();

/**
 * Register a live-stats source. Systems call this at init so the overlay never
 * has to import them — a module that is never loaded simply has no row.
 */
export function registerSystemTelemetry(
    system: SystemBudgetId,
    provider: SystemTelemetryProvider
): void {
    _providers.set(system, provider);
}

export interface SystemBudgetRow {
    system: SystemBudgetId;
    budget: SystemBudget;
    telemetry: SystemTelemetry | null;
    /** Cap names whose live count is at or over the cap. */
    overCaps: string[];
    /** True when a self-reported frame cost exceeds the budget. */
    overFrameMs: boolean;
}

/** Snapshot every registered system against its budget. Cheap enough for 4 Hz. */
export function collectSystemsBudget(): SystemBudgetRow[] {
    const rows: SystemBudgetRow[] = [];
    for (const system of Object.keys(SYSTEM_BUDGETS) as SystemBudgetId[]) {
        const budget = SYSTEM_BUDGETS[system];
        const provider = _providers.get(system);
        let telemetry: SystemTelemetry | null = null;
        if (provider) {
            try {
                telemetry = provider();
            } catch {
                telemetry = { enabled: false, reason: 'telemetry error' };
            }
        }

        const overCaps: string[] = [];
        if (telemetry?.counts) {
            for (const [cap, value] of Object.entries(telemetry.counts)) {
                const limit = budget.caps[cap];
                if (typeof limit === 'number' && value >= limit) overCaps.push(cap);
            }
        }

        rows.push({
            system,
            budget,
            telemetry,
            overCaps,
            overFrameMs:
                typeof telemetry?.frameMs === 'number' && telemetry.frameMs > budget.frameMs,
        });
    }
    return rows;
}

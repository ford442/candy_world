// src/core/scheduler/scheduler.ts
// Phase-ordered system runner with a fixed-step phase, per-system timing and
// budgets, and a per-system circuit breaker (#1973). Replaces the hand-written
// call list in game-loop.ts.
//
// Hot path is allocation-free: the resolved order is cached until a system is
// registered or removed, and the FrameContext object is reused every frame.

import { SimRng } from '../../utils/sim-rng.ts';
import { FixedStepClock } from './fixed-step.ts';
import {
    PHASES,
    type FrameContext,
    type FrameInput,
    type FrameSource,
    type Phase,
    type System,
    type SystemStats,
} from './types.ts';

/** ~half a second at 60 fps: long enough to ride out a transient (pipeline compile, lazy chunk), short enough to stop log spam. */
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 30;

/** Frames before `budgetMs` is checked: boot frames compile pipelines and fill caches. */
export const BUDGET_WARMUP_FRAMES = 120;

const EMA = 0.1;

interface Entry {
    readonly system: System;
    readonly seq: number;
    readonly maxErrors: number;
    /** `system.<id>`, built once so timing reports allocate nothing. */
    readonly markLabel: string;
    removed: boolean;
    paused: boolean;
    tripped: boolean;
    gated: boolean;
    streak: number;
    errors: number;
    lastMs: number;
    avgMs: number;
    overBudget: boolean;
    budgetWarned: boolean;
    /** Set while `fixed` substeps accumulate time for this frame. */
    frameMs: number;
}

type MutableContext = { -readonly [K in keyof FrameContext]: FrameContext[K] };

export interface SchedulerOptions {
    fixedDt?: number;
    maxSubsteps?: number;
    /** Wall clock for per-system timing. Injected by tests. */
    now?: () => number;
    /** Simulation RNG handed to systems as `ctx.rng`. Default: a fresh `SimRng`. */
    rng?: SimRng;
    /** Receives `system.<id>` and its frame cost after every update (e.g. `profiler.mark`). */
    mark?: (label: string, ms: number) => void;
}

export class SystemScheduler {
    private readonly entries = new Map<string, Entry>();
    private resolved: Entry[][] | null = null;
    private seq = 0;
    private frame = 0;
    private readonly clock: FixedStepClock;
    private readonly now: () => number;
    private readonly mark: ((label: string, ms: number) => void) | null;
    private readonly ctx = {} as MutableContext;
    private source: FrameSource | null = null;
    private sourceStreak = 0;
    private time = 0;
    private audio: FrameContext['audio'] = null;
    readonly rng: SimRng;

    constructor(opts: SchedulerOptions = {}) {
        this.clock = new FixedStepClock(opts.fixedDt, opts.maxSubsteps);
        this.now = opts.now ?? (() => performance.now());
        this.mark = opts.mark ?? null;
        this.rng = opts.rng ?? new SimRng();
    }

    get fixedDt(): number {
        return this.clock.fixedDt;
    }

    /** Fixed steps taken so far. */
    get fixedTick(): number {
        return this.clock.tick;
    }

    /** Seconds of simulation the fixed clock dropped on hitches. */
    get droppedSeconds(): number {
        return this.clock.droppedSeconds;
    }

    /** Set (or clear) what supplies `ctx.audio` and `ctx.time` each frame. */
    setFrameSource(source: FrameSource | null): void {
        this.source = source;
        this.sourceStreak = 0;
    }

    /** Add a system. Returns a function that removes (and disposes) it. */
    register(system: System): () => void {
        if (!PHASES.includes(system.phase)) {
            throw new Error(`[Scheduler] ${system.id}: unknown phase '${system.phase}'`);
        }
        if (this.entries.has(system.id)) {
            throw new Error(`[Scheduler] duplicate system id '${system.id}'`);
        }
        const entry: Entry = {
            system,
            seq: this.seq++,
            maxErrors: system.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS,
            markLabel: `system.${system.id}`,
            removed: false,
            paused: false,
            tripped: false,
            gated: false,
            streak: 0,
            errors: 0,
            lastMs: 0,
            avgMs: 0,
            overBudget: false,
            budgetWarned: false,
            frameMs: 0,
        };
        this.entries.set(system.id, entry);
        this.resolved = null;
        // Resolve now so an ordering cycle fails at the registration that made
        // it, and leaves the scheduler as it was.
        try {
            this.resolve();
        } catch (err) {
            this.entries.delete(system.id);
            this.resolved = null;
            throw err;
        }
        return () => {
            // Only remove the entry this registration made, not a later system
            // that reused the id.
            if (this.entries.get(system.id) === entry) this.unregister(system.id);
        };
    }

    unregister(id: string): void {
        const e = this.entries.get(id);
        if (!e) return;
        this.entries.delete(id);
        this.resolved = null;
        // A frame already running keeps its resolved list; this stops it there.
        e.removed = true;
        e.system.dispose?.();
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    /** Pause/resume a system. Re-enabling also resets a tripped circuit breaker. */
    setEnabled(id: string, on: boolean): void {
        const e = this.entries.get(id);
        if (!e) return;
        e.paused = !on;
        if (on) {
            e.tripped = false;
            e.streak = 0;
        }
    }

    /** `phase:id` in run order, frame source first — the snapshot test pins this. */
    getOrder(): string[] {
        const out: string[] = [];
        if (this.source) out.push(`source:${this.source.id}`);
        const phases = this.resolve();
        for (let p = 0; p < PHASES.length; p++) {
            for (const e of phases[p]) out.push(`${PHASES[p]}:${e.system.id}`);
        }
        return out;
    }

    getStats(): SystemStats[] {
        return this.resolve().flatMap((list) =>
            list.map((e) => ({
                id: e.system.id,
                phase: e.system.phase,
                paused: e.paused,
                tripped: e.tripped,
                gated: e.gated,
                errors: e.errors,
                lastMs: e.lastMs,
                avgMs: e.avgMs,
                budgetMs: e.system.budgetMs,
                overBudget: e.overBudget,
            }))
        );
    }

    /** Run every phase once (the `fixed` phase 0..maxSubsteps times). Returns the context it ran with. */
    runFrame(input: FrameInput): FrameContext {
        const phases = this.resolve();
        const ctx = this.ctx;
        this.sampleSource(input.dt);
        ctx.dt = input.dt;
        ctx.rawDt = input.rawDt;
        ctx.time = this.time;
        ctx.audio = this.audio;
        ctx.player = input.player;
        ctx.camera = input.camera;
        ctx.caps = input.caps;
        ctx.exploreActive = input.exploreActive;
        ctx.rng = this.rng;
        ctx.fixedDt = this.clock.fixedDt;
        ctx.frame = this.frame;

        const steps = this.clock.advance(input.dt);
        ctx.fixedSteps = steps;
        ctx.fixedAlpha = this.clock.alpha;

        for (let p = 0; p < PHASES.length; p++) {
            const list = phases[p];
            if (list.length === 0) continue;
            if (PHASES[p] === 'fixed') {
                for (const e of list) e.frameMs = 0;
                for (let s = 0; s < steps; s++) {
                    ctx.fixedTick = this.clock.tick++;
                    for (const e of list) this.step(e, ctx, true);
                }
                for (const e of list) this.record(e, e.frameMs);
            } else {
                ctx.fixedTick = this.clock.tick;
                for (const e of list) this.step(e, ctx, false);
            }
        }
        ctx.fixedTick = this.clock.tick;
        this.frame++;
        return ctx;
    }

    /** Remove and dispose every system. */
    dispose(): void {
        for (const id of [...this.entries.keys()]) this.unregister(id);
    }

    private sampleSource(dt: number): void {
        const src = this.source;
        if (!src) {
            this.time += dt;
            return;
        }
        try {
            const c = src.sample(dt);
            this.time = c.time;
            this.audio = c.audio;
            this.sourceStreak = 0;
        } catch (err) {
            // Keep the last analysis and let time run on; never trips — every
            // system reads what the source reports.
            this.time += dt;
            if (this.sourceStreak++ === 0) {
                console.warn(`[Scheduler] frame source '${src.id}' threw`, err);
            }
        }
    }

    private step(e: Entry, ctx: FrameContext, accumulate: boolean): void {
        if (e.paused || e.tripped || e.removed) return;
        const sys = e.system;
        const t0 = this.now();
        try {
            e.gated = sys.enabled !== undefined && !sys.enabled(ctx);
            if (!e.gated) sys.update(ctx);
            e.streak = 0;
        } catch (err) {
            e.errors++;
            e.streak++;
            if (e.streak === 1) {
                console.warn(`[Scheduler] ${sys.phase}:${sys.id} threw`, err);
            }
            if (e.streak >= e.maxErrors) {
                e.tripped = true;
                console.error(
                    `[Scheduler] ${sys.phase}:${sys.id} threw ${e.streak} frames in a row — disabled. ` +
                        `Re-enable with setEnabled('${sys.id}', true).`,
                    err
                );
            }
        }
        const ms = this.now() - t0;
        if (accumulate) e.frameMs += ms;
        else this.record(e, ms);
    }

    private record(e: Entry, ms: number): void {
        e.lastMs = ms;
        e.avgMs += (ms - e.avgMs) * EMA;
        this.mark?.(e.markLabel, ms);

        const budget = e.system.budgetMs;
        if (budget === undefined || this.frame < BUDGET_WARMUP_FRAMES) return;
        e.overBudget = e.avgMs > budget;
        if (e.overBudget && !e.budgetWarned) {
            e.budgetWarned = true;
            console.warn(
                `[Scheduler] ${e.system.phase}:${e.system.id} averages ${e.avgMs.toFixed(2)} ms, ` +
                    `over its ${budget} ms budget.`
            );
        }
    }

    private resolve(): Entry[][] {
        if (this.resolved) return this.resolved;
        const byPhase: Entry[][] = PHASES.map(() => []);
        for (const e of this.entries.values()) byPhase[PHASES.indexOf(e.system.phase)].push(e);
        this.resolved = byPhase.map((list, p) => topoSort(list, PHASES[p]));
        return this.resolved;
    }
}

/**
 * Registration order, with each system's predecessors (its `after` ids, and
 * systems naming it in `before`) pulled forward to just ahead of it. A phase
 * with no constraints therefore runs exactly in registration order, and a
 * constraint moves only the systems it names.
 * `after`/`before` across phases or to absent ids are ignored: phase order
 * already decides the former, and the latter lets optional systems be named.
 */
function topoSort(list: Entry[], phase: Phase): Entry[] {
    if (list.length < 2) return list;
    const byId = new Map(list.map((e) => [e.system.id, e]));
    const preds = new Map<Entry, Entry[]>(list.map((e) => [e, []]));
    for (const e of list) {
        for (const id of e.system.after ?? []) {
            const p = byId.get(id);
            if (p && p !== e) preds.get(e)!.push(p);
        }
        for (const id of e.system.before ?? []) {
            const n = byId.get(id);
            if (n && n !== e) preds.get(n)!.push(e);
        }
    }
    for (const ps of preds.values()) ps.sort((x, y) => x.seq - y.seq);

    const out: Entry[] = [];
    const done = new Set<Entry>();
    const onPath = new Set<Entry>();
    const visit = (e: Entry, path: Entry[]): void => {
        if (done.has(e)) return;
        if (onPath.has(e)) {
            const loop = path
                .slice(path.indexOf(e))
                .concat(e)
                .map((x) => x.system.id);
            throw new Error(`[Scheduler] ordering cycle in phase '${phase}': ${loop.join(' → ')}`);
        }
        onPath.add(e);
        path.push(e);
        for (const p of preds.get(e)!) visit(p, path);
        path.pop();
        onPath.delete(e);
        done.add(e);
        out.push(e);
    };
    for (const e of list) visit(e, []);
    return out;
}

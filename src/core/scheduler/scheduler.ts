// src/core/scheduler/scheduler.ts
// Phase-ordered system runner with a fixed-step phase and a per-system circuit
// breaker (#1973). Replaces the hand-written call list in game-loop.ts.
//
// Hot path is allocation-free: the resolved order is cached until a system is
// registered or removed, and the FrameContext object is reused every frame.

import { FixedStepClock } from './fixed-step.ts';
import {
    PHASES,
    type FrameContext,
    type FrameInput,
    type Phase,
    type System,
    type SystemStats,
} from './types.ts';

/** ~half a second at 60 fps: long enough to ride out a transient (pipeline compile, lazy chunk), short enough to stop log spam. */
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 30;

const EMA = 0.1;

interface Entry {
    readonly system: System;
    readonly seq: number;
    readonly maxErrors: number;
    paused: boolean;
    tripped: boolean;
    streak: number;
    errors: number;
    lastMs: number;
    avgMs: number;
    /** Set while `fixed` substeps accumulate time for this frame. */
    frameMs: number;
}

type MutableContext = { -readonly [K in keyof FrameContext]: FrameContext[K] };

export interface SchedulerOptions {
    fixedDt?: number;
    maxSubsteps?: number;
    /** Wall clock for per-system timing. Injected by tests. */
    now?: () => number;
}

export class SystemScheduler {
    private readonly entries = new Map<string, Entry>();
    private resolved: Entry[][] | null = null;
    private seq = 0;
    private frame = 0;
    private readonly clock: FixedStepClock;
    private readonly now: () => number;
    private readonly ctx = {} as MutableContext;

    constructor(opts: SchedulerOptions = {}) {
        this.clock = new FixedStepClock(opts.fixedDt, opts.maxSubsteps);
        this.now = opts.now ?? (() => performance.now());
    }

    get fixedDt(): number {
        return this.clock.fixedDt;
    }

    /** Add a system. Returns a function that removes (and disposes) it. */
    register(system: System): () => void {
        if (!PHASES.includes(system.phase)) {
            throw new Error(`[Scheduler] ${system.id}: unknown phase '${system.phase}'`);
        }
        if (this.entries.has(system.id)) {
            throw new Error(`[Scheduler] duplicate system id '${system.id}'`);
        }
        this.entries.set(system.id, {
            system,
            seq: this.seq++,
            maxErrors: system.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS,
            paused: false,
            tripped: false,
            streak: 0,
            errors: 0,
            lastMs: 0,
            avgMs: 0,
            frameMs: 0,
        });
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
        return () => this.unregister(system.id);
    }

    unregister(id: string): void {
        const e = this.entries.get(id);
        if (!e) return;
        this.entries.delete(id);
        this.resolved = null;
        e.system.dispose?.();
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

    /** `phase:id` in run order — the snapshot tests pin this. */
    getOrder(): string[] {
        const out: string[] = [];
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
                errors: e.errors,
                lastMs: e.lastMs,
                avgMs: e.avgMs,
            }))
        );
    }

    /** Run every phase once (the `fixed` phase 0..maxSubsteps times). Returns the context it ran with. */
    runFrame(input: FrameInput): FrameContext {
        const phases = this.resolve();
        const ctx = this.ctx;
        ctx.dt = input.dt;
        ctx.rawDt = input.rawDt;
        ctx.time = input.time;
        ctx.audio = input.audio;
        ctx.player = input.player;
        ctx.camera = input.camera;
        ctx.caps = input.caps;
        ctx.exploreActive = input.exploreActive;
        ctx.fixedDt = this.clock.fixedDt;
        ctx.frame = this.frame;

        const steps = this.clock.advance(input.dt);
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

    private step(e: Entry, ctx: FrameContext, accumulate: boolean): void {
        if (e.paused || e.tripped) return;
        const sys = e.system;
        const t0 = this.now();
        try {
            if (sys.enabled && !sys.enabled(ctx)) return;
            sys.update(ctx);
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

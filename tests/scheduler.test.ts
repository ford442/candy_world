/**
 * SystemScheduler + FixedStepClock + PlayerInterpolator (#1973).
 *
 * Headless: exercises phase order, after/before resolution, cycle rejection,
 * the circuit breaker, budgets, the frame source, fixed-step determinism and
 * the render-side camera blend with plain stub systems. The real frame's order
 * is pinned by tests/scheduler-order.test.ts, and real player physics on the
 * fixed step by tests/fixed-step-determinism.test.ts.
 *
 * Run with: npx tsx tests/scheduler.test.ts
 */

import * as THREE from 'three';
import {
    BUDGET_WARMUP_FRAMES,
    FixedStepClock,
    SystemScheduler,
    type FrameContext,
    type FrameInput,
    type System,
} from '../src/core/scheduler/index.ts';
import { PlayerInterpolator } from '../src/systems/physics/player-interpolation.ts';
import { SimRng } from '../src/utils/sim-rng.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const input = (dt = 1 / 60): FrameInput =>
    ({
        dt,
        rawDt: dt,
        player: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
        camera: {},
        caps: {},
        exploreActive: false,
    }) as unknown as FrameInput;

const sys = (
    id: string,
    phase: System['phase'],
    log: string[],
    extra: Partial<System> = {}
): System => ({
    id,
    phase,
    update: () => void log.push(id),
    ...extra,
});

/** Silence console.warn/error for a block; returns the call counts. */
function quiet<T>(fn: (counts: { warn: number; error: number }) => T): T {
    const warn = console.warn;
    const error = console.error;
    const counts = { warn: 0, error: 0 };
    console.warn = () => void counts.warn++;
    console.error = () => void counts.error++;
    try {
        return fn(counts);
    } finally {
        console.warn = warn;
        console.error = error;
    }
}

// ---------------------------------------------------------------------------
console.log('\nPhase order');
// ---------------------------------------------------------------------------
{
    const log: string[] = [];
    const s = new SystemScheduler();
    // Registered out of phase order on purpose.
    s.register(sys('ui1', 'ui', log));
    s.register(sys('render', 'postfx', log));
    s.register(sys('anim', 'animate', log));
    s.register(sys('in', 'input', log));
    s.register(sys('fix', 'fixed', log));
    s.register(sys('sim', 'simulate', log));
    s.register(sys('aud', 'audio', log));
    s.register(sys('prep', 'render-prep', log));
    s.runFrame(input());
    check(
        'phases run in PHASES order',
        log.join() === 'in,fix,sim,anim,aud,prep,render,ui1',
        log.join()
    );
    check(
        'getOrder() reports phase:id',
        s.getOrder()[0] === 'input:in' && s.getOrder().at(-1) === 'ui:ui1'
    );
}

// ---------------------------------------------------------------------------
console.log('\nWithin-phase ordering');
// ---------------------------------------------------------------------------
{
    const log: string[] = [];
    const s = new SystemScheduler();
    s.register(sys('a', 'simulate', log));
    s.register(sys('b', 'simulate', log));
    s.register(sys('c', 'simulate', log));
    s.runFrame(input());
    check('no constraints → registration order', log.join() === 'a,b,c', log.join());

    log.length = 0;
    s.register(sys('d', 'simulate', log, { before: ['a'] }));
    s.register(sys('e', 'simulate', log, { after: ['c', 'missing-optional-system'] }));
    s.register(sys('f', 'simulate', log, { after: ['b'], before: ['c'] }));
    s.runFrame(input());
    check('before/after honoured, absent ids ignored', log.join() === 'd,a,b,f,c,e', log.join());

    let threw = '';
    try {
        s.register(sys('g', 'simulate', log, { after: ['h'] }));
        s.register(sys('h', 'simulate', log, { after: ['g'] }));
    } catch (err) {
        threw = String(err);
    }
    check('ordering cycle throws at registration', threw.includes('ordering cycle'), threw);
    check('rejected system is not left registered', !s.getOrder().includes('simulate:h'));
    log.length = 0;
    s.runFrame(input());
    check(
        'scheduler still runs after a rejected registration',
        log.join() === 'd,a,b,f,c,e,g',
        log.join()
    );

    let dup = '';
    try {
        s.register(sys('a', 'animate', log));
    } catch (err) {
        dup = String(err);
    }
    check('duplicate id throws', dup.includes('duplicate'), dup);

    let bad = '';
    try {
        s.register(sys('z', 'nope' as System['phase'], log));
    } catch (err) {
        bad = String(err);
    }
    check('unknown phase throws', bad.includes('unknown phase'), bad);

    let disposed = false;
    const off = s.register(sys('tmp', 'ui', log, { dispose: () => void (disposed = true) }));
    off();
    check('unregister removes and disposes', disposed && !s.getOrder().includes('ui:tmp'));
    const again = s.register(sys('tmp', 'ui', log));
    off();
    check('a stale unregister does not remove a re-registered id', s.has('tmp'));
    again();
}

// ---------------------------------------------------------------------------
console.log('\nRegistration during a frame');
// ---------------------------------------------------------------------------
{
    const log: string[] = [];
    const s = new SystemScheduler();
    let offLater: (() => void) | null = null;
    s.register(
        sys('remover', 'simulate', log, {
            update: () => {
                log.push('remover');
                offLater?.();
            },
        })
    );
    offLater = s.register(sys('victim', 'simulate', log));
    s.register(
        sys('adder', 'animate', log, {
            update: () => {
                log.push('adder');
                if (!s.has('late')) s.register(sys('late', 'animate', log));
            },
        })
    );
    s.runFrame(input());
    check(
        'a system removed mid-frame does not run later that frame',
        log.join() === 'remover,adder',
        log.join()
    );
    log.length = 0;
    s.runFrame(input());
    check(
        'a system added mid-frame runs from the next frame',
        log.join() === 'remover,adder,late',
        log.join()
    );
}

// ---------------------------------------------------------------------------
console.log('\nGating and circuit breaker');
// ---------------------------------------------------------------------------
quiet((counts) => {
    const log: string[] = [];
    const s = new SystemScheduler();
    let gate = false;
    s.register(sys('gated', 'animate', log, { enabled: () => gate }));
    let throws = 0;
    s.register({
        id: 'flaky',
        phase: 'animate',
        maxConsecutiveErrors: 3,
        update: () => {
            throws++;
            throw new Error('boom');
        },
    });
    s.register(sys('after-flaky', 'animate', log));

    s.runFrame(input());
    check('enabled() false skips update', !log.includes('gated'));
    check('stats report the gate', s.getStats().find((x) => x.id === 'gated')!.gated);
    gate = true;
    s.runFrame(input());
    check('enabled() true runs update', log.includes('gated'));
    check(
        'a throwing system does not stop the rest of the frame',
        log.filter((x) => x === 'after-flaky').length === 2
    );

    s.runFrame(input());
    s.runFrame(input());
    s.runFrame(input());
    const flaky = s.getStats().find((x) => x.id === 'flaky')!;
    check('trips after maxConsecutiveErrors', flaky.tripped && throws === 3, `throws=${throws}`);
    check(
        'warns once per streak, errors once on trip',
        counts.warn === 1 && counts.error === 1,
        `warn=${counts.warn} error=${counts.error}`
    );

    s.setEnabled('flaky', true);
    s.runFrame(input());
    check(
        'setEnabled(true) re-arms a tripped system',
        throws === 4 && !s.getStats().find((x) => x.id === 'flaky')!.tripped
    );

    s.setEnabled('gated', false);
    log.length = 0;
    s.runFrame(input());
    check(
        'setEnabled(false) pauses',
        !log.includes('gated') && s.getStats().find((x) => x.id === 'gated')!.paused
    );

    // A success in between resets the streak.
    const s2 = new SystemScheduler();
    let n = 0;
    s2.register({
        id: 'alt',
        phase: 'simulate',
        maxConsecutiveErrors: 2,
        update: () => {
            if (n++ % 2 === 0) throw new Error('odd');
        },
    });
    for (let i = 0; i < 10; i++) s2.runFrame(input());
    const alt = s2.getStats()[0];
    check(
        'non-consecutive errors never trip',
        !alt.tripped && alt.errors === 5,
        JSON.stringify(alt)
    );

    // Infinity never trips, and still warns only once per streak.
    const s3 = new SystemScheduler();
    counts.warn = 0;
    s3.register({
        id: 'essential',
        phase: 'postfx',
        maxConsecutiveErrors: Infinity,
        update: () => {
            throw new Error('lost device');
        },
    });
    for (let i = 0; i < 100; i++) s3.runFrame(input());
    check(
        'maxConsecutiveErrors: Infinity never trips, warns once',
        !s3.getStats()[0].tripped && counts.warn === 1,
        `warn=${counts.warn}`
    );
});

// ---------------------------------------------------------------------------
console.log('\nTiming and budgets');
// ---------------------------------------------------------------------------
quiet((counts) => {
    let clock = 0;
    const marks = new Map<string, number>();
    const s = new SystemScheduler({ now: () => clock, mark: (l, ms) => marks.set(l, ms) });
    s.register({ id: 'slow', phase: 'animate', budgetMs: 1, update: () => void (clock += 3) });
    s.register({ id: 'cheap', phase: 'animate', budgetMs: 1, update: () => void (clock += 0.5) });
    s.register({ id: 'fixed-cost', phase: 'fixed', update: () => void (clock += 2) });

    s.runFrame(input(1 / 30)); // two fixed steps
    check('lastMs measures update', s.getStats().find((x) => x.id === 'slow')!.lastMs === 3);
    check(
        'fixed timing sums the frame’s substeps',
        s.getStats().find((x) => x.id === 'fixed-cost')!.lastMs === 4
    );
    check(
        'every system reports a system.<id> mark',
        marks.get('system.slow') === 3 && marks.get('system.cheap') === 0.5
    );

    for (let i = 1; i < BUDGET_WARMUP_FRAMES; i++) s.runFrame(input());
    check(
        'no budget verdict during warm-up',
        !s.getStats().find((x) => x.id === 'slow')!.overBudget && counts.warn === 0
    );
    s.runFrame(input());
    s.runFrame(input());
    const slow = s.getStats().find((x) => x.id === 'slow')!;
    const cheap = s.getStats().find((x) => x.id === 'cheap')!;
    check('over-budget system is flagged', slow.overBudget && slow.budgetMs === 1);
    check('in-budget system is not', !cheap.overBudget);
    check('over budget warns once', counts.warn === 1, `warn=${counts.warn}`);
});

// ---------------------------------------------------------------------------
console.log('\nFrame source');
// ---------------------------------------------------------------------------
quiet((counts) => {
    const s = new SystemScheduler();
    const seen: number[] = [];
    s.register({ id: 'reader', phase: 'input', update: (ctx) => void seen.push(ctx.time) });
    s.runFrame(input(0.5));
    s.runFrame(input(0.5));
    check('without a source, time accumulates dt', seen.join() === '0.5,1', seen.join());

    let t = 0;
    let fail = false;
    const audio = { bpm: 140 } as FrameContext['audio'];
    s.setFrameSource({
        id: 'clock',
        sample: (dt) => {
            if (fail) throw new Error('decoder gone');
            t += dt * 2;
            return { time: t, audio };
        },
    });
    let sawAudio = false;
    s.register({
        id: 'late-reader',
        phase: 'ui',
        update: (ctx) => void (sawAudio = ctx.audio === audio),
    });
    seen.length = 0;
    s.runFrame(input(0.25));
    check(
        'source time reaches every phase',
        seen[0] === 0.5 && sawAudio,
        `${seen.join()} ${sawAudio}`
    );
    check('order lists the source first', s.getOrder()[0] === 'source:clock', s.getOrder()[0]);

    fail = true;
    s.runFrame(input(0.25));
    s.runFrame(input(0.25));
    check(
        'a throwing source keeps the last audio, time runs on, warns once',
        seen[1] === 0.75 && seen[2] === 1 && sawAudio && counts.warn === 1,
        `${seen.join()} warn=${counts.warn}`
    );
});

// ---------------------------------------------------------------------------
console.log('\nFixed step');
// ---------------------------------------------------------------------------
{
    const c = new FixedStepClock(1 / 60, 5);
    check('one 60 Hz frame → one step', c.advance(1 / 60) === 1);
    check('half frames accumulate', c.advance(1 / 120) === 0 && c.advance(1 / 120) === 1);
    check('alpha in [0,1)', c.alpha >= 0 && c.alpha < 1, String(c.alpha));
    const steps = c.advance(1.0);
    check('hitch is capped at maxSubsteps', steps === 5, String(steps));
    check(
        'excess is dropped, not carried',
        c.alpha < 1 && c.droppedSeconds > 0.8,
        String(c.droppedSeconds)
    );
    check('negative / zero dt adds nothing', c.advance(-1) === 0 && c.advance(0) === 0);

    // Determinism: same delta sequence → same tick count and same integrated state.
    const deltas: number[] = [];
    let seed = 1;
    for (let i = 0; i < 10_000; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        deltas.push(0.004 + (seed / 2 ** 32) * 0.04); // 4–44 ms frames
    }
    const run = () => {
        const s = new SystemScheduler({ now: () => 0, rng: new SimRng(7) });
        const state = { x: 0, v: 1, ticks: [] as number[] };
        s.register({
            id: 'integrate',
            phase: 'fixed',
            update: (ctx: FrameContext) => {
                state.v += -state.x * ctx.fixedDt + (ctx.rng.next() - 0.5) * 1e-3;
                state.x += state.v * ctx.fixedDt;
                if (state.ticks.length < 3) state.ticks.push(ctx.fixedTick);
            },
        });
        let last: FrameContext | null = null;
        for (const dt of deltas) last = s.runFrame(input(dt));
        return { x: state.x, tick: last!.fixedTick, firstTicks: state.ticks.join() };
    };
    const a = run();
    const b = run();
    check(
        'identical deltas + seed → bit-identical state after 10k frames',
        a.x === b.x && a.tick === b.tick,
        `${a.x} vs ${b.x}`
    );
    check('fixedTick counts 0,1,2…', a.firstTicks === '0,1,2', a.firstTicks);

    const s = new SystemScheduler({ fixedDt: 1 / 60, maxSubsteps: 5 });
    let fixedRuns = 0;
    let varRuns = 0;
    let stepsSeen = -1;
    s.register({ id: 'f', phase: 'fixed', update: () => void fixedRuns++ });
    s.register({
        id: 'v',
        phase: 'simulate',
        update: (ctx) => {
            varRuns++;
            stepsSeen = ctx.fixedSteps;
        },
    });
    s.runFrame(input(1 / 30));
    check(
        'fixed phase runs per step, others once per frame',
        fixedRuns === 2 && varRuns === 1 && stepsSeen === 2,
        `${fixedRuns}/${varRuns}/${stepsSeen}`
    );
    s.runFrame(input(1 / 240));
    check(
        'a short frame can run zero fixed steps',
        fixedRuns === 2 && varRuns === 2 && stepsSeen === 0
    );
}

// ---------------------------------------------------------------------------
console.log('\nPlayer interpolation');
// ---------------------------------------------------------------------------
{
    const camera = { position: new THREE.Vector3(0, 2, 0) };
    const player = { position: new THREE.Vector3(0, 2, 0) };
    const interp = new PlayerInterpolator();

    /** A fake fixed step: the sim moves player and camera +1 on x. */
    const step = () => {
        interp.beginStep(camera, player);
        player.position.x += 1;
        camera.position.x = player.position.x;
        interp.endStep(camera, player);
    };

    // Nothing has stepped yet: hands off.
    let r = interp.present(camera, player, 0.5, true);
    check('before any step the camera is untouched', camera.position.x === 0 && r.x === 0);

    step(); // 0 → 1
    r = interp.present(camera, player, 0.25, true);
    check('camera blends prev→sim by alpha', camera.position.x === 0.25, String(camera.position.x));
    check('renderPlayer blends the same way', r.x === 0.25, String(r.x));

    // Frame with no step, later alpha: blend moves on, sim untouched.
    interp.present(camera, player, 0.75, true);
    check('a 0-step frame re-blends with the new alpha', camera.position.x === 0.75);

    // Next step must start from the sim's camera (1), not the blend (0.75).
    let seenAtStep = -1;
    interp.beginStep(camera, player);
    seenAtStep = camera.position.x;
    player.position.x += 1;
    camera.position.x = player.position.x;
    interp.endStep(camera, player);
    check('the blend never feeds the sim', seenAtStep === 1, String(seenAtStep));
    interp.present(camera, player, 0.5, true);
    check('blend continues from the restored state', camera.position.x === 1.5);

    // External camera write (spawn / explore exit) on a 0-step frame: adopted.
    camera.position.set(50, 2, 50);
    player.position.set(50, 2, 50);
    r = interp.present(camera, player, 0.5, true);
    check(
        'external camera write is kept, not blended over',
        camera.position.x === 50 && r.x === 50
    );
    interp.beginStep(camera, player);
    check('and the next step starts from it', camera.position.x === 50);
    player.position.x += 1;
    camera.position.x = player.position.x;
    interp.endStep(camera, player);
    interp.present(camera, player, 0.5, true);
    check('blend resumes after the external write', camera.position.x === 50.5);

    // Teleport inside a step: snap, no smear across the map.
    interp.beginStep(camera, player);
    player.position.set(-100, 2, 0);
    camera.position.copy(player.position);
    interp.endStep(camera, player);
    interp.present(camera, player, 0.1, true);
    check('a teleport-sized step snaps', camera.position.x === -100, String(camera.position.x));

    // Explore camera owns the view: hands off, then resyncs.
    camera.position.set(7, 30, 7);
    r = interp.present(camera, player, 0.5, false);
    check('inactive leaves the camera alone', camera.position.x === 7 && camera.position.y === 30);
    check('inactive renders the sim player', r.x === player.position.x);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

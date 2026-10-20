/**
 * SystemScheduler + FixedStepClock (#1973).
 *
 * Headless: exercises phase order, after/before resolution, cycle rejection,
 * the circuit breaker and fixed-step determinism with plain stub systems.
 * The real frame's order is pinned separately by tests/scheduler-order.test.ts.
 *
 * Run with: npx tsx tests/scheduler.test.ts
 */

import {
    FixedStepClock,
    SystemScheduler,
    type FrameContext,
    type FrameInput,
    type System,
} from '../src/core/scheduler/index.ts';

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
        time: 0,
        audio: null,
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
    s.register(sys('sim', 'simulate', log));
    s.register(sys('aud', 'audio', log));
    s.register(sys('prep', 'render-prep', log));
    s.runFrame(input());
    check(
        'phases run in PHASES order',
        log.join() === 'in,sim,anim,aud,prep,render,ui1',
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

    let disposed = false;
    const off = s.register(sys('tmp', 'ui', log, { dispose: () => void (disposed = true) }));
    off();
    check('unregister removes and disposes', disposed && !s.getOrder().includes('ui:tmp'));
}

// ---------------------------------------------------------------------------
console.log('\nGating and circuit breaker');
// ---------------------------------------------------------------------------
{
    const log: string[] = [];
    const warn = console.warn;
    const error = console.error;
    let warns = 0;
    let errors = 0;
    console.warn = () => void warns++;
    console.error = () => void errors++;

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
        warns === 1 && errors === 1,
        `warn=${warns} error=${errors}`
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

    console.warn = warn;
    console.error = error;
}

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
        const s = new SystemScheduler({ now: () => 0 });
        const state = { x: 0, v: 1, ticks: [] as number[] };
        s.register({
            id: 'integrate',
            phase: 'fixed',
            update: (ctx: FrameContext) => {
                state.v += -state.x * ctx.fixedDt;
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
        'identical deltas → bit-identical state after 10k frames',
        a.x === b.x && a.tick === b.tick,
        `${a.x} vs ${b.x}`
    );
    check('fixedTick counts 0,1,2…', a.firstTicks === '0,1,2', a.firstTicks);

    const s = new SystemScheduler({ fixedDt: 1 / 60, maxSubsteps: 5 });
    let fixedRuns = 0;
    let varRuns = 0;
    s.register({ id: 'f', phase: 'fixed', update: () => void fixedRuns++ });
    s.register({ id: 'v', phase: 'simulate', update: () => void varRuns++ });
    s.runFrame(input(1 / 30));
    check(
        'fixed phase runs per step, others once per frame',
        fixedRuns === 2 && varRuns === 1,
        `${fixedRuns}/${varRuns}`
    );
    s.runFrame(input(1 / 240));
    check('a short frame can run zero fixed steps', fixedRuns === 2 && varRuns === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

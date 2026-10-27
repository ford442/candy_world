/**
 * Fixed-step determinism for real player physics (#1973).
 *
 * Runs the production `updatePhysics` (character controller, states,
 * abilities, WASM ground) in the SystemScheduler's `fixed` phase for 10,000
 * ticks, with the production camera blend (`PlayerInterpolator`) in
 * `simulate`, driven by a seeded input log indexed by tick. Every run happens
 * in a fresh child process, because physics state is module-level.
 *
 * Asserts:
 *   - same seed + same input log → bit-identical player state, run twice;
 *   - the same, whatever the frame pacing (60 Hz, 144 Hz, 30 Hz, jittery) —
 *     the camera blend between steps never leaks into the simulation (the
 *     sim's camera, whose height smoothing reads its own last value, is
 *     compared too);
 *   - a different seed gives a different result (the test is not vacuous).
 *
 * Run with: npm run test:fixed-step
 * (tsx --import ./tests/support/register-wasm-hooks.mjs tests/fixed-step-determinism.test.ts;
 *  needs `npm run build:wasm` first)
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TICKS = 10_000;
const PACINGS = ['60', '144', '30', 'jitter'] as const;
type Pacing = (typeof PACINGS)[number];

interface RunResult {
    /** Throws the scheduler caught; any is a failure. */
    errors: number;
    ticks: number;
    frames: number;
    position: [number, number, number];
    velocity: [number, number, number];
    /** The camera as the last step left it (before the render blend). */
    camera: [number, number, number];
    state: string;
    clockMs: number;
    travelled: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

if (process.argv[2] === '--child') {
    await child(process.argv[3] as Pacing, Number(process.argv[4]));
} else {
    parent();
}

function parent(): void {
    let passed = 0;
    let failed = 0;
    const check = (name: string, cond: boolean, detail = '') => {
        if (cond) {
            passed++;
            console.log(`  ✓ ${name}`);
        } else {
            failed++;
            console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
        }
    };

    const run = (pacing: Pacing, seed: number): RunResult => {
        const out = execFileSync(
            process.execPath,
            [
                '--import',
                'tsx',
                '--import',
                './tests/support/register-wasm-hooks.mjs',
                'tests/fixed-step-determinism.test.ts',
                '--child',
                pacing,
                String(seed),
            ],
            { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
        );
        const line = out.split('\n').find((l) => l.startsWith('RESULT '));
        if (!line)
            throw new Error(`child ${pacing}/${seed} printed no RESULT line:\n${out.slice(-2000)}`);
        return JSON.parse(line.slice('RESULT '.length)) as RunResult;
    };
    const same = (a: RunResult, b: RunResult) =>
        a.errors === 0 &&
        b.errors === 0 &&
        a.ticks === b.ticks &&
        a.state === b.state &&
        a.clockMs === b.clockMs &&
        a.position.every((v, i) => Object.is(v, b.position[i])) &&
        a.velocity.every((v, i) => Object.is(v, b.velocity[i])) &&
        a.camera.every((v, i) => Object.is(v, b.camera[i]));
    const show = (r: RunResult) =>
        `pos ${r.position.map((v) => v.toFixed(6)).join(',')} cam y ${r.camera[1].toFixed(6)} ` +
        `${r.state} after ${r.ticks} ticks / ${r.frames} frames`;

    console.log(`\nFixed-step player physics, ${TICKS} ticks`);
    const SEED = 1973;
    const base = run('60', SEED);
    console.log(`  60 Hz: ${show(base)}, travelled ${base.travelled.toFixed(1)}`);
    check(
        'all ticks ran, none threw',
        base.ticks === TICKS && base.errors === 0,
        `${base.ticks} ticks, ${base.errors} errors`
    );
    check('the input log moves the player', base.travelled > 50, base.travelled.toFixed(2));

    const again = run('60', SEED);
    check('same seed + inputs + pacing → bit-identical', same(base, again), show(again));

    for (const pacing of PACINGS.slice(1)) {
        const r = run(pacing, SEED);
        check(
            `${pacing} pacing → bit-identical to 60 Hz (${r.frames} frames)`,
            same(base, r),
            show(r)
        );
    }

    const other = run('60', SEED + 1);
    check('a different seed diverges', !same(base, other), show(other));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

async function child(pacing: Pacing, seed: number): Promise<void> {
    const THREE = await import('three');
    const { CONFIG } = await import('../src/core/config.ts');
    const { keyStates } = await import('../src/core/input/input-types.ts');
    const { SystemScheduler } = await import('../src/core/scheduler/index.ts');
    const { player, updatePhysics } = await import('../src/systems/physics/index.ts');
    const { PlayerInterpolator } = await import('../src/systems/physics/player-interpolation.ts');
    const { physicsClock } = await import('../src/systems/physics/physics-types.ts');
    const { SimRng, simRng } = await import('../src/utils/sim-rng.ts');

    // Physics reads a couple of window flags, and discoveries raise a toast and
    // a screen-reader announcement. Stub both after import, so modules that
    // probe `window.location` at load still see a plain Node environment. The
    // document is an inert sink: lookups find nothing, everything else no-ops.
    (globalThis as { window?: object }).window ??= {};
    const sink: object = new Proxy(function () {}, {
        get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : sink),
        apply: () => sink,
        construct: () => sink,
        set: () => true,
    });
    (globalThis as { document?: object }).document ??= new Proxy(
        {},
        {
            get: (_t, key) =>
                key === 'getElementById' || key === 'querySelector' ? () => null : sink,
        }
    );
    // Physics logs on first use; keep the child's stdout to the RESULT line.
    console.log = () => {};
    console.info = () => {};

    simRng.setSeed(seed);

    // The input log: held key combos and taps, a slowly turning camera.
    const log = new SimRng(seed ^ 0x9e3779b9);
    type Input = {
        f: boolean;
        b: boolean;
        l: boolean;
        r: boolean;
        sprint: boolean;
        jump: boolean;
        dash: boolean;
        yaw: number;
    };
    const inputs: Input[] = [];
    let yaw = 0;
    let turn = 0;
    let hold: Omit<Input, 'jump' | 'dash' | 'yaw'> = {
        f: false,
        b: false,
        l: false,
        r: false,
        sprint: false,
    };
    let holdLeft = 0;
    for (let t = 0; t < TICKS; t++) {
        if (holdLeft-- <= 0) {
            holdLeft = 30 + Math.floor(log.next() * 120);
            hold = {
                f: log.next() < 0.7,
                b: log.next() < 0.1,
                l: log.next() < 0.25,
                r: log.next() < 0.25,
                sprint: log.next() < 0.3,
            };
            turn = (log.next() - 0.5) * 0.04;
        }
        yaw += turn;
        inputs.push({ ...hold, jump: log.next() < 0.02, dash: log.next() < 0.004, yaw });
    }

    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.rotation.order = 'YXZ';
    const controls = { isLocked: true, getObject: () => camera, lock() {}, unlock() {} };
    const eye = CONFIG.player.eyeHeight;
    player.position.set(CONFIG.player.spawnX, 20 + eye, CONFIG.player.spawnZ);
    camera.position.copy(player.position);
    const audio = { bpm: 120, beatPhase: 0, kickTrigger: 0, grooveAmount: 0, channelData: [] };

    const interp = new PlayerInterpolator();
    const scheduler = new SystemScheduler({ now: () => 0 });
    let ticks = 0;
    let travelled = 0;
    const simCamera = new THREE.Vector3();
    const last = new THREE.Vector3().copy(player.position);
    scheduler.register({
        id: 'player-physics',
        phase: 'fixed',
        update: (ctx) => {
            if (ticks >= TICKS) return;
            const i = inputs[ticks];
            keyStates.forward = i.f;
            keyStates.backward = i.b;
            keyStates.left = i.l;
            keyStates.right = i.r;
            keyStates.sprint = i.sprint;
            keyStates.jump = i.jump;
            keyStates.dash = i.dash;
            camera.rotation.y = i.yaw;
            interp.beginStep(camera, player);
            updatePhysics(ctx.fixedDt, camera, controls, keyStates, audio);
            interp.endStep(camera, player);
            simCamera.copy(camera.position);
            travelled += last.distanceTo(player.position);
            last.copy(player.position);
            ticks++;
        },
    });
    scheduler.register({
        id: 'player-view',
        phase: 'simulate',
        update: (ctx) => void interp.present(camera, player, ctx.fixedAlpha, true),
    });

    const pace = new SimRng(0xfeed);
    const frameDt = (): number => {
        switch (pacing) {
            case '60':
                return 1 / 60;
            case '144':
                return 1 / 144;
            case '30':
                return 1 / 30;
            case 'jitter':
                return 0.002 + pace.next() * 0.05;
        }
    };
    const frameInput = {
        rawDt: 0,
        player,
        camera,
        caps: {} as never,
        exploreActive: false,
    };
    let frames = 0;
    while (ticks < TICKS) {
        const dt = frameDt();
        scheduler.runFrame({ ...frameInput, dt, rawDt: dt });
        frames++;
        if (frames > TICKS * 20) throw new Error('pacing never reached the tick count');
    }

    const errors = scheduler.getStats().reduce((n, st) => n + st.errors, 0);
    const result: RunResult = {
        errors,
        ticks,
        frames,
        position: player.position.toArray() as [number, number, number],
        velocity: player.velocity.toArray() as [number, number, number],
        camera: simCamera.toArray() as [number, number, number],
        state: String(player.currentState),
        clockMs: physicsClock.ms,
        travelled,
    };
    process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
    process.exit(0);
}

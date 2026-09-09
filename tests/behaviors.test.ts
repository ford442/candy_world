/**
 * Behavior attachment layer tests.
 *
 * Covers the register/attach/detach contract, quality gating, ECS component
 * mirroring (against a duck-typed World), and the per-frame allocation budget
 * for the two built-in behaviors.
 *
 * Run with: npx tsx tests/behaviors.test.ts
 *   (add `node --expose-gc` via NODE_OPTIONS for the strict allocation check)
 */

import {
    addBehavior,
    getBehavior,
    getBehaviorCount,
    hasBehavior,
    listBehaviors,
    registerBehaviorType,
    removeAllBehaviors,
    removeBehavior,
    resetBehaviors,
    setBehaviorQuality,
    setBehaviorWorld,
    tickBehaviors,
    type Behavior,
} from '../src/systems/ecs/behavior.ts';
import { createBobBehavior } from '../src/systems/ecs/behaviors/bob.ts';
import { createInteractHighlightBehavior } from '../src/systems/ecs/behaviors/interact-highlight.ts';

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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockColor {
    constructor(
        public r = 0,
        public g = 0,
        public b = 0
    ) {}
    setRGB(r: number, g: number, b: number) {
        this.r = r;
        this.g = g;
        this.b = b;
        return this;
    }
}

function mockMesh(): any {
    const material = { emissive: new MockColor(0, 0, 0), emissiveIntensity: 1, userData: {} };
    const obj: any = {
        position: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        material,
        userData: {},
    };
    obj.traverse = (fn: (o: any) => void) => fn(obj);
    return obj;
}

/** Duck-typed stand-in for `World` — the behavior host only needs these five. */
function mockWorld() {
    const store = new Map<number, any>();
    return {
        calls: 0,
        addComponent(e: number, name: string, c: any) {
            this.calls++;
            store.set(e, c);
        },
        setComponent(e: number, name: string, c: any) {
            this.calls++;
            store.set(e, c);
        },
        getComponent(e: number) {
            return store.get(e);
        },
        hasComponent(e: number) {
            return store.has(e);
        },
        removeComponent(e: number) {
            store.delete(e);
        },
        peek(e: number) {
            return store.get(e);
        },
    };
}

function tracker(log: string[], name: string): Behavior {
    return {
        onEnable() {
            log.push(`${name}:enable`);
        },
        tick() {
            log.push(`${name}:tick`);
        },
        onDisable() {
            log.push(`${name}:disable`);
        },
    };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

console.log('\nLifecycle');
{
    resetBehaviors();
    const log: string[] = [];
    registerBehaviorType('a', () => tracker(log, 'a'));
    registerBehaviorType('b', () => tracker(log, 'b'));

    check('unknown type is rejected', addBehavior(1, 'nope') === false);
    check('attach returns true', addBehavior(1, 'a') === true);
    check('duplicate attach is a no-op', addBehavior(1, 'a') === false);
    check('onEnable fired once', log.filter((l) => l === 'a:enable').length === 1);

    addBehavior(1, 'b');
    addBehavior(2, 'a');
    check('count tracks live behaviors', getBehaviorCount() === 3, `got ${getBehaviorCount()}`);
    check('hasBehavior', hasBehavior(1, 'b') && !hasBehavior(2, 'b'));
    check('listBehaviors', listBehaviors(1).sort().join(',') === 'a,b');

    log.length = 0;
    tickBehaviors(0.016, 0);
    check('every attached behavior ticks', log.length === 3, log.join(' '));

    removeBehavior(1, 'a');
    check('onDisable fired on detach', log.includes('a:disable'));
    check('detached behavior is gone', !hasBehavior(1, 'a') && getBehaviorCount() === 2);

    log.length = 0;
    tickBehaviors(0.016, 0);
    check('detached behavior stops ticking', log.length === 2, log.join(' '));

    removeAllBehaviors(1);
    check(
        'removeAllBehaviors clears the entity',
        listBehaviors(1).length === 0 && getBehaviorCount() === 1
    );
}

// ---------------------------------------------------------------------------
// Swap-remove index integrity
// ---------------------------------------------------------------------------

console.log('\nSwap-remove integrity');
{
    resetBehaviors();
    const log: string[] = [];
    registerBehaviorType('a', () => tracker(log, 'a'));
    for (let e = 1; e <= 5; e++) addBehavior(e, 'a');

    // Remove from the middle: the last slot is swapped into the hole.
    removeBehavior(3, 'a');
    check(
        'middle removal keeps the rest attached',
        hasBehavior(1, 'a') &&
            hasBehavior(2, 'a') &&
            !hasBehavior(3, 'a') &&
            hasBehavior(4, 'a') &&
            hasBehavior(5, 'a')
    );

    removeBehavior(5, 'a'); // the entity that was moved into the hole
    check('moved slot is still removable', !hasBehavior(5, 'a') && getBehaviorCount() === 3);

    log.length = 0;
    tickBehaviors(0.016, 0);
    check('tick list stayed dense', log.length === 3, log.join(' '));
}

// ---------------------------------------------------------------------------
// Detach from inside a tick
// ---------------------------------------------------------------------------

console.log('\nRe-entrant detach');
{
    resetBehaviors();
    let ticks = 0;
    registerBehaviorType('suicide', (entity) => ({
        tick() {
            ticks++;
            removeBehavior(entity, 'suicide');
        },
    }));
    registerBehaviorType('survivor', () => ({
        tick() {
            ticks++;
        },
    }));
    addBehavior(1, 'suicide');
    addBehavior(2, 'survivor');

    tickBehaviors(0.016, 0);
    check('both ticked on the detaching frame', ticks === 2, `got ${ticks}`);
    check(
        'deferred detach applied after the tick',
        !hasBehavior(1, 'suicide') && getBehaviorCount() === 1
    );

    ticks = 0;
    tickBehaviors(0.016, 0);
    check('only the survivor ticks next frame', ticks === 1, `got ${ticks}`);
}

// ---------------------------------------------------------------------------
// Quality gating
// ---------------------------------------------------------------------------

console.log('\nQuality gating');
{
    resetBehaviors();
    const log: string[] = [];
    registerBehaviorType('cheap', () => tracker(log, 'cheap'), 'low');
    registerBehaviorType('pricey', () => tracker(log, 'pricey'), 'high');

    addBehavior(1, 'cheap');
    addBehavior(1, 'pricey');
    log.length = 0;
    tickBehaviors(0.016, 0);
    check('both run at high', log.length === 2, log.join(' '));

    setBehaviorQuality('low');
    check('gated-off behavior is disabled', log.includes('pricey:disable'));
    log.length = 0;
    tickBehaviors(0.016, 0);
    check('gated-off behavior stops ticking', log.join(',') === 'cheap:tick', log.join(','));

    setBehaviorQuality('high');
    check('behavior re-enables when quality returns', log.includes('pricey:enable'));
    log.length = 0;
    tickBehaviors(0.016, 0);
    check('re-enabled behavior ticks again', log.length === 2, log.join(' '));
}

// ---------------------------------------------------------------------------
// ECS component mirroring
// ---------------------------------------------------------------------------

console.log('\nECS component mirroring');
{
    resetBehaviors();
    const world = mockWorld();
    setBehaviorWorld(world as any);
    registerBehaviorType('a', () => ({ tick() {} }));
    registerBehaviorType('b', () => ({ tick() {} }));

    addBehavior(7, 'a');
    check('component written on attach', world.peek(7)?.types.join(',') === 'a');
    addBehavior(7, 'b');
    check('component lists both behaviors', world.peek(7)?.types.sort().join(',') === 'a,b');

    const callsBefore = world.calls;
    tickBehaviors(0.016, 0);
    tickBehaviors(0.016, 0);
    check(
        'ticking never touches the world',
        world.calls === callsBefore,
        `${world.calls} vs ${callsBefore}`
    );

    removeBehavior(7, 'a');
    check('component updated on detach', world.peek(7)?.types.join(',') === 'b');
    removeBehavior(7, 'b');
    check('component removed when the last behavior goes', world.peek(7) === undefined);
    setBehaviorWorld(null);
}

// ---------------------------------------------------------------------------
// Built-in: bob
// ---------------------------------------------------------------------------

console.log('\nBuilt-in: bob');
{
    resetBehaviors();
    registerBehaviorType('bob', createBobBehavior);
    const mesh = mockMesh();
    addBehavior(1, 'bob', { object: mesh, amplitude: 0.5, speed: 1, phase: 0, roll: 0.1 });

    tickBehaviors(0.016, 0.25); // quarter cycle → sin = 1
    check(
        'bob reaches peak amplitude',
        Math.abs(mesh.position.y - 2.5) < 1e-6,
        `y=${mesh.position.y}`
    );
    check('roll trails the bob', Math.abs(mesh.rotation.z) < 1e-6, `z=${mesh.rotation.z}`);

    tickBehaviors(0.016, 0.75); // three-quarter cycle → sin = -1
    check('bob reaches trough', Math.abs(mesh.position.y - 1.5) < 1e-6, `y=${mesh.position.y}`);

    removeBehavior(1, 'bob');
    check(
        'bob restores the original pose',
        Math.abs(mesh.position.y - 2) < 1e-6 && Math.abs(mesh.rotation.z) < 1e-6
    );
}

// ---------------------------------------------------------------------------
// Built-in: interact highlight
// ---------------------------------------------------------------------------

console.log('\nBuilt-in: interact highlight');
{
    resetBehaviors();
    registerBehaviorType('interact', createInteractHighlightBehavior);
    const mesh = mockMesh();
    let ownHookCalls = 0;
    mesh.userData.onGazeEnter = () => {
        ownHookCalls++;
    };

    addBehavior(1, 'interact', { object: mesh, color: 0xffffff, intensity: 1, attack: 0.1 });
    check(
        'gaze hooks installed',
        typeof mesh.userData.onGazeEnter === 'function' &&
            typeof mesh.userData.onGazeLeave === 'function'
    );

    tickBehaviors(0.05, 0);
    check(
        'idle prop keeps its emissive',
        mesh.material.emissive.r === 0 && mesh.material.emissiveIntensity === 1
    );

    mesh.userData.onGazeEnter();
    check('pre-existing hook still fires', ownHookCalls === 1);
    tickBehaviors(0.05, 0); // half of the 0.1s attack
    check(
        'highlight ramps in',
        mesh.material.emissive.r > 0.4 && mesh.material.emissive.r < 0.6,
        `r=${mesh.material.emissive.r}`
    );
    tickBehaviors(0.05, 0);
    check(
        'highlight reaches full',
        Math.abs(mesh.material.emissive.r - 1) < 1e-6 &&
            Math.abs(mesh.material.emissiveIntensity - 2) < 1e-6
    );

    mesh.userData.onGazeLeave();
    tickBehaviors(0.2, 0);
    check(
        'highlight falls back off',
        Math.abs(mesh.material.emissive.r) < 1e-6 &&
            Math.abs(mesh.material.emissiveIntensity - 1) < 1e-6
    );

    removeBehavior(1, 'interact');
    check(
        'hooks restored on detach',
        mesh.userData.onGazeEnter !== undefined && mesh.userData.onGazeLeave === undefined
    );
    mesh.userData.onGazeEnter();
    check('restored hook is the original', ownHookCalls === 2);

    // Guards: props whose look is owned by a shared material or by TSL must be
    // left alone — highlighting them would tint the whole species, or no-op.
    const sharedProp = mockMesh();
    sharedProp.material.userData.shared = true;
    addBehavior(2, 'interact', { object: sharedProp, intensity: 1, attack: 0.01 });
    sharedProp.userData.onGazeEnter();
    tickBehaviors(0.1, 0);
    check(
        'shared material is not highlighted',
        sharedProp.material.emissive.r === 0 && sharedProp.material.emissiveIntensity === 1
    );

    const tslProp = mockMesh();
    tslProp.material.emissiveNode = {};
    addBehavior(3, 'interact', { object: tslProp, intensity: 1, attack: 0.01 });
    tslProp.userData.onGazeEnter();
    tickBehaviors(0.1, 0);
    check(
        'TSL-driven emissive is not touched',
        tslProp.material.emissive.r === 0 && tslProp.material.emissiveIntensity === 1
    );
}

// ---------------------------------------------------------------------------
// Allocation budget
// ---------------------------------------------------------------------------

console.log('\nAllocation budget');
{
    resetBehaviors();
    registerBehaviorType('bob', createBobBehavior);
    registerBehaviorType('interact', createInteractHighlightBehavior);
    for (let e = 1; e <= 100; e++) {
        const mesh = mockMesh();
        addBehavior(e, 'bob', { object: mesh, phase: e });
        addBehavior(e, 'interact', { object: mesh });
    }

    const gc = (globalThis as any).gc as (() => void) | undefined;
    const ITERATIONS = 20000;

    // Warm up so lazy IC/shape work is not counted as steady-state allocation.
    for (let i = 0; i < 2000; i++) tickBehaviors(0.016, i * 0.016);

    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERATIONS; i++) tickBehaviors(0.016, i * 0.016);
    gc?.();
    const growth = process.memoryUsage().heapUsed - before;
    const perTick = growth / ITERATIONS;

    if (gc) {
        // 200 behaviors × 20k ticks. Anything allocating per frame lands orders
        // of magnitude above this; steady-state churn should be ~0 bytes/tick.
        check(
            'tick allocates nothing measurable',
            perTick < 8,
            `${perTick.toFixed(2)} bytes/tick over ${ITERATIONS} ticks`
        );
    } else {
        console.log(
            `  … ${perTick.toFixed(2)} bytes/tick (run with --expose-gc for the strict check)`
        );
        check('tick allocation stayed bounded', perTick < 200, `${perTick.toFixed(2)} bytes/tick`);
    }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

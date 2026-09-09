/**
 * Fauna behaviour framework tests.
 *
 * Drives FaunaBehaviorRunner against a hand-built boid slab — no WASM, no
 * renderer, no scene. Covers the scatter trigger, the hysteresis band, the
 * settle cycle, the scatter sink, and the per-frame allocation budget.
 *
 * Run with: npx tsx tests/fauna-behavior.test.ts
 *   (add `node --expose-gc` via NODE_OPTIONS for the strict allocation check)
 */

import {
    FaunaBehaviorRunner,
    getFaunaSpeciesProfile,
    listFaunaSpeciesProfiles,
    registerFaunaSpecies,
    setFaunaScatterSink,
} from '../src/systems/fauna/behavior.ts';
import {
    FAUNA_BOID_STRIDE,
    FaunaSpecies,
    FaunaState,
    type FaunaSpawnEntry,
} from '../src/systems/fauna/types.ts';

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
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
    entries: FaunaSpawnEntry[];
    heap: Float32Array;
}

/** One critter per species, all parked at the given XZ positions. */
function makeFixture(specs: Array<{ species: FaunaSpecies; x: number; z: number }>): Fixture {
    const heap = new Float32Array(specs.length * FAUNA_BOID_STRIDE);
    const entries: FaunaSpawnEntry[] = specs.map((s, slot) => {
        const b = slot * FAUNA_BOID_STRIDE;
        heap[b] = s.x;
        heap[b + 1] = 1;
        heap[b + 2] = s.z;
        heap[b + 6] = slot * 0.7;
        heap[b + 7] = s.species;
        return {
            entity: slot as unknown as FaunaSpawnEntry['entity'],
            component: {
                slot,
                species: s.species,
                state: FaunaState.Wander,
                biome: 'global',
                normalX: 0,
                normalY: 1,
                normalZ: 0,
            },
        };
    });
    return { entries, heap };
}

function speed(heap: Float32Array, slot: number): number {
    const b = slot * FAUNA_BOID_STRIDE;
    return Math.hypot(heap[b + 3], heap[b + 4], heap[b + 5]);
}

// ---------------------------------------------------------------------------
// 1. Registry
// ---------------------------------------------------------------------------

console.log('\nRegistry');
{
    const profiles = listFaunaSpeciesProfiles();
    check('three built-in species registered', profiles.length >= 3, `got ${profiles.length}`);

    const beetle = getFaunaSpeciesProfile(FaunaSpecies.GumdropBeetle);
    check('beetle profile resolvable', !!beetle);
    check(
        'every profile has a hysteresis band',
        profiles.every((p) => p.calmRadius > p.scatterRadius)
    );

    // Round-trips through the registry; restored below.
    const original = { ...beetle! };
    registerFaunaSpecies({ ...original, scatterRadius: 1 });
    check(
        'registering an existing species replaces it',
        getFaunaSpeciesProfile(FaunaSpecies.GumdropBeetle)!.scatterRadius === 1
    );
    registerFaunaSpecies(original);
    check(
        'restore leaves the built-in tuning intact',
        getFaunaSpeciesProfile(FaunaSpecies.GumdropBeetle)!.scatterRadius === original.scatterRadius
    );
}

// ---------------------------------------------------------------------------
// 2. Scatter on player approach
// ---------------------------------------------------------------------------

console.log('\nScatter');
{
    const beetle = getFaunaSpeciesProfile(FaunaSpecies.GumdropBeetle)!;
    const { entries, heap } = makeFixture([
        { species: FaunaSpecies.GumdropBeetle, x: 2, z: 0 }, // inside scatterRadius
        { species: FaunaSpecies.GumdropBeetle, x: 40, z: 0 }, // far away
    ]);
    const runner = new FaunaBehaviorRunner(1);

    const stats = runner.update(entries, heap, 0, 1 / 60, 0, 1, 0);

    check('near critter entered Flee', entries[0].component.state === FaunaState.Flee);
    check('far critter did not', entries[1].component.state !== FaunaState.Flee);
    check('one scatter reported', stats.scattered === 1, `got ${stats.scattered}`);
    check('near critter gained speed', speed(heap, 0) > 1, `speed ${speed(heap, 0).toFixed(2)}`);
    check('far critter untouched', speed(heap, 1) === 0);

    // Impulse points away from the player, who stands at the origin.
    check('impulse points away from player', heap[3] > 0, `vx ${heap[3].toFixed(2)}`);
    check(
        'impulse magnitude matches the profile',
        Math.abs(heap[3] - beetle.scatterImpulse) < 1e-4,
        `vx ${heap[3].toFixed(3)} vs ${beetle.scatterImpulse}`
    );

    // A second frame with the player still close must not re-impulse (cooldown).
    const before = speed(heap, 0);
    const again = runner.update(entries, heap, 0, 1 / 60, 0, 1, 0);
    check('no double impulse while already fleeing', again.scattered === 0);
    check('velocity unchanged on the hold frame', speed(heap, 0) === before);
}

// ---------------------------------------------------------------------------
// 3. Hysteresis — Flee holds until timer expires AND the critter is clear
// ---------------------------------------------------------------------------

console.log('\nHysteresis');
{
    const moth = getFaunaSpeciesProfile(FaunaSpecies.SugarMoth)!;
    const { entries, heap } = makeFixture([{ species: FaunaSpecies.SugarMoth, x: 2, z: 0 }]);
    const runner = new FaunaBehaviorRunner(2);
    const dt = 1 / 60;

    runner.update(entries, heap, 0, dt, 0, 1, 0);
    check('moth fleeing', entries[0].component.state === FaunaState.Flee);

    // Step it out past scatterRadius but inside calmRadius, then run out the
    // flee timer: it must stay in Flee because it is still in the band.
    const between = (moth.scatterRadius + moth.calmRadius) / 2;
    heap[0] = between;
    for (let i = 0; i < Math.ceil(moth.fleeDuration / dt) + 10; i++) {
        runner.update(entries, heap, 0, dt, 0, 1, 0);
    }
    check(
        'stays in Flee inside the hysteresis band',
        entries[0].component.state === FaunaState.Flee,
        `at x=${between.toFixed(1)} (scatter ${moth.scatterRadius}, calm ${moth.calmRadius})`
    );

    // Clear of calmRadius, the very next frame returns it to Wander.
    heap[0] = moth.calmRadius + 5;
    runner.update(entries, heap, 0, dt, 0, 1, 0);
    check('returns to Wander once clear', entries[0].component.state === FaunaState.Wander);
}

// ---------------------------------------------------------------------------
// 4. Settle cycle — Perch for flyers, Rest for ground species
// ---------------------------------------------------------------------------

console.log('\nSettle');
{
    // Player parked far away so nothing ever flees.
    const { entries, heap } = makeFixture([
        { species: FaunaSpecies.SugarMoth, x: 0, z: 0 },
        { species: FaunaSpecies.GumdropBeetle, x: 1, z: 0 },
    ]);
    const runner = new FaunaBehaviorRunner(3);

    let sawPerch = false;
    let sawRest = false;
    for (let i = 0; i < 4000; i++) {
        runner.update(entries, heap, 0, 1 / 60, 500, 1, 500);
        if (entries[0].component.state === FaunaState.Perch) sawPerch = true;
        if (entries[1].component.state === FaunaState.Rest) sawRest = true;
    }
    check('perch-capable species perches', sawPerch);
    check('ground species idles rather than perching', sawRest);
    check(
        'ground species never perches',
        entries[1].component.state !== FaunaState.Perch,
        `state ${entries[1].component.state}`
    );

    // A settled critter damps toward a stop.
    const moth = entries[0];
    moth.component.state = FaunaState.Perch;
    const b = moth.component.slot * FAUNA_BOID_STRIDE;
    heap[b + 3] = 5;
    heap[b + 5] = 5;
    const beforeSpeed = speed(heap, moth.component.slot);
    runner.update(entries, heap, 0, 1 / 60, 500, 1, 500);
    check(
        'settled critter is damped',
        speed(heap, moth.component.slot) < beforeSpeed,
        `${beforeSpeed.toFixed(2)} → ${speed(heap, moth.component.slot).toFixed(2)}`
    );
}

// ---------------------------------------------------------------------------
// 5. Scatter sink (optional rigid-body reaction)
// ---------------------------------------------------------------------------

console.log('\nScatter sink');
{
    const calls: Array<{ x: number; y: number; z: number; count: number }> = [];
    setFaunaScatterSink((x, y, z, count) => calls.push({ x, y, z, count }));

    const { entries, heap } = makeFixture([
        { species: FaunaSpecies.GumdropBeetle, x: 2, z: 0 },
        { species: FaunaSpecies.GumdropBeetle, x: -2, z: 0 },
    ]);
    new FaunaBehaviorRunner(4).update(entries, heap, 0, 1 / 60, 0, 3, 0);

    check('sink fired once for the burst', calls.length === 1, `got ${calls.length}`);
    check('burst counted both critters', calls[0]?.count === 2);
    check('burst centroid is between them', Math.abs(calls[0]?.x ?? 99) < 1e-6);
    check('burst uses the player height', calls[0]?.y === 3);

    // No scatter, no call.
    calls.length = 0;
    const quiet = makeFixture([{ species: FaunaSpecies.GumdropBeetle, x: 0, z: 0 }]);
    new FaunaBehaviorRunner(5).update(quiet.entries, quiet.heap, 0, 1 / 60, 500, 1, 500);
    check('sink silent with nothing scattering', calls.length === 0);

    setFaunaScatterSink(null);
    const after = makeFixture([{ species: FaunaSpecies.GumdropBeetle, x: 2, z: 0 }]);
    new FaunaBehaviorRunner(6).update(after.entries, after.heap, 0, 1 / 60, 0, 1, 0);
    check('cleared sink is not called', calls.length === 0);
}

// ---------------------------------------------------------------------------
// 6. Degenerate input — player standing exactly on a critter
// ---------------------------------------------------------------------------

console.log('\nEdge cases');
{
    const { entries, heap } = makeFixture([{ species: FaunaSpecies.GumdropBeetle, x: 0, z: 0 }]);
    new FaunaBehaviorRunner(7).update(entries, heap, 0, 1 / 60, 0, 1, 0);
    const s = speed(heap, 0);
    check('coincident critter gets a finite impulse', Number.isFinite(s) && s > 0, `speed ${s}`);

    // An unregistered species must not crash the runner — it just roams.
    const unknown = makeFixture([{ species: 99 as FaunaSpecies, x: 1, z: 0 }]);
    const stats = new FaunaBehaviorRunner(8).update(
        unknown.entries,
        unknown.heap,
        0,
        1 / 60,
        0,
        1,
        0
    );
    check('unregistered species roams instead of throwing', stats.roam === 1);

    // The slab may be shared with WASM at a non-zero base offset.
    const OFFSET = 5 * FAUNA_BOID_STRIDE;
    const shared = new Float32Array(OFFSET + FAUNA_BOID_STRIDE);
    shared[OFFSET] = 2;
    shared[OFFSET + 7] = FaunaSpecies.GumdropBeetle;
    const off = makeFixture([{ species: FaunaSpecies.GumdropBeetle, x: 0, z: 0 }]);
    new FaunaBehaviorRunner(9).update(off.entries, shared, OFFSET, 1 / 60, 0, 1, 0);
    check('honours a non-zero base index', shared[OFFSET + 3] > 0, `vx ${shared[OFFSET + 3]}`);
}

// ---------------------------------------------------------------------------
// 7. Allocation budget
// ---------------------------------------------------------------------------

console.log('\nAllocation');
{
    const COUNT = 96;
    const specs = Array.from({ length: COUNT }, (_, i) => ({
        species: (i % 3) as FaunaSpecies,
        x: (i % 16) - 8,
        z: Math.floor(i / 16) - 3,
    }));
    const { entries, heap } = makeFixture(specs);
    const runner = new FaunaBehaviorRunner(10);
    runner.resize(COUNT);

    const gc = (globalThis as any).gc as (() => void) | undefined;
    const ITERATIONS = 20000;

    // Warm up so lazily-grown internals are already sized.
    for (let i = 0; i < 500; i++) runner.update(entries, heap, 0, 1 / 60, i % 20, 1, 0);

    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ITERATIONS; i++) {
        runner.update(entries, heap, 0, 1 / 60, (i % 40) - 20, 1, 0);
    }
    gc?.();
    const perTick = (process.memoryUsage().heapUsed - before) / ITERATIONS;

    if (gc) {
        check(
            'update allocates nothing measurable',
            perTick < 8,
            `${perTick.toFixed(2)} bytes/tick over ${ITERATIONS} ticks`
        );
    } else {
        console.log(
            `  … ${perTick.toFixed(2)} bytes/tick (run with --expose-gc for the strict check)`
        );
        check(
            'update allocation stayed bounded',
            perTick < 200,
            `${perTick.toFixed(2)} bytes/tick`
        );
    }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

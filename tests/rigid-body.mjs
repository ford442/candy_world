// tests/rigid-body.mjs
// Dynamic rigid-body solver test (assembly/rigidbody.ts).
//
// Same spirit as tests/wasm.mjs: bodies must never leave the documented world
// bounds, and the integrator must stay stable (no NaN, no runaway energy)
// under long runs and abusive impulses.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors RB_* in assembly/constants.ts
const BOUNDS = {
    minX: -128.0,
    maxX: 128.0,
    minY: -100.0,
    maxY: 500.0,
    minZ: -128.0,
    maxZ: 128.0,
};

const MAX_DYNAMIC_BODIES = 64;
const FLOATS_PER_BODY = 16;

const SHAPE_SPHERE = 0;
const SHAPE_CAPSULE = 1;
const SHAPE_BOX = 2;

// Field indices, mirroring the F_* constants in assembly/rigidbody.ts
const F = { PX: 0, PY: 1, PZ: 2, VX: 3, VY: 4, VZ: 5, FLAGS: 13 };
const FLAG_ACTIVE = 1;
const FLAG_SLEEPING = 4;

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error(`  ✗ ${message}`);
    }
}

async function loadWasm() {
    const wasmPath = path.join(__dirname, '..', 'src', 'wasm', 'candy_physics.wasm');
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`WASM file not found at ${wasmPath} — run: npm run build:wasm`);
    }
    const env = {
        abort: (message, fileName, lineNumber, columnNumber) => {
            throw new Error(`WASM abort at ${fileName}:${lineNumber}:${columnNumber}`);
        },
        seed: () => Math.random(),
    };
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env });
    return instance;
}

/**
 * The pool is a managed StaticArray, so its address is only known after
 * initRigidBodySystem(). Re-derive the view every time in case memory grew.
 */
function makeView(exports, ptr) {
    return new Float32Array(exports.memory.buffer, ptr, MAX_DYNAMIC_BODIES * FLOATS_PER_BODY);
}

function field(view, id, f) {
    return view[id * FLOATS_PER_BODY + f];
}

function assertInBounds(view, id, testName, tick) {
    const x = field(view, id, F.PX);
    const y = field(view, id, F.PY);
    const z = field(view, id, F.PZ);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
            `${testName}: body ${id} became non-finite at tick ${tick}: (${x}, ${y}, ${z})`
        );
    }
    if (
        x < BOUNDS.minX ||
        x > BOUNDS.maxX ||
        y < BOUNDS.minY ||
        y > BOUNDS.maxY ||
        z < BOUNDS.minZ ||
        z > BOUNDS.maxZ
    ) {
        throw new Error(
            `${testName}: body ${id} left world bounds at tick ${tick}: (${x}, ${y}, ${z})`
        );
    }
}

// -----------------------------------------------------------------------------

function testSpawnDespawn(exports) {
    console.log('Test 1: spawn / despawn / capacity cap');
    exports.initRigidBodySystem();

    check(
        exports.rbCapacity() === MAX_DYNAMIC_BODIES,
        `capacity should be ${MAX_DYNAMIC_BODIES}, got ${exports.rbCapacity()}`
    );
    check(exports.rbCount() === 0, 'pool should start empty');

    const ids = [];
    for (let i = 0; i < MAX_DYNAMIC_BODIES; i++) {
        const id = exports.rbSpawn(SHAPE_SPHERE, i * 0.1, 10, 0, 1, 0.4, 0.3, 0.5, 0.5, 0.5, i);
        check(id >= 0, `spawn ${i} should succeed`);
        ids.push(id);
    }
    check(exports.rbCount() === MAX_DYNAMIC_BODIES, 'pool should be full');

    const overflow = exports.rbSpawn(SHAPE_SPHERE, 0, 10, 0, 1, 0.4, 0.3, 0.5, 0.5, 0.5, 999);
    check(overflow === -1, `spawn past MAX_DYNAMIC_BODIES must return -1, got ${overflow}`);

    exports.rbDespawn(ids[0]);
    check(exports.rbCount() === MAX_DYNAMIC_BODIES - 1, 'despawn should decrement the count');

    // Double-despawn must not corrupt the count.
    exports.rbDespawn(ids[0]);
    check(exports.rbCount() === MAX_DYNAMIC_BODIES - 1, 'double despawn must be a no-op');

    // Out-of-range ids must be ignored, not trap.
    exports.rbDespawn(-1);
    exports.rbDespawn(9999);
    check(exports.rbCount() === MAX_DYNAMIC_BODIES - 1, 'invalid despawn must be a no-op');

    const reused = exports.rbSpawn(SHAPE_SPHERE, 0, 10, 0, 1, 0.4, 0.3, 0.5, 0.5, 0.5, 1234);
    check(reused === ids[0], `freed slot should be reused (expected ${ids[0]}, got ${reused})`);

    exports.rbClear();
    check(exports.rbCount() === 0, 'rbClear should empty the pool');

    if (failures === 0) console.log('  ✓ pool lifecycle behaves');
}

function testGravitySettleAndSleep(exports) {
    console.log('Test 2: bodies fall, settle on terrain, and go to sleep');
    const ptr = exports.initRigidBodySystem();
    const view = makeView(exports, ptr);

    const ids = [];
    for (let i = 0; i < 8; i++) {
        ids.push(
            exports.rbSpawn(
                SHAPE_SPHERE,
                -12 + i * 3.5,
                40 + i,
                6,
                1.5,
                0.35,
                0.5,
                0.6,
                0.6,
                0.6,
                i
            )
        );
    }

    const dt = 1 / 60;
    for (let tick = 0; tick < 900; tick++) {
        // 15 simulated seconds
        exports.stepRigidBodies(dt, tick * dt * 1000);
        for (const id of ids) assertInBounds(view, id, 'settle', tick);
    }

    check(
        exports.rbAwakeCount() === 0,
        `all bodies should sleep after settling, ${exports.rbAwakeCount()} still awake`
    );

    for (const id of ids) {
        check(exports.rbIsSleeping(id) === 1, `body ${id} should be asleep`);
        const speed = Math.hypot(
            field(view, id, F.VX),
            field(view, id, F.VY),
            field(view, id, F.VZ)
        );
        check(speed === 0, `sleeping body ${id} should have zero velocity, got ${speed}`);
    }

    if (failures === 0) console.log('  ✓ 8 bodies settled and slept within 15s');
}

function testExtremeImpulses(exports) {
    console.log('Test 3: abusive impulses stay in bounds and finite');
    const ptr = exports.initRigidBodySystem();
    const view = makeView(exports, ptr);

    const shapes = [SHAPE_SPHERE, SHAPE_CAPSULE, SHAPE_BOX];
    const ids = [];
    for (let i = 0; i < 24; i++) {
        ids.push(
            exports.rbSpawn(
                shapes[i % 3],
                (i % 6) * 2 - 6,
                5 + i * 0.5,
                Math.floor(i / 6) * 2 - 3,
                0.5 + (i % 4),
                0.6,
                0.25,
                0.5,
                0.5,
                0.5,
                i
            )
        );
    }

    const dt = 1 / 60;
    for (let tick = 0; tick < 1200; tick++) {
        // Every half second, slam everything with a huge impulse in a random
        // direction — well past anything gameplay would produce.
        if (tick % 30 === 0) {
            for (const id of ids) {
                exports.rbApplyImpulse(
                    id,
                    (Math.random() - 0.5) * 4000,
                    (Math.random() - 0.5) * 4000,
                    (Math.random() - 0.5) * 4000
                );
            }
        }
        exports.stepRigidBodies(dt, tick * dt * 1000);
        for (const id of ids) assertInBounds(view, id, 'extreme-impulse', tick);
    }

    if (failures === 0) console.log('  ✓ 24 bodies survived 20s of 4000-unit impulses');
}

function testRadialImpulseAndWake(exports) {
    console.log('Test 4: radial impulse wakes sleeping bodies');
    const ptr = exports.initRigidBodySystem();
    const view = makeView(exports, ptr);

    const ids = [];
    for (let i = 0; i < 6; i++) {
        ids.push(exports.rbSpawn(SHAPE_SPHERE, i * 2 - 5, 12, 0, 1, 0.3, 0.5, 0.5, 0.5, 0.5, i));
    }

    const dt = 1 / 60;
    for (let tick = 0; tick < 900; tick++) exports.stepRigidBodies(dt, tick * dt * 1000);
    check(exports.rbAwakeCount() === 0, 'bodies should be asleep before the blast');

    const cx = field(view, ids[0], F.PX);
    const cy = field(view, ids[0], F.PY);
    const cz = field(view, ids[0], F.PZ);
    const hit = exports.rbApplyRadialImpulse(cx, cy, cz, 30, 40, 0.6);
    check(hit === ids.length, `blast should reach all ${ids.length} bodies, hit ${hit}`);

    exports.stepRigidBodies(dt, 900 * dt * 1000);
    check(exports.rbAwakeCount() > 0, 'blast should have woken bodies');

    // A blast centred exactly on a body must not produce a NaN direction.
    for (let tick = 0; tick < 600; tick++) {
        exports.stepRigidBodies(dt, (900 + tick) * dt * 1000);
        for (const id of ids) assertInBounds(view, id, 'radial', tick);
    }

    if (failures === 0) console.log('  ✓ radial impulse woke and displaced bodies safely');
}

function testPlayerProxyIsOneWay(exports) {
    console.log('Test 5: player proxy pushes bodies without being modified');
    const ptr = exports.initRigidBodySystem();
    const view = makeView(exports, ptr);

    const id = exports.rbSpawn(SHAPE_SPHERE, 0, 2, 0, 1, 0.2, 0.5, 0.5, 0.5, 0.5, 0);
    const dt = 1 / 60;
    for (let tick = 0; tick < 600; tick++) exports.stepRigidBodies(dt, tick * dt * 1000);

    const restX = field(view, id, F.PX);
    const restZ = field(view, id, F.PZ);
    const bodyY = field(view, id, F.PY);

    // Walk the player capsule into the body from -X at 6 u/s.
    let px = restX - 3;
    for (let tick = 0; tick < 120; tick++) {
        px += 6 * dt;
        exports.rbSetPlayerProxy(px, bodyY + 1.4, restZ, 0.5, 1.8, 6, 0, 0);
        exports.stepRigidBodies(dt, (600 + tick) * dt * 1000);
        assertInBounds(view, id, 'player-proxy', tick);
    }

    const movedX = field(view, id, F.PX) - restX;
    check(movedX > 0.25, `player should have shoved the body along +X, moved ${movedX.toFixed(3)}`);
    check(Math.abs(field(view, id, F.PZ) - restZ) < 2.0, 'body should not fly sideways');

    exports.rbDisablePlayerProxy();
    if (failures === 0)
        console.log(`  ✓ body pushed ${movedX.toFixed(2)} units by the player capsule`);
}

function testDeterminismAndEnergyDecay(exports) {
    console.log('Test 6: deterministic and non-divergent over a long run');
    const dt = 1 / 60;

    const run = () => {
        const ptr = exports.initRigidBodySystem();
        const view = makeView(exports, ptr);
        const ids = [];
        for (let i = 0; i < 12; i++) {
            ids.push(
                exports.rbSpawn(
                    SHAPE_SPHERE,
                    i * 1.1 - 6,
                    20 + i,
                    i * 0.7 - 4,
                    1 + i * 0.1,
                    0.5,
                    0.4,
                    0.6,
                    0.6,
                    0.6,
                    i
                )
            );
        }
        for (const id of ids) exports.rbApplyImpulse(id, 12 - id * 0.5, 9, -7 + id * 0.5);
        for (let tick = 0; tick < 1800; tick++) {
            // 30 simulated seconds
            exports.stepRigidBodies(dt, tick * dt * 1000);
            for (const id of ids) assertInBounds(view, id, 'long-run', tick);
        }
        return ids.map((id) => [
            field(view, id, F.PX),
            field(view, id, F.PY),
            field(view, id, F.PZ),
        ]);
    };

    const a = run();
    const b = run();
    for (let i = 0; i < a.length; i++) {
        for (let k = 0; k < 3; k++) {
            check(
                a[i][k] === b[i][k],
                `run should be deterministic — body ${i} axis ${k}: ${a[i][k]} vs ${b[i][k]}`
            );
        }
    }

    // After 30s everything must have come to rest: no energy injection.
    check(
        exports.rbAwakeCount() === 0,
        `long run should end fully asleep, ${exports.rbAwakeCount()} awake`
    );

    if (failures === 0) console.log('  ✓ 12 bodies, 30s, deterministic and fully settled');
}

function testHitchAndZeroDelta(exports) {
    console.log('Test 7: hitch / zero / negative deltas are handled');
    const ptr = exports.initRigidBodySystem();
    const view = makeView(exports, ptr);
    const id = exports.rbSpawn(SHAPE_BOX, 0, 30, 0, 2, 0.4, 0.4, 0.7, 0.7, 0.7, 0);

    exports.stepRigidBodies(0, 0);
    assertInBounds(view, id, 'zero-dt', 0);
    exports.stepRigidBodies(-1, 0);
    assertInBounds(view, id, 'negative-dt', 0);

    // A 5-second tab-restore hitch must not teleport the body through the world.
    for (let tick = 0; tick < 20; tick++) {
        exports.stepRigidBodies(5.0, tick * 5000);
        assertInBounds(view, id, 'hitch', tick);
    }

    if (failures === 0) console.log('  ✓ degenerate deltas clamped, no tunnelling');
}

async function runAllTests() {
    console.log('🍬 Candy World Rigid-Body Solver Test');
    console.log('=====================================\n');

    try {
        const instance = await loadWasm();
        const exports = instance.exports;

        const required = [
            'initRigidBodySystem',
            'rbSpawn',
            'rbDespawn',
            'rbClear',
            'stepRigidBodies',
            'rbApplyImpulse',
            'rbApplyRadialImpulse',
            'rbSetPlayerProxy',
            'rbCount',
            'rbCapacity',
            'rbAwakeCount',
            'rbIsSleeping',
        ];
        const missing = required.filter((n) => typeof exports[n] !== 'function');
        if (missing.length) throw new Error(`missing WASM exports: ${missing.join(', ')}`);

        testSpawnDespawn(exports);
        testGravitySettleAndSleep(exports);
        testExtremeImpulses(exports);
        testRadialImpulseAndWake(exports);
        testPlayerProxyIsOneWay(exports);
        testDeterminismAndEnergyDecay(exports);
        testHitchAndZeroDelta(exports);

        console.log();
        if (failures > 0) {
            console.error(`❌ ${failures} assertion(s) failed`);
            return false;
        }
        console.log('✅ All rigid-body tests passed!');
        return true;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        return false;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().then((ok) => process.exit(ok ? 0 : 1));
}

export default runAllTests;

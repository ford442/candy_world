// tests/joints.mjs
// Constraint-solver test (assembly/joints.ts).
//
// Same spirit as tests/rigid-body.mjs: the acceptance bar is *stability*, not
// physical exactness. A hinge swing must stay on its arc at 60 Hz, a spring
// must not diverge anywhere in the documented stiffness range, and no joint may
// let a body escape the world bounds or go non-finite.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors RB_* in assembly/constants.ts
const BOUNDS = {
    minX: -128.0, maxX: 128.0,
    minY: -100.0, maxY: 500.0,
    minZ: -128.0, maxZ: 128.0,
};

const MAX_DYNAMIC_BODIES = 64;
const FLOATS_PER_BODY = 16;
const MAX_JOINTS = 64;

const SHAPE_SPHERE = 0;

// Mirrors the F_* / RB_F_* constants in assembly/constants.ts
const F = { PX: 0, PY: 1, PZ: 2, VX: 3, VY: 4, VZ: 5, FLAGS: 13 };

// Mirrors JOINT_* in assembly/joints.ts
const JOINT_FIXED = 0;
const JOINT_HINGE = 1;
const JOINT_SPRING = 2;

const DT = 1 / 60;

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

/** The pools are managed StaticArrays, so addresses are only valid post-init. */
function makeView(exports, ptr, floats) {
    return new Float32Array(exports.memory.buffer, ptr, floats);
}

function field(view, id, f) {
    return view[id * FLOATS_PER_BODY + f];
}

function pos(view, id) {
    return [field(view, id, F.PX), field(view, id, F.PY), field(view, id, F.PZ)];
}

function assertSane(view, id, testName, tick) {
    const [x, y, z] = pos(view, id);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`${testName}: body ${id} became non-finite at tick ${tick}: (${x}, ${y}, ${z})`);
    }
    if (
        x < BOUNDS.minX || x > BOUNDS.maxX ||
        y < BOUNDS.minY || y > BOUNDS.maxY ||
        z < BOUNDS.minZ || z > BOUNDS.maxZ
    ) {
        throw new Error(`${testName}: body ${id} left world bounds at tick ${tick}: (${x}, ${y}, ${z})`);
    }
}

/**
 * Reset both pools. Bodies are spawned high above the terrain so the ground
 * contact never interferes with what the constraint is doing.
 */
function reset(exports) {
    const bodyPtr = exports.initRigidBodySystem();
    return makeView(exports, bodyPtr, MAX_DYNAMIC_BODIES * FLOATS_PER_BODY);
}

// -----------------------------------------------------------------------------

function testJointLifecycle(exports) {
    console.log('Test 1: create / destroy / capacity cap / dangling refs');
    reset(exports);

    check(exports.jointCapacity() === MAX_JOINTS,
        `capacity should be ${MAX_JOINTS}, got ${exports.jointCapacity()}`);
    check(exports.jointCount() === 0, 'joint pool should start empty');

    // A joint needs a real body on at least one end.
    check(exports.jointCreateHinge(-1, -1, 0, 50, 0, 0, 0, 1) === -1,
        'hinge with no body must be rejected');

    const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, 60, 0, 0, 0, 0, 0.3, 0.3, 0.3, 0); // kinematic
    const bob = exports.rbSpawn(SHAPE_SPHERE, 2, 60, 0, 1, 0.2, 0.4, 0.4, 0.4, 0.4, 1);

    // Two immovable ends have nothing to solve.
    const anchor2 = exports.rbSpawn(SHAPE_SPHERE, 5, 60, 0, 0, 0, 0, 0.3, 0.3, 0.3, 2);
    check(exports.jointCreateFixed(anchor, anchor2) === -1,
        'a joint between two kinematic bodies must be rejected');
    exports.rbDespawn(anchor2);

    // Out-of-range body ids must be rejected, not trap.
    check(exports.jointCreateHinge(9999, bob, 0, 60, 0, 0, 0, 1) === -1,
        'out-of-range body id must be rejected');
    check(exports.jointCreateHinge(anchor, 9999, 0, 60, 0, 0, 0, 1) === -1,
        'out-of-range body B must be rejected');

    const j = exports.jointCreateHinge(anchor, bob, 0, 60, 0, 0, 0, 1);
    check(j >= 0, 'valid hinge should be created');
    check(exports.jointCount() === 1, 'joint count should be 1');

    exports.jointDestroy(j);
    check(exports.jointCount() === 0, 'destroy should decrement the count');
    exports.jointDestroy(j);
    exports.jointDestroy(-1);
    exports.jointDestroy(9999);
    check(exports.jointCount() === 0, 'double / invalid destroy must be a no-op');

    // Fill the *joint* pool. Bodies are the scarcer resource (also 64, two of
    // which are already spent), so stack several springs onto each bob.
    const bobs = [];
    for (let i = 0; i < 8; i++) {
        bobs.push(exports.rbSpawn(SHAPE_SPHERE, i * 0.1, 60, 3, 1, 0.2, 0.4, 0.2, 0.2, 0.2, i));
    }
    for (let i = 0; i < MAX_JOINTS; i++) {
        check(exports.jointCreateSpring(anchor, bobs[i % bobs.length], 1.5, 200, 8) >= 0,
            `spring ${i} should be created`);
    }
    check(exports.jointCount() === MAX_JOINTS, 'joint pool should be full');
    check(exports.jointCreateSpring(anchor, bobs[0], 1.5, 200, 8) === -1,
        'create past MAX_JOINTS must return -1');

    // Despawning a body must take its joints with it.
    const perBob = MAX_JOINTS / bobs.length;
    exports.rbDespawn(bobs[0]);
    check(exports.jointCount() === MAX_JOINTS - perBob,
        `despawning a body should drop all ${perBob} of its joints, count is ${exports.jointCount()}`);

    // ...and the freed slot must be reusable.
    const fresh = exports.rbSpawn(SHAPE_SPHERE, 0, 60, 3, 1, 0.2, 0.4, 0.2, 0.2, 0.2, 0);
    check(exports.jointCreateSpring(anchor, fresh, 1.5, 200, 8) >= 0, 'freed joint slot should be reused');

    exports.rbClear();
    check(exports.jointCount() === 0, 'rbClear should also clear joints');

    if (failures === 0) console.log('  ✓ joint lifecycle behaves');
}

function testHingeSwingIsStable(exports) {
    console.log('Test 2: hinge swing is stable at 60 Hz (golden step + 60s run)');
    const view = reset(exports);

    // A pivot on a kinematic "beam" at y = 60, with a 3-unit arm out along +X.
    // Axis +Z => the seat swings in the XY plane, like a real swing.
    const PIVOT = [0, 60, 0];
    const ARM = 3.0;
    const pivotBody = exports.rbSpawn(SHAPE_SPHERE, PIVOT[0], PIVOT[1], PIVOT[2], 0, 0, 0, 0.2, 0.2, 0.2, 0);
    const seat = exports.rbSpawn(SHAPE_SPHERE, PIVOT[0] + ARM, PIVOT[1], PIVOT[2], 2.0, 0.2, 0.4, 0.5, 0.5, 0.5, 1);

    const j = exports.jointCreateHinge(pivotBody, seat, PIVOT[0], PIVOT[1], PIVOT[2], 0, 0, 1);
    check(j >= 0, 'hinge should be created');

    // --- Golden step: 12 frames (0.2s) from the horizontal release -----------
    // Released horizontally, the seat must swing *down and inward*: it stays on
    // the arc (radius unchanged), gains -Y velocity, and loses no radius to the
    // integrator. These are the numbers a regression would move.
    //
    // 12 frames, not 1: after a single frame the inward travel is ~4e-7 units,
    // which is below f32 resolution at |x| = 3 and so is not observable.
    const GOLDEN_FRAMES = 12;
    for (let tick = 0; tick < GOLDEN_FRAMES; tick++) {
        exports.stepRigidBodies(DT, tick * DT * 1000);
    }
    const [gx, gy, gz] = pos(view, seat);
    const gRadius = Math.hypot(gx - PIVOT[0], gy - PIVOT[1]);
    check(Math.abs(gRadius - ARM) < 1e-3,
        `after one frame the seat must still be at r=${ARM}, got ${gRadius.toFixed(6)}`);
    // Free swing from horizontal: after 0.2s the analytic drop is ~ 1/2*g*t^2
    // = 0.44, tempered by the arc constraint. Bracket it rather than pinning it.
    check(gy < PIVOT[1] - 0.3 && gy > PIVOT[1] - 0.6,
        `seat should have dropped ~0.44 in 0.2s, y offset ${(gy - PIVOT[1]).toFixed(6)}`);
    check(gx < PIVOT[0] + ARM - 0.01,
        `seat should have swung inward along X, x offset ${(gx - PIVOT[0]).toFixed(6)}`);
    check(Math.abs(gz - PIVOT[2]) < 1e-4,
        `seat must stay in the hinge plane, z drift ${(gz - PIVOT[2]).toFixed(8)}`);
    check(field(view, seat, F.VY) < 0, 'seat should be moving downward after one frame');

    // --- Long run: 60 simulated seconds --------------------------------------
    let maxRadiusError = 0;
    let maxPlaneDrift = 0;
    let maxSpeed = 0;
    let lowest = Infinity;

    for (let tick = GOLDEN_FRAMES; tick < 3600; tick++) {
        exports.stepRigidBodies(DT, tick * DT * 1000);
        assertSane(view, seat, 'hinge-swing', tick);

        const [x, y, z] = pos(view, seat);
        maxRadiusError = Math.max(maxRadiusError, Math.abs(Math.hypot(x - PIVOT[0], y - PIVOT[1]) - ARM));
        maxPlaneDrift = Math.max(maxPlaneDrift, Math.abs(z - PIVOT[2]));
        maxSpeed = Math.max(maxSpeed, Math.hypot(
            field(view, seat, F.VX), field(view, seat, F.VY), field(view, seat, F.VZ)
        ));
        lowest = Math.min(lowest, y);

        // The pivot body must never be dragged by the seat it carries.
        const [px, py, pz] = pos(view, pivotBody);
        if (px !== PIVOT[0] || py !== PIVOT[1] || pz !== PIVOT[2]) {
            throw new Error(`hinge-swing: kinematic pivot moved at tick ${tick}: (${px}, ${py}, ${pz})`);
        }
    }

    check(maxRadiusError < 0.02,
        `seat must stay on its arc over 60s, max radius error ${maxRadiusError.toFixed(5)}`);
    check(maxPlaneDrift < 1e-3,
        `seat must stay in the hinge plane over 60s, max drift ${maxPlaneDrift.toFixed(8)}`);
    // Free-fall from horizontal onto a 3m arm peaks near sqrt(2*g*r) ~= 11.5 u/s.
    // Anything much above that is the solver injecting energy, not gravity.
    check(maxSpeed < 16.0, `swing speed must stay bounded, peaked at ${maxSpeed.toFixed(2)} u/s`);
    check(lowest > PIVOT[1] - ARM - 0.02,
        `seat must never drop below the bottom of its arc, lowest ${lowest.toFixed(4)}`);
    check(exports.jointGetError(j) < 0.01,
        `hinge should end satisfied, error ${exports.jointGetError(j).toFixed(6)}`);

    if (failures === 0) {
        console.log(`  ✓ 60s swing: radius error <= ${maxRadiusError.toFixed(5)}, peak ${maxSpeed.toFixed(2)} u/s`);
    }
}

function testHingeDampsToRest(exports) {
    console.log('Test 3: a swing loses energy and settles at the bottom of its arc');
    const view = reset(exports);

    const PIVOT = [0, 60, 0];
    const ARM = 2.5;
    const pivotBody = exports.rbSpawn(SHAPE_SPHERE, ...PIVOT, 0, 0, 0, 0.2, 0.2, 0.2, 0);
    const seat = exports.rbSpawn(SHAPE_SPHERE, PIVOT[0] + ARM, PIVOT[1], PIVOT[2], 1.5, 0.2, 0.4, 0.4, 0.4, 0.4, 1);
    exports.jointCreateHinge(pivotBody, seat, ...PIVOT, 0, 0, 1);

    // 5 minutes: linear damping is only 6%/s, so settling genuinely takes a while.
    for (let tick = 0; tick < 18000; tick++) {
        exports.stepRigidBodies(DT, tick * DT * 1000);
        if (tick % 600 === 0) assertSane(view, seat, 'hinge-damping', tick);
    }

    const [x, y] = pos(view, seat);
    const speed = Math.hypot(field(view, seat, F.VX), field(view, seat, F.VY), field(view, seat, F.VZ));
    check(speed < 0.5, `swing should have bled off its energy, still moving at ${speed.toFixed(3)} u/s`);
    check(y < PIVOT[1] - ARM + 0.1,
        `swing should hang at the bottom of its arc, y offset ${(y - PIVOT[1]).toFixed(3)}`);
    check(Math.abs(x - PIVOT[0]) < 0.3, `swing should hang under the pivot, x offset ${(x - PIVOT[0]).toFixed(3)}`);

    if (failures === 0) console.log(`  ✓ settled hanging ${(PIVOT[1] - y).toFixed(3)} below the pivot`);
}

function testSpringStiffnessSweep(exports) {
    console.log('Test 4: springs stay bounded across the documented k range');

    const ANCHOR_Y = 80;
    const START_Y = 74;
    const REST = 2.0;
    const MASS = 1.0;
    const G = 22.0; // GRAVITY in assembly/rigidbody.ts

    /**
     * @param k        stiffness
     * @param c        damping
     * @param maxLength largest anchor-to-bob distance allowed. `null` means the
     *                  case is out of the documented range and only has to stay
     *                  sane (finite, in bounds, under the speed cap).
     */
    const run = (k, c, maxLength) => {
        const view = reset(exports);
        const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, ANCHOR_Y, 0, 0, 0, 0, 0.2, 0.2, 0.2, 0);
        // Start well away from rest length so the spring has real work to do.
        const bob = exports.rbSpawn(SHAPE_SPHERE, 0, START_Y, 0, MASS, 0.2, 0.0, 0.4, 0.4, 0.4, 1);
        const j = exports.jointCreateSpring(anchor, bob, REST, k, c);
        check(j >= 0, `spring k=${k} c=${c} should be created`);

        let maxSpeed = 0;
        let peakLength = 0;
        for (let tick = 0; tick < 1800; tick++) { // 30s
            exports.stepRigidBodies(DT, tick * DT * 1000);
            assertSane(view, bob, `spring-k${k}`, tick);
            maxSpeed = Math.max(maxSpeed, Math.hypot(
                field(view, bob, F.VX), field(view, bob, F.VY), field(view, bob, F.VZ)
            ));
            peakLength = Math.max(peakLength, ANCHOR_Y - field(view, bob, F.PY));
        }

        // Nothing a joint writes may exceed the body layer's own speed clamp —
        // above it a substep travels further than a body radius and tunnels.
        check(maxSpeed < 80, `spring k=${k} c=${c} must stay under the speed clamp, peaked ${maxSpeed.toFixed(1)}`);
        if (maxLength !== null) {
            check(peakLength < maxLength,
                `spring k=${k} c=${c} must not gain energy: peak length ${peakLength.toFixed(2)} >= ${maxLength.toFixed(2)}`);
        }
        return { maxSpeed, peakLength };
    };

    // Documented range (docs/PERF_BUDGETS.md): k in [10, 4000], damping in
    // [0, 400]. An undamped spring oscillates forever, which is fine — the
    // failure mode under test is *divergence*, so the bound is the initial
    // length plus a margin for the static sag m*g/k, not convergence.
    for (const { k, c } of [
        { k: 10, c: 0 }, { k: 50, c: 2 }, { k: 200, c: 8 }, { k: 800, c: 20 },
        { k: 2000, c: 40 }, { k: 4000, c: 60 }, { k: 4000, c: 0 }, { k: 4000, c: 400 },
    ]) {
        const sag = (MASS * G) / k;
        run(k, c, (ANCHOR_Y - START_Y) + 2 * sag + 0.5);
    }

    // Out of range: must soft-limit, not explode. k <= 0 is "no spring", so the
    // bob simply free-falls to the terrain — sanity is the whole assertion.
    for (const { k, c } of [{ k: 1e6, c: 0 }, { k: 1e9, c: 1e9 }, { k: -5, c: -5 }, { k: 0, c: 0 }]) {
        run(k, c, null);
    }

    if (failures === 0) console.log('  ✓ 12 stiffness/damping configs stayed bounded over 30s each');
}

function testSpringConvergesToRest(exports) {
    console.log('Test 5: a damped spring converges to its rest length');
    const view = reset(exports);

    const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, 80, 0, 0, 0, 0, 0.2, 0.2, 0.2, 0);
    const bob = exports.rbSpawn(SHAPE_SPHERE, 0, 76, 0, 1.0, 0.2, 0.0, 0.4, 0.4, 0.4, 1);
    // k = 300 N/m on 1 kg hanging under g = 22 => sag = m*g/k = 0.073 units.
    const j = exports.jointCreateSpring(anchor, bob, 2.0, 300, 25);

    for (let tick = 0; tick < 1200; tick++) exports.stepRigidBodies(DT, tick * DT * 1000);

    const length = 80 - field(view, bob, F.PY);
    const expected = 2.0 + (1.0 * 22.0) / 300.0;
    check(Math.abs(length - expected) < 0.05,
        `damped spring should hang at rest + sag ~= ${expected.toFixed(3)}, got ${length.toFixed(3)}`);
    check(exports.jointGetError(j) < 0.15, `residual error ${exports.jointGetError(j).toFixed(4)}`);

    if (failures === 0) console.log(`  ✓ converged to ${length.toFixed(3)} (analytic ${expected.toFixed(3)})`);
}

function testFixedJointHoldsOffset(exports) {
    console.log('Test 6: a fixed joint preserves the bind-time offset');
    const view = reset(exports);

    // Two free-falling bodies welded together, then blasted apart.
    const a = exports.rbSpawn(SHAPE_SPHERE, 0, 90, 0, 1.0, 0.2, 0.4, 0.4, 0.4, 0.4, 0);
    const b = exports.rbSpawn(SHAPE_SPHERE, 1.5, 90, 0.5, 3.0, 0.2, 0.4, 0.4, 0.4, 0.4, 1);
    const j = exports.jointCreateFixed(a, b);
    check(j >= 0, 'fixed joint should be created');

    const want = [
        field(view, b, F.PX) - field(view, a, F.PX),
        field(view, b, F.PY) - field(view, a, F.PY),
        field(view, b, F.PZ) - field(view, a, F.PZ),
    ];

    let maxDrift = 0;
    for (let tick = 0; tick < 1800; tick++) {
        if (tick % 120 === 0) {
            // Kick only one end: the weld has to carry the other along.
            exports.rbApplyImpulse(a, 60, 90, -40);
        }
        exports.stepRigidBodies(DT, tick * DT * 1000);
        assertSane(view, a, 'fixed', tick);
        assertSane(view, b, 'fixed', tick);
        maxDrift = Math.max(maxDrift, Math.hypot(
            field(view, b, F.PX) - field(view, a, F.PX) - want[0],
            field(view, b, F.PY) - field(view, a, F.PY) - want[1],
            field(view, b, F.PZ) - field(view, a, F.PZ) - want[2]
        ));
    }

    // Contacts and the world clamp are allowed the last word, so this is a
    // "holds together" bound, not an exact equality.
    check(maxDrift < 0.35, `welded offset should hold, max drift ${maxDrift.toFixed(4)}`);
    if (failures === 0) console.log(`  ✓ weld held to ${maxDrift.toFixed(4)} units over 30s of impulses`);
}

function testJointsSurviveAbuse(exports) {
    console.log('Test 7: degenerate joints and abusive impulses stay finite');
    const view = reset(exports);

    const ids = [];
    const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 0, 0, 0, 0.3, 0.3, 0.3, 0);

    // Coincident anchors, zero-length arm, zero axis, zero rest length: every
    // degenerate case that could produce a 0/0 normal.
    const coincident = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 1, 0.4, 0.3, 0.3, 0.3, 0.3, 1);
    ids.push(coincident);
    check(exports.jointCreateHinge(anchor, coincident, 0, 70, 0, 0, 0, 0) >= 0,
        'hinge with a degenerate axis should still be created (axis falls back to up)');

    const zeroRest = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 1, 0.4, 0.3, 0.3, 0.3, 0.3, 2);
    ids.push(zeroRest);
    check(exports.jointCreateSpring(anchor, zeroRest, 0, 500, 10) >= 0, 'zero-rest spring should be created');

    const welded = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 1, 0.4, 0.3, 0.3, 0.3, 0.3, 3);
    ids.push(welded);
    check(exports.jointCreateFixed(anchor, welded) >= 0, 'zero-offset weld should be created');

    // A chain, to check that sequential projection does not amplify.
    let prev = anchor;
    for (let i = 0; i < 6; i++) {
        const link = exports.rbSpawn(SHAPE_SPHERE, 1 + i, 70, 5, 1, 0.4, 0.3, 0.3, 0.3, 0.3, 10 + i);
        ids.push(link);
        exports.jointCreateHinge(prev, link, i, 70, 5, 0, 0, 1);
        prev = link;
    }

    for (let tick = 0; tick < 1800; tick++) {
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
        exports.stepRigidBodies(DT, tick * DT * 1000);
        for (const id of ids) assertSane(view, id, 'joint-abuse', tick);
    }

    // Hitches and degenerate deltas must not tunnel a constrained body either.
    exports.stepRigidBodies(0, 0);
    exports.stepRigidBodies(-1, 0);
    for (let tick = 0; tick < 20; tick++) {
        exports.stepRigidBodies(5.0, tick * 5000);
        for (const id of ids) assertSane(view, id, 'joint-hitch', tick);
    }

    if (failures === 0) console.log(`  ✓ ${ids.length} constrained bodies survived 30s of 4000-unit impulses + hitches`);
}

function testDeterminism(exports) {
    console.log('Test 8: constrained simulation is deterministic');

    const run = () => {
        const view = reset(exports);
        const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 0, 0, 0, 0.3, 0.3, 0.3, 0);
        const out = [];
        const ids = [];
        for (let i = 0; i < 5; i++) {
            const b = exports.rbSpawn(SHAPE_SPHERE, 2 + i * 0.5, 70 - i, i * 0.3, 1 + i * 0.2,
                0.3, 0.4, 0.3, 0.3, 0.3, i + 1);
            ids.push(b);
            if (i % 2 === 0) exports.jointCreateHinge(anchor, b, 0, 70, 0, 0, 0, 1);
            else exports.jointCreateSpring(anchor, b, 2 + i, 250, 12);
            exports.rbApplyImpulse(b, 8 - i, 5, -3 + i);
        }
        for (let tick = 0; tick < 1800; tick++) {
            exports.stepRigidBodies(DT, tick * DT * 1000);
            for (const id of ids) assertSane(view, id, 'determinism', tick);
        }
        for (const id of ids) out.push(pos(view, id));
        return out;
    };

    const a = run();
    const b = run();
    for (let i = 0; i < a.length; i++) {
        for (let k = 0; k < 3; k++) {
            check(a[i][k] === b[i][k],
                `run should be deterministic — body ${i} axis ${k}: ${a[i][k]} vs ${b[i][k]}`);
        }
    }

    if (failures === 0) console.log('  ✓ 5 constrained bodies, 30s, bit-identical across runs');
}

function testDisabledWhenLayerOff(exports) {
    console.log('Test 9: joints are inert without live bodies');

    // rbClear() drops every joint, and stepping an empty world must be a no-op
    // rather than touching a stale constraint.
    reset(exports);
    const anchor = exports.rbSpawn(SHAPE_SPHERE, 0, 70, 0, 0, 0, 0, 0.3, 0.3, 0.3, 0);
    const bob = exports.rbSpawn(SHAPE_SPHERE, 2, 70, 0, 1, 0.3, 0.4, 0.3, 0.3, 0.3, 1);
    exports.jointCreateHinge(anchor, bob, 0, 70, 0, 0, 0, 1);
    check(exports.jointCount() === 1, 'joint should exist before the clear');

    exports.rbClear();
    check(exports.jointCount() === 0, 'rbClear must leave no joints behind');
    for (let tick = 0; tick < 60; tick++) exports.stepRigidBodies(DT, tick * DT * 1000);
    check(exports.rbCount() === 0 && exports.jointCount() === 0, 'empty world should stay empty');

    // A reinit must not resurrect anything either.
    reset(exports);
    check(exports.jointCount() === 0, 'initRigidBodySystem must rebind and clear the joint pool');

    if (failures === 0) console.log('  ✓ joints disabled cleanly with the body layer');
}

async function runAllTests() {
    console.log('🍬 Candy World Joint Solver Test');
    console.log('================================\n');

    try {
        const instance = await loadWasm();
        const exports = instance.exports;

        const required = [
            'initJointSystem', 'jointCreate', 'jointCreateFixed', 'jointCreateHinge',
            'jointCreateSpring', 'jointDestroy', 'jointsClear', 'jointCount',
            'jointCapacity', 'jointGetError', 'jointSetSoftness', 'solveJoints',
        ];
        const missing = required.filter((n) => typeof exports[n] !== 'function');
        if (missing.length) throw new Error(`missing WASM exports: ${missing.join(', ')}`);

        check(exports.JOINT_FIXED?.valueOf() === JOINT_FIXED, 'JOINT_FIXED should be 0');
        check(exports.JOINT_HINGE?.valueOf() === JOINT_HINGE, 'JOINT_HINGE should be 1');
        check(exports.JOINT_SPRING?.valueOf() === JOINT_SPRING, 'JOINT_SPRING should be 2');

        testJointLifecycle(exports);
        testHingeSwingIsStable(exports);
        testHingeDampsToRest(exports);
        testSpringStiffnessSweep(exports);
        testSpringConvergesToRest(exports);
        testFixedJointHoldsOffset(exports);
        testJointsSurviveAbuse(exports);
        testDeterminism(exports);
        testDisabledWhenLayerOff(exports);

        console.log();
        if (failures > 0) {
            console.error(`❌ ${failures} assertion(s) failed`);
            return false;
        }
        console.log('✅ All joint tests passed!');
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

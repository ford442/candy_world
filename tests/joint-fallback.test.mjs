// tests/joint-fallback.test.mjs
// Parity check for the pure-JS constraint solver (src/systems/physics/joint-fallback.ts).
//
// The fallback runs whenever WASM is unavailable, so it is a second full
// implementation of the same algorithm rather than a stub. This asserts it
// behaves like the AssemblyScript original on the properties that matter:
// a hinge swing stays on its arc, a damped spring converges to rest + sag, and
// a weld holds its bind-time offset.
//
// Run with tsx (the solver modules are TypeScript): npm run test:joint-fallback

import { stepRigidBodiesJS } from '../src/systems/physics/rigid-body-fallback.ts';
import {
    solveJointsJS,
    writeJointRecord,
    createJointPool,
} from '../src/systems/physics/joint-fallback.ts';
import {
    JOINT_TYPE,
    J_FIELD as J,
    J_FLOATS_PER_JOINT,
} from '../src/systems/physics/joint-types.ts';
import {
    MAX_DYNAMIC_BODIES,
    RB_FIELD as F,
    RB_FLAG,
    RB_FLOATS_PER_BODY,
    RB_SHAPE,
} from '../src/systems/physics/rigid-body-types.ts';

const DT = 1 / 60;
/** Ground far below everything, so terrain contacts never interfere. */
const GROUND = () => -50;
const NO_PLAYER = {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    radius: 0.5,
    height: 1.8,
    vx: 0,
    vy: 0,
    vz: 0,
};

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error(`  ✗ ${message}`);
    }
}

function makeWorld() {
    const bodies = new Float32Array(MAX_DYNAMIC_BODIES * RB_FLOATS_PER_BODY);
    const joints = createJointPool();
    return { bodies, joints, bodyCount: 0, jointCount: 0 };
}

/** @param mass 0 marks the body kinematic (an immovable anchor). */
function spawn(world, x, y, z, mass, radius = 0.4) {
    const id = world.bodyCount++;
    const b = id * RB_FLOATS_PER_BODY;
    const p = world.bodies;
    p[b + F.PX] = x;
    p[b + F.PY] = y;
    p[b + F.PZ] = z;
    p[b + F.INV_MASS] = mass <= 0 ? 0 : 1 / mass;
    p[b + F.RESTITUTION] = 0.2;
    p[b + F.FRICTION] = 0.4;
    p[b + F.D1] = radius;
    p[b + F.D2] = radius;
    p[b + F.D3] = radius;
    p[b + F.SHAPE] = RB_SHAPE.SPHERE;
    p[b + F.FLAGS] = RB_FLAG.ACTIVE | (mass <= 0 ? RB_FLAG.KINEMATIC : 0);
    return id;
}

function join(world, type, a, b, anchorA, anchorB, p0, p1, p2) {
    const id = world.jointCount++;
    const ok = writeJointRecord(
        world.joints,
        world.bodies,
        id,
        type,
        a,
        b,
        anchorA[0],
        anchorA[1],
        anchorA[2],
        anchorB[0],
        anchorB[1],
        anchorB[2],
        p0,
        p1,
        p2
    );
    check(ok, `joint ${id} (type ${type}) should be accepted`);
    return id;
}

function step(world, ticks) {
    for (let t = 0; t < ticks; t++) {
        stepRigidBodiesJS(world.bodies, world.bodyCount, DT, GROUND, NO_PLAYER, (h) =>
            solveJointsJS(world.joints, world.bodies, world.jointCount, h)
        );
    }
}

const px = (w, id) => w.bodies[id * RB_FLOATS_PER_BODY + F.PX];
const py = (w, id) => w.bodies[id * RB_FLOATS_PER_BODY + F.PY];
const pz = (w, id) => w.bodies[id * RB_FLOATS_PER_BODY + F.PZ];
const speed = (w, id) => {
    const b = id * RB_FLOATS_PER_BODY;
    return Math.hypot(w.bodies[b + F.VX], w.bodies[b + F.VY], w.bodies[b + F.VZ]);
};

function assertFinite(world, id, name, tick) {
    if (
        !Number.isFinite(px(world, id)) ||
        !Number.isFinite(py(world, id)) ||
        !Number.isFinite(pz(world, id))
    ) {
        throw new Error(`${name}: body ${id} went non-finite at tick ${tick}`);
    }
}

// -----------------------------------------------------------------------------

function testHingeSwing() {
    console.log('Test 1: fallback hinge keeps the seat on its arc');
    const w = makeWorld();
    const PIVOT = [0, 20, 0];
    const ARM = 3.0;

    const pivot = spawn(w, PIVOT[0], PIVOT[1], PIVOT[2], 0, 0.2);
    const seat = spawn(w, PIVOT[0] + ARM, PIVOT[1], PIVOT[2], 2.0, 0.5);
    // Released horizontally, axis +Z => swings in the XY plane.
    join(w, JOINT_TYPE.HINGE, pivot, seat, PIVOT, [PIVOT[0] + ARM, PIVOT[1], PIVOT[2]], 0, 0, 1);

    let maxRadiusError = 0;
    let maxDrift = 0;
    let maxSpeed = 0;
    for (let tick = 0; tick < 3600; tick++) {
        // 60s
        step(w, 1);
        assertFinite(w, seat, 'fallback-hinge', tick);
        maxRadiusError = Math.max(
            maxRadiusError,
            Math.abs(Math.hypot(px(w, seat) - PIVOT[0], py(w, seat) - PIVOT[1]) - ARM)
        );
        maxDrift = Math.max(maxDrift, Math.abs(pz(w, seat) - PIVOT[2]));
        maxSpeed = Math.max(maxSpeed, speed(w, seat));
    }

    check(
        maxRadiusError < 0.02,
        `seat must stay on its arc, max radius error ${maxRadiusError.toFixed(5)}`
    );
    check(maxDrift < 1e-3, `seat must stay in the hinge plane, drift ${maxDrift.toFixed(8)}`);
    check(maxSpeed < 16, `swing speed must stay bounded, peaked ${maxSpeed.toFixed(2)}`);
    // The kinematic pivot must never be dragged by what it carries.
    check(px(w, pivot) === PIVOT[0] && py(w, pivot) === PIVOT[1], 'kinematic pivot must not move');

    if (failures === 0) {
        console.log(
            `  ✓ 60s swing: radius error <= ${maxRadiusError.toFixed(5)}, peak ${maxSpeed.toFixed(2)} u/s`
        );
    }
}

function testSpringConverges() {
    console.log('Test 2: fallback spring converges to rest + static sag');
    const w = makeWorld();
    const ANCHOR_Y = 20;
    const anchor = spawn(w, 0, ANCHOR_Y, 0, 0, 0.2);
    const bob = spawn(w, 0, ANCHOR_Y - 4, 0, 1.0, 0.4);
    join(w, JOINT_TYPE.SPRING, anchor, bob, [0, ANCHOR_Y, 0], [0, ANCHOR_Y - 4, 0], 2.0, 300, 25);

    step(w, 1200); // 20s
    const length = ANCHOR_Y - py(w, bob);
    // k = 300 on 1 kg under g = 22 => sag = m*g/k.
    const expected = 2.0 + 22.0 / 300.0;
    check(
        Math.abs(length - expected) < 0.05,
        `spring should hang at ${expected.toFixed(3)}, got ${length.toFixed(3)}`
    );

    if (failures === 0)
        console.log(`  ✓ converged to ${length.toFixed(3)} (analytic ${expected.toFixed(3)})`);
}

function testSpringStiffnessSweep() {
    console.log('Test 3: fallback springs stay bounded across the documented range');
    for (const { k, c } of [
        { k: 10, c: 0 },
        { k: 200, c: 8 },
        { k: 2000, c: 40 },
        { k: 4000, c: 0 },
        { k: 4000, c: 400 },
        { k: 1e9, c: 1e9 },
    ]) {
        const w = makeWorld();
        const anchor = spawn(w, 0, 20, 0, 0, 0.2);
        const bob = spawn(w, 0, 14, 0, 1.0, 0.4);
        join(w, JOINT_TYPE.SPRING, anchor, bob, [0, 20, 0], [0, 14, 0], 2.0, k, c);

        let maxSpeed = 0;
        for (let tick = 0; tick < 1800; tick++) {
            step(w, 1);
            assertFinite(w, bob, `fallback-spring-k${k}`, tick);
            maxSpeed = Math.max(maxSpeed, speed(w, bob));
        }
        // Nothing a joint writes may exceed the body layer's own speed clamp.
        check(
            maxSpeed < 80,
            `spring k=${k} c=${c} must stay under the speed clamp, peaked ${maxSpeed.toFixed(1)}`
        );
    }
    if (failures === 0) console.log('  ✓ 6 configs stayed bounded over 30s each');
}

function testFixedHoldsOffset() {
    console.log('Test 4: fallback weld preserves the bind-time offset');
    const w = makeWorld();
    const a = spawn(w, 0, 30, 0, 1.0);
    const b = spawn(w, 1.5, 30, 0.5, 3.0);
    const bx = px(w, b);
    const by = py(w, b);
    join(w, JOINT_TYPE.FIXED, a, b, [bx, by, pz(w, b)], [bx, by, pz(w, b)], 0, 0, 0);

    const want = [px(w, b) - px(w, a), py(w, b) - py(w, a), pz(w, b) - pz(w, a)];

    let maxDrift = 0;
    for (let tick = 0; tick < 1200; tick++) {
        if (tick % 120 === 0) {
            // Kick only one end: the weld has to carry the other along.
            const ba = a * RB_FLOATS_PER_BODY;
            w.bodies[ba + F.VX] += 30;
            w.bodies[ba + F.VY] += 40;
        }
        step(w, 1);
        assertFinite(w, b, 'fallback-fixed', tick);
        maxDrift = Math.max(
            maxDrift,
            Math.hypot(
                px(w, b) - px(w, a) - want[0],
                py(w, b) - py(w, a) - want[1],
                pz(w, b) - pz(w, a) - want[2]
            )
        );
    }

    check(maxDrift < 0.35, `welded offset should hold, max drift ${maxDrift.toFixed(4)}`);
    if (failures === 0) console.log(`  ✓ weld held to ${maxDrift.toFixed(4)} units`);
}

function testRejections() {
    console.log('Test 5: unsolvable joints are rejected');
    const w = makeWorld();
    const kin1 = spawn(w, 0, 20, 0, 0);
    const kin2 = spawn(w, 2, 20, 0, 0);
    const dyn = spawn(w, 4, 20, 0, 1);

    const j = w.joints;
    check(
        !writeJointRecord(
            j,
            w.bodies,
            0,
            JOINT_TYPE.FIXED,
            kin1,
            kin2,
            0,
            20,
            0,
            2,
            20,
            0,
            0,
            0,
            0
        ),
        'two kinematic ends must be rejected'
    );
    check(
        !writeJointRecord(j, w.bodies, 0, JOINT_TYPE.FIXED, -1, -1, 0, 20, 0, 0, 20, 0, 0, 0, 0),
        'two world ends must be rejected'
    );
    check(
        !writeJointRecord(j, w.bodies, 0, JOINT_TYPE.HINGE, 9999, dyn, 0, 20, 0, 4, 20, 0, 0, 0, 1),
        'out-of-range body id must be rejected'
    );
    check(
        !writeJointRecord(
            j,
            w.bodies,
            0,
            JOINT_TYPE.HINGE,
            kin1,
            dyn,
            NaN,
            20,
            0,
            4,
            20,
            0,
            0,
            0,
            1
        ),
        'a non-finite anchor must be rejected'
    );
    check(
        writeJointRecord(j, w.bodies, 0, JOINT_TYPE.HINGE, kin1, dyn, 0, 20, 0, 4, 20, 0, 0, 0, 1),
        'a valid hinge must be accepted'
    );

    if (failures === 0) console.log('  ✓ invalid joints refused, valid one accepted');
}

function run() {
    console.log('🍬 Candy World Joint Fallback (JS) Test');
    console.log('======================================\n');
    try {
        testHingeSwing();
        testSpringConverges();
        testSpringStiffnessSweep();
        testFixedHoldsOffset();
        testRejections();

        console.log();
        if (failures > 0) {
            console.error(`❌ ${failures} assertion(s) failed`);
            return false;
        }
        console.log('✅ All joint fallback tests passed!');
        return true;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        return false;
    }
}

process.exit(run() ? 0 : 1);

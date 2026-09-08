// tests/soft-body.test.mjs
// Behaviour checks for the experimental PBD cloth solver
// (src/systems/physics/soft-body.ts).
//
// The acceptance bar for the prototype is stability, not accuracy: the sheet
// must hang, settle, stay attached to its pins, refuse to sink through the
// ground, get out of the player's way, and — above all — never go non-finite,
// including under 10 s of continuous player bumps.
//
// Run with tsx (the solver is TypeScript): npm run test:softbody

import { ClothSim } from '../src/systems/physics/soft-body.ts';

const DT = 1 / 60;
const FLAT_GROUND = () => 0;

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error(`  ✗ ${message}`);
    } else {
        console.log(`  ✓ ${message}`);
    }
}

function makeBanner(overrides = {}) {
    const cloth = new ClothSim({
        cols: 12,
        rows: 9,
        spacing: 0.34,
        originX: -2,
        originY: 4,
        originZ: 0,
        ...overrides,
    });
    cloth.pinTopEdge();
    return cloth;
}

function particle(cloth, col, row) {
    const i = (row * cloth.cols + col) * 3;
    return [cloth.positions[i], cloth.positions[i + 1], cloth.positions[i + 2]];
}

function run(cloth, seconds, ground = FLAT_GROUND, player = null, onStep = null) {
    const frames = Math.round(seconds / DT);
    for (let f = 0; f < frames; f++) {
        if (onStep) onStep(f, player);
        cloth.step(DT, ground, player);
    }
}

// --- 1. Pins hold ------------------------------------------------------------
console.log('\nPinned top edge stays put');
{
    const cloth = makeBanner();
    const before = particle(cloth, 5, 0);
    run(cloth, 3);
    const after = particle(cloth, 5, 0);
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    check(moved === 0, `pinned particle did not move (moved ${moved.toFixed(6)})`);
    check(cloth.isFinite(), 'state is finite after 3 s');
}

// --- 2. It hangs and settles -------------------------------------------------
console.log('\nSheet hangs under gravity and settles');
{
    const cloth = makeBanner({ windStrength: 0 });
    const startBottom = particle(cloth, 6, 8)[1];
    run(cloth, 4);
    const settledBottom = particle(cloth, 6, 8)[1];
    check(settledBottom < startBottom + 1e-3, 'bottom edge hangs at or below its bind height');

    // Measure residual motion over the next second: overdamped means near-still.
    const before = cloth.positions.slice();
    run(cloth, 1);
    let maxDrift = 0;
    for (let i = 0; i < cloth.positions.length; i++) {
        maxDrift = Math.max(maxDrift, Math.abs(cloth.positions[i] - before[i]));
    }
    check(maxDrift < 0.05, `settles to near-rest (max drift ${maxDrift.toFixed(4)} u over 1 s)`);
}

// --- 2b. Wind actually moves it ---------------------------------------------
console.log('\nWind ripples the sheet');
{
    const cloth = makeBanner();
    const before = cloth.positions.slice();
    run(cloth, 5);
    let maxDisplacement = 0;
    for (let i = 0; i < cloth.positions.length; i++) {
        maxDisplacement = Math.max(maxDisplacement, Math.abs(cloth.positions[i] - before[i]));
    }
    check(maxDisplacement > 0.1, `breeze displaces the sheet (${maxDisplacement.toFixed(3)} u)`);
    check(maxDisplacement < 3, `but only gently (${maxDisplacement.toFixed(3)} u < 3 u)`);
}

// --- 3. Stretch clamp --------------------------------------------------------
console.log('\nNo horror stretch: links stay near rest length');
{
    const cloth = makeBanner({ windStrength: 14, gravity: -18 });
    run(cloth, 5);
    // Structural neighbours are one `spacing` apart at rest.
    let worst = 0;
    for (let r = 0; r < cloth.rows; r++) {
        for (let c = 0; c + 1 < cloth.cols; c++) {
            const a = particle(cloth, c, r);
            const b = particle(cloth, c + 1, r);
            const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            worst = Math.max(worst, d / cloth.spacing);
        }
    }
    check(worst < 1.2, `worst structural stretch ${worst.toFixed(3)}× rest (< 1.2)`);
}

// --- 4. Ground collision -----------------------------------------------------
console.log('\nSheet rests on the ground instead of sinking');
{
    // Top pinned barely above the ground, so the sheet must pile up on it.
    const cloth = makeBanner({ originY: 1.0, windStrength: 0 });
    run(cloth, 5, () => 0.5);
    let lowest = Infinity;
    for (let i = 1; i < cloth.positions.length; i += 3)
        lowest = Math.min(lowest, cloth.positions[i]);
    check(lowest >= 0.5 - 1e-3, `lowest particle y=${lowest.toFixed(3)} stays on the ground plane`);
}

// --- 5. Player capsule repels ------------------------------------------------
console.log('\nPlayer capsule pushes the sheet aside');
{
    const cloth = makeBanner({ windStrength: 0 });
    run(cloth, 3);
    const mid = particle(cloth, 6, 4);
    const player = {
        active: true,
        // Standing just behind the sheet, chest height at the sampled particle.
        x: mid[0],
        y: mid[1] + 0.9,
        z: mid[2] - 0.4,
        radius: 0.65,
        height: 1.8,
    };
    run(cloth, 1, FLAT_GROUND, player);
    const after = particle(cloth, 6, 4);
    const dz = after[2] - player.z;
    const dx = after[0] - player.x;
    const radial = Math.hypot(dx, dz);
    check(
        radial >= player.radius - 0.05,
        `particle pushed clear of the capsule (r=${radial.toFixed(3)})`
    );
    check(after[2] > mid[2], 'pushed away from the player, not through them');
}

// --- 6. Acceptance: no NaN after 10 s of bumps -------------------------------
console.log('\nAcceptance: 10 s of continuous player bumps, no NaN');
{
    const cloth = makeBanner();
    const player = { active: true, x: 0, y: 3, z: 0, radius: 0.65, height: 1.8 };
    let t = 0;
    run(cloth, 10, FLAT_GROUND, player, (_f, p) => {
        // Walk a fast figure-eight straight through the sheet, every frame.
        t += DT;
        p.x = Math.sin(t * 5.0) * 2.2;
        p.z = Math.sin(t * 9.0) * 0.9;
        p.y = 2.6 + Math.sin(t * 3.0) * 1.2;
    });
    check(cloth.isFinite(), 'no non-finite particle after 10 s of bumps');
    check(cloth.resetCount === 0, `solver never needed a NaN reset (resets=${cloth.resetCount})`);

    let far = 0;
    for (let i = 0; i < cloth.count; i++) {
        const p = i * 3;
        far = Math.max(
            far,
            Math.hypot(cloth.positions[p], cloth.positions[p + 1], cloth.positions[p + 2])
        );
    }
    check(far < 50, `sheet stayed local (max radius ${far.toFixed(2)} u)`);
}

// --- 7. Recovery path --------------------------------------------------------
console.log('\nPoisoned state self-heals to the bind pose');
{
    const cloth = makeBanner();
    run(cloth, 1);
    cloth.positions[30] = Number.NaN;
    cloth.step(DT, FLAT_GROUND, null);
    check(cloth.resetCount === 1, 'reset counter incremented once');
    check(cloth.isFinite(), 'state finite again after the reset');
}

// --- 8. Frame-rate independence ----------------------------------------------
console.log('\nFixed substeps: 30 fps and 60 fps agree');
{
    const a = makeBanner({ windStrength: 0 });
    const b = makeBanner({ windStrength: 0 });
    for (let f = 0; f < 180; f++) a.step(1 / 60, FLAT_GROUND, null);
    for (let f = 0; f < 90; f++) b.step(1 / 30, FLAT_GROUND, null);
    let worst = 0;
    for (let i = 0; i < a.positions.length; i++) {
        worst = Math.max(worst, Math.abs(a.positions[i] - b.positions[i]));
    }
    check(worst < 0.05, `same 3 s of sim within ${worst.toFixed(4)} u across frame rates`);
}

console.log('');
if (failures > 0) {
    console.error(`Soft-body: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('Soft-body: all checks passed');

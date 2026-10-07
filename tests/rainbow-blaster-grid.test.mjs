/**
 * Rainbow-blaster hit selection via the physics spatial grids.
 * Imports the production helpers: the grid path (findGeyserHit / findTrapHit) is
 * checked against the same pick functions run over the full foliage arrays, which
 * is the linear scan the grid replaced.
 *
 * Run: npm run test:blaster-grid
 */

import * as THREE from 'three';
import {
    findGeyserHit,
    findTrapHit,
    pickGeyserHit,
    pickTrapHit,
    GEYSER_HIT_RADIUS,
    MAX_TRAP_QUERY_RADIUS,
} from '../src/gameplay/rainbow-blaster.ts';
import { populatePhysicsGrids } from '../src/systems/physics/index.ts';
import { foliageGeysers, foliageTraps } from '../src/world/state.ts';

let passed = 0;
let failed = 0;

function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}`);
        failed++;
    }
}

function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rand = mulberry32(0x1843);
const range = (lo, hi) => lo + (hi - lo) * rand();
const label = (o) => (o ? o.name : 'none');

function makeTarget(parent, name, x, y, z, scale = 1) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    o.scale.setScalar(scale);
    parent.add(o);
    return o;
}

// ── Pick semantics (hand-built) ──────────────────────────────────────────────
console.log('pick semantics');
{
    const g = new THREE.Group();
    const near = makeTarget(g, 'near', 0.5, 0, 0);
    const far = makeTarget(g, 'far', -1.0, 0, 0);
    // Old code walked the list in reverse and took the first hit (`far` here).
    assert(
        pickGeyserHit(0.4, 0, 0, [near, far]) === near,
        'nearest geyser wins over iteration order'
    );
    assert(pickGeyserHit(0.4, 0, 0, [far, near]) === near, 'nearest geyser wins in either order');

    const base = makeTarget(g, 'base', 0, 0, 0);
    assert(pickGeyserHit(0, 2.0, 0, [base]) === null, 'geyser |dy| = 2.0 rejected');
    assert(pickGeyserHit(0, 1.4, 0, [base]) === base, 'geyser |dy| = 1.4 accepted');
    assert(
        pickGeyserHit(GEYSER_HIT_RADIUS, 0, 0, [base]) === null,
        'geyser dist = 1.5 rejected (strict)'
    );
    assert(pickGeyserHit(1.49, 0, 0, [base]) === base, 'geyser dist = 1.49 accepted');

    const big = makeTarget(g, 'big', 0, 0, 0, 2.0);
    const small = makeTarget(g, 'small', 3.0, 0, 0, 0.5);
    assert(pickTrapHit(1.9, 0, 0, [big]) === big, 'scale-2 trap hits at 1.9 m');
    assert(pickTrapHit(2.0, 0, 0, [big]) === null, 'scale-2 trap misses at 2.0 m (strict)');
    assert(
        pickTrapHit(2.7, 0, 0, [big, small]) === small,
        'nearest trap wins when volumes overlap'
    );
    assert(pickTrapHit(0, 0, 0, []) === null, 'no candidates → null');

    const orphan = new THREE.Object3D();
    assert(pickGeyserHit(0, 0, 0, [orphan]) === null, 'parentless geyser skipped');
    assert(pickTrapHit(0, 0, 0, [orphan]) === null, 'parentless trap skipped');
}

// ── Grid vs linear scan over a seeded world ─────────────────────────────────
console.log('grid selection matches linear scan');
const world = new THREE.Group();
foliageGeysers.length = 0;
foliageTraps.length = 0;
for (let i = 0; i < 150; i++) {
    foliageGeysers.push(
        makeTarget(world, `geyser${i}`, range(-128, 128), range(-1, 3), range(-128, 128))
    );
}
for (let i = 0; i < 60; i++) {
    foliageTraps.push(
        makeTarget(
            world,
            `trap${i}`,
            range(-128, 128),
            range(-1, 3),
            range(-128, 128),
            range(0.5, 2.0)
        )
    );
}
// Pairs that straddle grid cell boundaries (cell size 30), so the hit target lives
// in the neighbouring cell from the projectile.
// Each pair gets its own row (`lane`) so a mirrored pair's target can't sit under the shot.
const EDGE_PAIRS = [
    [29.9, 30.1, 10],
    [30.1, 29.9, 15],
    [-0.1, 0.1, 20],
    [0.1, -0.1, 25],
];
for (const [gx, , lane] of EDGE_PAIRS) {
    foliageGeysers.push(makeTarget(world, `geyserEdge${gx}`, gx, 0, lane));
    foliageGeysers.push(makeTarget(world, `geyserEdgeZ${gx}`, lane, 0, gx));
    foliageTraps.push(makeTarget(world, `trapEdge${gx}`, gx, 0, -lane - 40, 1.8));
    foliageTraps.push(makeTarget(world, `trapEdgeZ${gx}`, -lane - 40, 0, gx, 1.8));
}
populatePhysicsGrids();
assert(
    foliageTraps.every((t) => t.scale.x <= MAX_TRAP_QUERY_RADIUS),
    'test traps fit inside MAX_TRAP_QUERY_RADIUS'
);

function compare(x, y, z, counters) {
    const gGrid = findGeyserHit(x, y, z);
    const gLinear = pickGeyserHit(x, y, z, foliageGeysers);
    const tGrid = findTrapHit(x, y, z);
    const tLinear = pickTrapHit(x, y, z, foliageTraps);
    if (gGrid !== gLinear || tGrid !== tLinear) {
        counters.mismatches.push(
            `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}): geyser grid=${label(gGrid)} linear=${label(gLinear)}, trap grid=${label(tGrid)} linear=${label(tLinear)}`
        );
    }
    if (gLinear) counters.geyserHits++;
    if (tLinear) counters.trapHits++;
}

const counters = { mismatches: [], geyserHits: 0, trapHits: 0 };
for (let i = 0; i < 500; i++) {
    // Mix of aimed shots (jittered around a target) and uniform random shots.
    const r = rand();
    let x, y, z;
    if (r < 0.45) {
        const g = foliageGeysers[Math.floor(rand() * foliageGeysers.length)];
        x = g.position.x + range(-1.6, 1.6);
        y = g.position.y + range(-2.2, 2.2);
        z = g.position.z + range(-1.6, 1.6);
    } else if (r < 0.9) {
        const t = foliageTraps[Math.floor(rand() * foliageTraps.length)];
        const s = t.scale.x;
        x = t.position.x + range(-s * 1.1, s * 1.1);
        y = t.position.y + range(-s * 1.1, s * 1.1);
        z = t.position.z + range(-s * 1.1, s * 1.1);
    } else {
        x = range(-128, 128);
        y = range(-1, 3);
        z = range(-128, 128);
    }
    compare(x, y, z, counters);
}
for (const [gx, sx, lane] of EDGE_PAIRS) {
    compare(sx, 0, lane, counters);
    compare(lane, 0, sx, counters);
    compare(sx, 0, -lane - 40, counters);
    compare(-lane - 40, 0, sx, counters);
    // Targets on the far side of a cell boundary must actually be found.
    const edge = `${gx}|${sx}`;
    assert(
        findGeyserHit(sx, 0, lane)?.name === `geyserEdge${gx}`,
        `geyser across x=${edge} cell edge found`
    );
    assert(
        findGeyserHit(lane, 0, sx)?.name === `geyserEdgeZ${gx}`,
        `geyser across z=${edge} cell edge found`
    );
    assert(
        findTrapHit(sx, 0, -lane - 40)?.name === `trapEdge${gx}`,
        `trap across x=${edge} cell edge found`
    );
    assert(
        findTrapHit(-lane - 40, 0, sx)?.name === `trapEdgeZ${gx}`,
        `trap across z=${edge} cell edge found`
    );
}
for (const m of counters.mismatches.slice(0, 10)) console.error(`    ${m}`);
assert(
    counters.mismatches.length === 0,
    `grid and linear scan agree on every shot (${counters.mismatches.length} mismatches)`
);
assert(counters.geyserHits >= 50, `non-vacuous: ${counters.geyserHits} geyser hits`);
assert(counters.trapHits >= 50, `non-vacuous: ${counters.trapHits} trap hits`);

// ── Despawned since the last grid rebuild ───────────────────────────────────
console.log('despawned targets are skipped before the grid rebuilds');
{
    const victim = foliageGeysers[0];
    const { x, y, z } = victim.position;
    assert(findGeyserHit(x, y, z) === victim, 'target is hit while parented');
    world.remove(victim);
    const after = findGeyserHit(x, y, z);
    assert(after !== victim, `despawned geyser not selected (got ${label(after)})`);
    assert(
        after === pickGeyserHit(x, y, z, foliageGeysers),
        'falls back to the next qualifying geyser, or none'
    );

    const trapVictim = foliageTraps[0];
    const tp = trapVictim.position;
    assert(findTrapHit(tp.x, tp.y, tp.z) === trapVictim, 'trap is hit while parented');
    world.remove(trapVictim);
    assert(findTrapHit(tp.x, tp.y, tp.z) !== trapVictim, 'despawned trap not selected');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Build mode (#1974), the parts that run without a renderer: the palette, the
 * candy paint rules, per-chunk caps, the shared placement snapshot, and the
 * Sugar Caves door (awakened persistence on by default, gate on the count).
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/build-mode.test.ts
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FEATURE_FLAGS } from '../src/core/config.ts';
import {
    checkPlacementBudget,
    chunkKeyOf,
    countAuthored,
} from '../src/systems/authoring/chunk-budget.ts';
import {
    CANDY_PAINT_PALETTE,
    PALETTE_CATEGORIES,
    PLAYER_EXCLUDED_TYPES,
    buildPalette,
    hexToHsl,
    isCandyPaint,
} from '../src/systems/authoring/palette.ts';
import {
    buildPlacementSnapshot,
    createPlacementState,
    yawOf,
} from '../src/systems/authoring/placement-core.ts';
import { markAuthoredTransform } from '../src/systems/entity-snapshot-core.ts';
import { getPlatforms } from '../src/systems/ground-system.ts';
import {
    SYSTEM_BUDGETS,
    __resetSystemBudgetsForTests,
    getBudgetCapViolations,
} from '../src/systems/performance-budget/systems-budget.ts';
import {
    getRegisteredTypes,
    registerBuiltinWorldObjectTypes,
} from '../src/world/foliage-registry.ts';
import { AWAKENED_THRESHOLD, isSugarCavesUnlocked } from '../src/world/part-ii-unlock.ts';
import {
    installSugarCavesTraversal,
    tryOpenSugarCavesDoor,
} from '../src/world/sugar-caves-traversal.ts';

let failures = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

const realWarn = console.warn;
console.warn = () => {};

test('the palette covers every registered type players may place', () => {
    registerBuiltinWorldObjectTypes();
    const types = getRegisteredTypes();
    const palette = buildPalette(types);
    const offered = new Set(palette.map((e) => e.type));
    for (const t of types) {
        assert.equal(offered.has(t), !PLAYER_EXCLUDED_TYPES.has(t), t);
    }
    const categories = new Set(palette.map((e) => e.category));
    for (const c of PALETTE_CATEGORIES) assert.ok(categories.has(c.id), `${c.id} has pieces`);
    // Category order, then label order.
    const order = PALETTE_CATEGORIES.map((c) => c.id);
    for (let i = 1; i < palette.length; i++) {
        assert.ok(order.indexOf(palette[i - 1].category) <= order.indexOf(palette[i].category));
    }
});

test('an unknown species falls into music or props by its registry metadata', () => {
    const [music, prop] = buildPalette(['new_singing_thing', 'new_rock'], (t) =>
        t.includes('singing')
    );
    assert.equal(music.category, 'music');
    assert.equal(prop.category, 'props');
    assert.equal(music.label, 'New singing thing');
});

test('mushrooms are placed face-less so a replay rebuilds the same one', () => {
    const mushroom = buildPalette(['mushroom'])[0];
    assert.equal(mushroom.defaults.hasFace, false);
    assert.equal(mushroom.paintable, true);
});

test('every paint colour is a saturated pastel (CANDY_AESTHETIC_GUARDRAILS.md)', () => {
    assert.ok(CANDY_PAINT_PALETTE.length >= 6);
    for (const { name, hex } of CANDY_PAINT_PALETTE) {
        const { s, l } = hexToHsl(hex);
        assert.ok(s >= 0.25, `${name} saturation ${s.toFixed(2)}`);
        assert.ok(l >= 0.4 && l <= 0.95, `${name} lightness ${l.toFixed(2)}`);
        assert.ok(isCandyPaint(hex));
    }
    assert.equal(isCandyPaint(0x808080), false, 'grey is not candy');
});

test('per-chunk and world caps reject the placement past them', () => {
    __resetSystemBudgetsForTests();
    const perChunk = SYSTEM_BUDGETS.authoring.caps.perChunk;
    const objects: THREE.Object3D[] = [];
    for (let i = 0; i < perChunk; i++) {
        const o = new THREE.Object3D();
        o.position.set(1 + (i % 10) * 0.5, 0, 1 + Math.floor(i / 10) * 0.5);
        o.userData.mapEntityId = `p${i}`;
        markAuthoredTransform(o, { scale: 1 });
        objects.push(o);
    }
    // A second object for the same entity id counts once; an unauthored one not at all.
    const twin = objects[0].clone();
    twin.userData = { ...objects[0].userData };
    objects.push(twin, new THREE.Object3D());

    const counts = countAuthored(objects);
    assert.equal(counts.total, perChunk);
    assert.equal(counts.perChunk.get(chunkKeyOf(1, 1)), perChunk);

    const full = checkPlacementBudget(counts, 2, 2);
    assert.equal(full.ok, false);
    if (!full.ok) assert.match(full.message, /grove is full/);
    assert.equal(
        getBudgetCapViolations()[0]?.cap,
        'perChunk',
        'rejection is recorded for the overlay'
    );
    assert.equal(checkPlacementBudget(counts, 200, 200).ok, true, 'another chunk has room');

    const world = { total: SYSTEM_BUDGETS.authoring.caps.total, perChunk: new Map() };
    const worldFull = checkPlacementBudget(world, 0, 0);
    assert.equal(worldFull.ok, false);
    if (!worldFull.ok) assert.match(worldFull.message, /world is full/);
});

test('the shared placement snapshot carries the planted transform', () => {
    const s = createPlacementState();
    Object.assign(s, { hit: true, x: 3.456, y: 1.234, z: -7.891, onPlatform: false, status: 'ok' });
    const snap = buildPlacementSnapshot('id-1', s, {
        type: 'mushroom',
        yaw: Math.PI / 2,
        scale: 1.25,
        extra: { variant: 'regular', hasFace: false, params: {} },
    });
    assert.equal(snap.id, 'id-1');
    assert.equal(snap.entity.id, 'id-1');
    assert.deepEqual(snap.entity.position, [3.46, 1.23, -7.89]);
    assert.equal(snap.entity.placement, 'ground');
    assert.equal(snap.entity.variant, 'regular');
    assert.equal(snap.entity.hasFace, false);
    assert.ok(Math.abs(yawOf(snap.entity.rotation) - Math.PI / 2) < 1e-5);

    s.onPlatform = true;
    const moved = buildPlacementSnapshot('id-1', s, {
        type: 'x',
        yaw: 0,
        scale: 1,
        base: snap.entity,
    });
    assert.equal(moved.entity.type, 'mushroom', 'a move keeps the entity type');
    assert.equal(moved.entity.variant, 'regular', 'and its other fields');
    assert.equal(moved.entity.placement, 'absolute', 'platform placements keep their height');
});

test('awakened persistence is on by default', () => {
    assert.equal(FEATURE_FLAGS.awakenedPersistence, true);
    assert.equal(FEATURE_FLAGS.legacyRead, true);
});

test('the Sugar Caves door stays sealed until enough flora are awake', () => {
    const ramp = () => getPlatforms().filter((p) => p.id.startsWith('sugar_caves:descent')).length;
    installSugarCavesTraversal();
    assert.ok(
        getPlatforms().some((p) => p.id === 'sugar_caves:floor'),
        'the cave floor exists'
    );
    assert.equal(ramp(), 0, 'no way down while sealed');
    for (let n = 0; n < AWAKENED_THRESHOLD; n++) {
        assert.equal(tryOpenSugarCavesDoor(n), 'sealed', `${n} awakened`);
    }
    assert.equal(isSugarCavesUnlocked(), false);
    assert.equal(tryOpenSugarCavesDoor(AWAKENED_THRESHOLD), 'opened');
    assert.ok(ramp() > 0, 'the ramp is walkable once open');
    assert.equal(isSugarCavesUnlocked(), true);
    assert.equal(tryOpenSugarCavesDoor(0), 'open', 'stays open');
});

console.warn = realWarn;
if (failures > 0) {
    console.error(`\n${failures} build-mode test(s) failed`);
    process.exit(1);
}
console.log('\nAll build-mode tests passed');

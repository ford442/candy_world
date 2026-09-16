/**
 * Sky Islands traversal + multi-tier platform regression (#1363 / #1265).
 *
 * Imports real production code: ground reconcile/platform-override from
 * ground-system.ts / ground-height-core.ts, the connectivity graph from
 * sky-island-graph.ts, and the roost-anchor planner from
 * src/systems/fauna/roosts.ts.
 *
 * Run: npm run test:sky-islands (tsx --import ./tests/support/register-hooks.mjs tests/sky-islands-traversal.test.mjs)
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config.ts';
import {
    clearPlatforms,
    getEyeTargetY,
    reconcileGroundedEyeY,
    registerPlatform,
} from '../src/systems/ground-system.ts';
import { applyPlatformOverride } from '../src/systems/ground-height-core.ts';
import {
    buildTraversalWaypoints,
    clearSkyIslandGraph,
    getSkyIslandEdges,
    registerSkyIslandEdge,
    registerSkyIslandNode,
    validateSkyIslandGraph,
} from '../src/world/sky-island-graph.ts';
import { DEFAULT_ROOST_PLAN, planRoostAnchors } from '../src/systems/fauna/roosts.ts';

const EYE_HEIGHT = CONFIG.player.eyeHeight;

/** Mirror SKY_ISLANDS absolute Y tiers from generation-utils (with spaced XZ), well outside LAKE_BOUNDS. */
const LAYERS = [
    { id: 'low_mist', kind: 'mist', x: -110, z: 118, y: 18, radius: 9 },
    { id: 'mid_canopy', kind: 'canopy', x: -84, z: 100, y: 32, radius: 11 },
    { id: 'high_nebula', kind: 'nebula', x: -132, z: 142, y: 48, radius: 8 },
];

function buildIslandPlatforms() {
    return LAYERS.map((l) => ({
        id: `sky_island:${l.id}`,
        minX: l.x - l.radius * 0.9,
        maxX: l.x + l.radius * 0.9,
        minZ: l.z - l.radius * 0.9,
        maxZ: l.z + l.radius * 0.9,
        minY: l.y - 0.8,
        maxY: l.y,
        priority: 3,
    }));
}

function registerGraph() {
    clearSkyIslandGraph();
    registerSkyIslandNode({ id: 'approach:ground', layerId: 'ground', kind: 'ground', x: -100, y: 2, z: 100 });
    for (const l of LAYERS) {
        registerSkyIslandNode({ id: `island:${l.id}`, layerId: l.id, kind: 'island', x: l.x, y: l.y, z: l.z });
    }
    registerSkyIslandNode({ id: 'mist:cloud:0', layerId: 'low_mist', kind: 'cloud', x: -101, y: 16.5, z: 118 });
    registerSkyIslandEdge({ id: 'e0', from: 'approach:ground', to: 'island:low_mist', kind: 'vine_ladder' });
    registerSkyIslandEdge({ id: 'e1', from: 'island:low_mist', to: 'island:mid_canopy', kind: 'vine_ladder' });
    registerSkyIslandEdge({ id: 'e2', from: 'island:mid_canopy', to: 'island:high_nebula', kind: 'vine_ladder' });
    registerSkyIslandEdge({ id: 'e3', from: 'mist:cloud:0', to: 'island:low_mist', kind: 'cloud_hop' });
}

const ROOST_DECK_TOLERANCE = 2.5;

function buildRoostSources() {
    return LAYERS.map((l) => ({
        id: `sky_island:${l.id}`,
        layerId: l.id,
        kind: l.kind,
        x: l.x,
        y: l.y,
        z: l.z,
        radius: l.radius,
    }));
}

// ---- harness ----
let passed = 0;
let failed = 0;

function assertLabel(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}`);
        failed++;
    }
}

function test(name, fn) {
    console.log(`\n${name}`);
    clearPlatforms();
    try {
        fn();
    } catch (e) {
        console.error(`  ✗ threw: ${e.stack}`);
        failed++;
    }
}

// ---- tests ----

test('multi-tier platforms: highest covering maxY wins', () => {
    const platforms = buildIslandPlatforms();
    // Overlapping XZ only on low_mist alone
    const low = LAYERS[0];
    const h = applyPlatformOverride(low.x, low.z, 1.5, platforms);
    assertLabel(Math.abs(h - 18) < 0.001, `low mist deck → 18 (got ${h})`);

    const mid = LAYERS[1];
    const h2 = applyPlatformOverride(mid.x, mid.z, 1.5, platforms);
    assertLabel(Math.abs(h2 - 32) < 0.001, `mid canopy deck → 32 (got ${h2})`);

    const high = LAYERS[2];
    const h3 = applyPlatformOverride(high.x, high.z, 1.5, platforms);
    assertLabel(Math.abs(h3 - 48) < 0.001, `high nebula deck → 48 (got ${h3})`);
});

test('reconcile: preserves eye on each island tier (#1265 guard)', () => {
    for (const layer of LAYERS) {
        registerPlatform({
            id: `deck:${layer.id}`,
            minX: layer.x - layer.radius, maxX: layer.x + layer.radius,
            minZ: layer.z - layer.radius, maxZ: layer.z + layer.radius,
            minY: layer.y - 0.8, maxY: layer.y,
        });
        const eyeOnIsland = layer.y + EYE_HEIGHT;
        const next = reconcileGroundedEyeY(eyeOnIsland, layer.x, layer.z, 0.1, {
            isGrounded: true,
            velocityY: 0,
        });
        assertLabel(next === eyeOnIsland, `${layer.id} eye ${eyeOnIsland} preserved (got ${next})`);
    }
});

test('reconcile: return to ground still snaps up when sinking', () => {
    const FAR_X = 600, FAR_Z = 600;
    registerPlatform({ id: 'ground', minX: FAR_X - 5, maxX: FAR_X + 5, minZ: FAR_Z - 5, maxZ: FAR_Z + 5, minY: 1.0, maxY: 2.0 });
    const eyeY = getEyeTargetY(FAR_X, FAR_Z);
    const y = reconcileGroundedEyeY(1.0, FAR_X, FAR_Z, 0.016, { isGrounded: true, velocityY: 0 });
    assertLabel(Math.abs(y - eyeY) < 1e-6, `return snap to terrain eye ${eyeY}`);
});

test('connectivity graph: vine ladders climb between layers', () => {
    registerGraph();
    const { ok, errors } = validateSkyIslandGraph();
    assertLabel(ok, `graph valid (${errors.join('; ') || 'ok'})`);
    const climbs = getSkyIslandEdges().filter((e) => e.kind === 'vine_ladder');
    assertLabel(climbs.length === 3, `3 vine ladders (got ${climbs.length})`);
});

test('traversal path: spawn → hops → apex → return without clipping', () => {
    registerGraph();
    const platforms = buildIslandPlatforms();
    const path = buildTraversalWaypoints();
    assertLabel(path[0].id === 'spawn_ground', 'starts on ground');
    assertLabel(path[path.length - 1].id === 'return_ground', 'ends on ground');

    let maxY = 0;
    for (const wp of path) {
        if (wp.y > maxY) maxY = wp.y;
        // While standing on an island waypoint, platform override must match
        if (wp.id.startsWith('island:')) {
            const layerId = wp.id.replace('island:', '');
            const layer = LAYERS.find((l) => l.id === layerId);
            const ground = applyPlatformOverride(wp.x, wp.z, 1.5, platforms);
            assertLabel(Math.abs(ground - layer.y) < 0.001, `waypoint ${wp.id} ground=${ground}`);
            registerPlatform({
                id: `deck:${layer.id}`,
                minX: layer.x - layer.radius, maxX: layer.x + layer.radius,
                minZ: layer.z - layer.radius, maxZ: layer.z + layer.radius,
                minY: layer.y - 0.8, maxY: layer.y,
            });
            const eye = getEyeTargetY(wp.x, wp.z);
            const reconciled = reconcileGroundedEyeY(eye, wp.x, wp.z, 0.1, {
                isGrounded: true,
                velocityY: 0,
            });
            assertLabel(reconciled === eye, `no clip at ${wp.id}`);
        }
    }
    assertLabel(maxY >= 48, `path reaches high nebula (maxY=${maxY})`);
});

test('layer Y ordering matches proposal tiers', () => {
    assertLabel(LAYERS[0].y < LAYERS[1].y && LAYERS[1].y < LAYERS[2].y, 'mist < canopy < nebula');
    assertLabel(LAYERS[0].y === 18 && LAYERS[1].y === 32 && LAYERS[2].y === 48, 'explicit Y coords');
});

test('fauna roosts: anchors land on every island deck', () => {
    const anchors = planRoostAnchors(buildRoostSources(), DEFAULT_ROOST_PLAN);
    assertLabel(anchors.length === LAYERS.length * DEFAULT_ROOST_PLAN.perIsland, `${LAYERS.length * DEFAULT_ROOST_PLAN.perIsland} anchors (got ${anchors.length})`);
    for (const l of LAYERS) {
        const onLayer = anchors.filter((a) => a.layerId === l.id);
        assertLabel(onLayer.length === DEFAULT_ROOST_PLAN.perIsland, `${l.id} seats ${DEFAULT_ROOST_PLAN.perIsland} roosts (got ${onLayer.length})`);
    }
});

test('fauna roosts: anchors stay inside the walkable platform AABB', () => {
    // registerWalkableIslandPlatform uses radius * 0.9 for the deck bounds —
    // an anchor outside it would resolve to terrain and get rejected at spawn.
    const anchors = planRoostAnchors(buildRoostSources(), DEFAULT_ROOST_PLAN, () => 1.0);
    for (const a of anchors) {
        const layer = LAYERS.find((l) => l.id === a.layerId);
        const dx = Math.abs(a.x - layer.x);
        const dz = Math.abs(a.z - layer.z);
        const bound = layer.radius * 0.9;
        assertLabel(dx <= bound && dz <= bound, `${a.layerId} anchor within deck AABB`);
    }
});

test('fauna roosts: ground query resolves the deck, not terrain', () => {
    const platforms = buildIslandPlatforms();
    const anchors = planRoostAnchors(buildRoostSources(), DEFAULT_ROOST_PLAN, () => 1.0);
    let seated = 0;
    for (const a of anchors) {
        const surfaceY = applyPlatformOverride(a.x, a.z, 1.5, platforms);
        if (Math.abs(surfaceY - a.y) > ROOST_DECK_TOLERANCE) continue;
        seated++;
    }
    assertLabel(
        seated === anchors.length,
        `all ${anchors.length} roosts resolve to a deck (got ${seated})`
    );
});

test('fauna roosts: degrade to zero when no islands registered', () => {
    assertLabel(planRoostAnchors([], DEFAULT_ROOST_PLAN).length === 0, 'empty registry → no roosts');
    const disabled = planRoostAnchors(buildRoostSources(), { ...DEFAULT_ROOST_PLAN, perIsland: 0 });
    assertLabel(disabled.length === 0, 'perIsland 0 → no roosts');
    const degenerate = planRoostAnchors(
        [{ id: 'x', layerId: 'x', kind: 'mist', x: 0, y: 10, z: 0, radius: 0 }],
        DEFAULT_ROOST_PLAN
    );
    assertLabel(degenerate.length === 0, 'zero-radius island skipped (no NaN anchors)');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

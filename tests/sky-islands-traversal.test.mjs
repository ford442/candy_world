/**
 * Sky Islands traversal + multi-tier platform regression (#1363 / #1265).
 *
 * Pure Node harness — no browser/WASM boot required for reconcile + platform
 * override logic. Graph helpers are inlined to mirror sky-island-graph.ts.
 *
 * Run: node tests/sky-islands-traversal.test.mjs
 */

const EYE_HEIGHT = 1.8;
const PLATFORM_THRESHOLD = 1.25;
const FOLLOW_LERP_SPEED = 12.0;
const FOLLOW_MAX_STEP = 2.5;

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getEyeTargetY(groundY) {
    return groundY + EYE_HEIGHT;
}

function reconcileGroundedEyeY(currentY, groundY, delta, { isGrounded, velocityY }) {
    const eyeY = getEyeTargetY(groundY);
    if (currentY < eyeY) return eyeY;
    if (!isGrounded || velocityY > 0.05) return currentY;
    const heightAboveTerrain = currentY - eyeY;
    if (heightAboveTerrain > PLATFORM_THRESHOLD) return currentY;
    let nextY = lerp(currentY, eyeY, Math.min(delta * FOLLOW_LERP_SPEED, 1.0));
    nextY = clamp(nextY, currentY - FOLLOW_MAX_STEP, currentY + FOLLOW_MAX_STEP);
    return nextY;
}

function applyPlatformOverride(x, z, terrainHeight, platforms) {
    let best = terrainHeight;
    for (const p of platforms) {
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        if (p.maxY > best) best = p.maxY;
    }
    return best;
}

/** Mirror SKY_ISLANDS absolute Y tiers from generation-utils (with spaced XZ). */
const LAYERS = [
    { id: 'low_mist', x: -110, z: 118, y: 18, radius: 9 },
    { id: 'mid_canopy', x: -84, z: 100, y: 32, radius: 11 },
    { id: 'high_nebula', x: -132, z: 142, y: 48, radius: 8 },
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

function buildGraph() {
    const nodes = new Map();
    const edges = [];
    nodes.set('approach:ground', { id: 'approach:ground', kind: 'ground', x: -100, y: 2, z: 100 });
    for (const l of LAYERS) {
        const id = `island:${l.id}`;
        nodes.set(id, { id, kind: 'island', x: l.x, y: l.y, z: l.z });
    }
    edges.push({ id: 'e0', from: 'approach:ground', to: 'island:low_mist', kind: 'vine_ladder' });
    edges.push({ id: 'e1', from: 'island:low_mist', to: 'island:mid_canopy', kind: 'vine_ladder' });
    edges.push({ id: 'e2', from: 'island:mid_canopy', to: 'island:high_nebula', kind: 'vine_ladder' });
    edges.push({ id: 'e3', from: 'mist:cloud:0', to: 'island:low_mist', kind: 'cloud_hop' });
    nodes.set('mist:cloud:0', { id: 'mist:cloud:0', kind: 'cloud', x: -101, y: 16.5, z: 118 });
    return { nodes, edges };
}

function validateGraph(nodes, edges) {
    const errors = [];
    for (const edge of edges) {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from) errors.push(`missing from ${edge.from}`);
        if (!to) errors.push(`missing to ${edge.to}`);
        if (from && to && edge.kind === 'vine_ladder' && to.y <= from.y) {
            errors.push(`vine does not climb ${edge.id}`);
        }
    }
    return errors;
}

function buildTraversalWaypoints(nodes) {
    const islands = Array.from(nodes.values())
        .filter((n) => n.kind === 'island' || n.kind === 'cloud')
        .sort((a, b) => a.y - b.y);
    const path = [{ x: islands[0].x, y: 2.0, z: islands[0].z, id: 'spawn_ground' }];
    for (const n of islands) path.push({ x: n.x, y: n.y, z: n.z, id: n.id });
    for (let i = islands.length - 2; i >= 0; i--) {
        path.push({ x: islands[i].x, y: islands[i].y, z: islands[i].z, id: `return:${islands[i].id}` });
    }
    path.push({ x: islands[0].x, y: 2.0, z: islands[0].z, id: 'return_ground' });
    return path;
}

// ---- harness ----
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

function test(name, fn) {
    console.log(`\n${name}`);
    try {
        fn();
    } catch (e) {
        console.error(`  ✗ threw: ${e.message}`);
        failed++;
    }
}

// ---- tests ----

test('multi-tier platforms: highest covering maxY wins', () => {
    const platforms = buildIslandPlatforms();
    // Overlapping XZ only on low_mist alone
    const low = LAYERS[0];
    const h = applyPlatformOverride(low.x, low.z, 1.5, platforms);
    assert(Math.abs(h - 18) < 0.001, `low mist deck → 18 (got ${h})`);

    const mid = LAYERS[1];
    const h2 = applyPlatformOverride(mid.x, mid.z, 1.5, platforms);
    assert(Math.abs(h2 - 32) < 0.001, `mid canopy deck → 32 (got ${h2})`);

    const high = LAYERS[2];
    const h3 = applyPlatformOverride(high.x, high.z, 1.5, platforms);
    assert(Math.abs(h3 - 48) < 0.001, `high nebula deck → 48 (got ${h3})`);
});

test('reconcile: preserves eye on each island tier (#1265 guard)', () => {
    const terrainY = 1.5;
    for (const layer of LAYERS) {
        const eyeOnIsland = layer.y + EYE_HEIGHT;
        const next = reconcileGroundedEyeY(eyeOnIsland, terrainY, 0.1, {
            isGrounded: true,
            velocityY: 0,
        });
        assert(next === eyeOnIsland, `${layer.id} eye ${eyeOnIsland} preserved (got ${next})`);
    }
});

test('reconcile: return to ground still snaps up when sinking', () => {
    const y = reconcileGroundedEyeY(1.0, 2.0, 0.016, { isGrounded: true, velocityY: 0 });
    assert(y === 3.8, 'return snap to terrain eye 3.8');
});

test('connectivity graph: vine ladders climb between layers', () => {
    const { nodes, edges } = buildGraph();
    const errors = validateGraph(nodes, edges);
    assert(errors.length === 0, `graph valid (${errors.join('; ') || 'ok'})`);
    const climbs = edges.filter((e) => e.kind === 'vine_ladder');
    assert(climbs.length === 3, `3 vine ladders (got ${climbs.length})`);
});

test('traversal path: spawn → hops → apex → return without clipping', () => {
    const { nodes } = buildGraph();
    const platforms = buildIslandPlatforms();
    const path = buildTraversalWaypoints(nodes);
    assert(path[0].id === 'spawn_ground', 'starts on ground');
    assert(path[path.length - 1].id === 'return_ground', 'ends on ground');

    let maxY = 0;
    for (const wp of path) {
        if (wp.y > maxY) maxY = wp.y;
        // While standing on an island waypoint, platform override must match
        if (wp.id.startsWith('island:')) {
            const layerId = wp.id.replace('island:', '');
            const layer = LAYERS.find((l) => l.id === layerId);
            const ground = applyPlatformOverride(wp.x, wp.z, 1.5, platforms);
            assert(Math.abs(ground - layer.y) < 0.001, `waypoint ${wp.id} ground=${ground}`);
            const eye = getEyeTargetY(ground);
            const reconciled = reconcileGroundedEyeY(eye, 1.5, 0.1, {
                isGrounded: true,
                velocityY: 0,
            });
            assert(reconciled === eye, `no clip at ${wp.id}`);
        }
    }
    assert(maxY >= 48, `path reaches high nebula (maxY=${maxY})`);
});

test('layer Y ordering matches proposal tiers', () => {
    assert(LAYERS[0].y < LAYERS[1].y && LAYERS[1].y < LAYERS[2].y, 'mist < canopy < nebula');
    assert(LAYERS[0].y === 18 && LAYERS[1].y === 32 && LAYERS[2].y === 48, 'explicit Y coords');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

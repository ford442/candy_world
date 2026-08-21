/**
 * World footprint + spawn-ring entity budget (no GPU).
 * Run: pnpm exec tsx tests/world-extent.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PLAY_WORLD_SIZE,
    PLAY_WORLD_HALF,
    EXPLORE_WORLD_SIZE,
    CORE_WORLD_SIZE,
    STREAM_CELL_SIZE_M,
    PLAY_LOAD_RADIUS_M,
    PLAY_EVICT_RADIUS_M,
    metersToChunkRadius,
    worldExtentForPath,
    clampToHalfExtent,
} from '../src/world/world-extent.ts';
import { DEFAULT_MAP_CHUNK_STREAM_SIZE } from '../src/world/map-chunk-size.ts';
import { PLAYER_DEFAULTS } from '../src/core/config/ground.ts';

assert.equal(PLAY_WORLD_SIZE, 180);
assert.equal(PLAY_WORLD_HALF, 90);
assert.ok(PLAY_WORLD_SIZE >= 120 && PLAY_WORLD_SIZE <= 180);
assert.equal(EXPLORE_WORLD_SIZE, 400);
assert.equal(CORE_WORLD_SIZE, 120);
assert.equal(STREAM_CELL_SIZE_M, 50);

assert.equal(worldExtentForPath('play').size, 180);
assert.equal(worldExtentForPath('explore').size, 400);
assert.equal(worldExtentForPath('core').size, 120);
assert.equal(worldExtentForPath('play').heightmapResolution, 128);
assert.equal(worldExtentForPath('explore').heightmapResolution, 256);

assert.equal(metersToChunkRadius(PLAY_LOAD_RADIUS_M, 32), 3);
assert.equal(metersToChunkRadius(PLAY_EVICT_RADIUS_M, 32), 5);
assert.equal(metersToChunkRadius(50, 32), 2);

const lakeEast = 80;
assert.ok(
    PLAY_WORLD_HALF >= lakeEast,
    `Play half-extent ${PLAY_WORLD_HALF} must cover Melody Lake east shore (~${lakeEast})`
);
assert.ok(PLAY_WORLD_HALF >= 78, 'Play half-extent must cover mycelium grove at ~78,78');

const clamped = clampToHalfExtent(200, -200, PLAY_WORLD_HALF);
assert.equal(clamped.clamped, true);
assert.ok(Math.abs(clamped.x) <= PLAY_WORLD_HALF);
assert.ok(Math.abs(clamped.z) <= PLAY_WORLD_HALF);

function ringCoords(centerCx, centerCz, radiusChunks) {
    const out = [{ cx: centerCx, cz: centerCz }];
    for (let r = 1; r <= radiusChunks; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                out.push({ cx: centerCx + dx, cz: centerCz + dz });
            }
        }
    }
    return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(__dirname, '../assets/map-chunks.json'), 'utf8'));
const spawnCell = {
    x: Math.floor(PLAYER_DEFAULTS.spawnX / DEFAULT_MAP_CHUNK_STREAM_SIZE),
    z: Math.floor(PLAYER_DEFAULTS.spawnZ / DEFAULT_MAP_CHUNK_STREAM_SIZE),
};
const coords = ringCoords(spawnCell.x, spawnCell.z, 1);
let spawnRingCount = 0;
for (const { cx, cz } of coords) {
    const ids = index[`${cx},${cz}`];
    if (Array.isArray(ids)) spawnRingCount += ids.length;
}

assert.ok(
    spawnRingCount <= 96,
    `spawn tile + 1-ring has ${spawnRingCount} entities (budget 96; full ring must be ready)`
);
assert.ok(spawnRingCount <= 90, `keep spawn ring lean (${spawnRingCount}); investigate if this jumps`);
assert.ok(spawnRingCount > 0, 'spawn ring should contain map entities');

console.log(
    `world-extent: play ${PLAY_WORLD_SIZE}×${PLAY_WORLD_SIZE}, spawn cell (${spawnCell.x},${spawnCell.z}), ring entities ${spawnRingCount}`
);
console.log('world-extent: all assertions passed');

/**
 * Spawn placement: origin is inside Melody Lake; Play-path spawn must not be.
 *
 * Run: pnpm run test:player-spawn
 */

import assert from 'node:assert/strict';
import { PLAYER_DEFAULTS } from '../src/core/config/ground.ts';
import {
    LAKE_BOUNDS,
    LAKE_BOTTOM,
    applyLakeModifiers,
} from '../src/systems/ground-height-core.ts';

function isInLakeBasin(x, z) {
    return (
        x > LAKE_BOUNDS.minX &&
        x < LAKE_BOUNDS.maxX &&
        z > LAKE_BOUNDS.minZ &&
        z < LAKE_BOUNDS.maxZ
    );
}

function rawTerrain(x, z) {
    return (
        Math.sin(x * 0.05) * 2 +
        Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 +
        Math.cos(z * 0.15) * 0.3
    );
}

function groundAt(x, z) {
    return applyLakeModifiers(x, z, rawTerrain(x, z));
}

const spawnX = PLAYER_DEFAULTS.spawnX;
const spawnZ = PLAYER_DEFAULTS.spawnZ;
const eyeHeight = PLAYER_DEFAULTS.eyeHeight;

console.log('\norigin is inside Melody Lake (the fall-through spawn)');
assert.equal(isInLakeBasin(0, 0), true, '(0,0) is in the lake basin');
const originGround = groundAt(0, 0);
assert.ok(originGround < 0, `origin ground is carved (${originGround.toFixed(2)})`);
assert.ok(Math.abs(originGround - LAKE_BOTTOM) < 0.05, 'origin sits on lake floor');
console.log('  ✓ origin is the carved lake floor');

console.log('\nconfigured spawn is on solid shore, not in the lake');
assert.equal(isInLakeBasin(spawnX, spawnZ), false, `(${spawnX}, ${spawnZ}) is outside lake bounds`);
const spawnGround = groundAt(spawnX, spawnZ);
assert.ok(
    spawnGround > originGround + 0.5,
    `shore ground ${spawnGround.toFixed(2)} is above lake floor ${originGround.toFixed(2)}`
);
assert.ok(spawnGround > LAKE_BOTTOM + 0.5, 'spawn is not the carved lake bottom');
console.log(`  ✓ spawn (${spawnX}, ${spawnZ}) ground=${spawnGround.toFixed(2)}`);

console.log('\neye height at spawn is above water / lake floor');
const eyeY = spawnGround + eyeHeight;
assert.ok(eyeY > 0, `spawn eye Y ${eyeY.toFixed(2)} is above y=0`);
const originEye = originGround + eyeHeight;
assert.ok(originEye < 0, `origin eye Y ${originEye.toFixed(2)} would be under the map`);
console.log(`  ✓ spawn eye Y=${eyeY.toFixed(2)} (origin would be ${originEye.toFixed(2)})`);

console.log('\nPlay-path spawn chunk is not the lake-origin tile');
const chunkSize = 32;
const spawnCx = Math.floor(spawnX / chunkSize);
const spawnCz = Math.floor(spawnZ / chunkSize);
assert.ok(!(spawnCx === 0 && spawnCz === 0), `spawn chunk is (${spawnCx},${spawnCz}), not (0,0)`);
console.log(`  ✓ spawn chunk (${spawnCx},${spawnCz})`);

console.log('\n---\nplayer-spawn tests passed');

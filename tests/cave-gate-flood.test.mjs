/**
 * Cave gate contract: the gate's local position is `userData.gatePosition` at every
 * write and read. A flooded (isBlocked) cave must give calculateWaterLevel and the
 * WASM collision upload a finite gate, and a blocked cave without the field must be
 * skipped, not throw (a throw per fixed step disables `player-physics`).
 *
 * Run: pnpm run test:gate-fixes
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCaveEntrance, updateCaveWaterLevel } from '../src/foliage/cave.ts';
import { calculateWaterLevel } from '../src/systems/physics/physics-math.ts';

const FAR = new THREE.Vector3(1000, 1000, 1000);
let n = 0;
const ok = (name) => console.log(`  ok ${++n} - ${name}`);

// 1. Real cave, driven past the block threshold.
{
    const cave = createCaveEntrance({ scale: 1 });
    cave.position.set(-110, 2, 110); // outside the lake basin
    cave.updateMatrixWorld(true);
    assert.ok(cave.userData.gatePosition, 'createCaveEntrance writes userData.gatePosition');
    updateCaveWaterLevel(cave, 0.5);
    assert.equal(cave.userData.isBlocked, true, 'water 0.5 blocks the gate');

    const gate = cave.userData.gatePosition.clone().applyMatrix4(cave.matrixWorld);
    let level;
    assert.doesNotThrow(() => {
        level = calculateWaterLevel(gate, [cave]);
    });
    assert.ok(Number.isFinite(level), 'finite water level');
    assert.equal(level, gate.y + 5, 'reports water at the gate');
    assert.equal(calculateWaterLevel(FAR, [cave]), -100, 'no water away from the gate');
    ok('blocked real cave floods at its gate');

    updateCaveWaterLevel(cave, 0); // release batcher entry
    assert.equal(cave.userData.isBlocked, false);
    assert.equal(calculateWaterLevel(gate, [cave]), -100, 'drained cave is dry');
    ok('drained cave is dry');
}

// 2. Blocked cave with no gate field: skipped, no throw.
{
    const bare = { userData: { isBlocked: true }, matrixWorld: new THREE.Matrix4() };
    let level;
    assert.doesNotThrow(() => {
        level = calculateWaterLevel(FAR, [bare]);
    });
    assert.equal(level, -100);
    ok('blocked cave without gate is skipped by readers');

    const group = new THREE.Group();
    group.userData.isBlocked = false;
    assert.doesNotThrow(() => updateCaveWaterLevel(group, 0.9));
    assert.equal(group.userData.isBlocked, false, 'ungated group never becomes blocked');
    ok('updateCaveWaterLevel tolerates a group without a gate');
}
console.log(`cave-gate-flood: ${n} passed`);

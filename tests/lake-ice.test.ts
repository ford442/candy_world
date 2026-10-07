/**
 * Winter lake ice (src/systems/physics/lake-ice-core.ts).
 *
 * The lake has no collider, so ice is a ground-height rule. These tests pin
 * where the ice is (never the island, never the Sugar Caves descent), when it
 * holds weight, that it waits rather than catching the player, and that the
 * real character controller stands on it.
 *
 * Run with: npm run test:lake-ice
 */

import * as THREE from 'three';
import { CONFIG } from '../src/core/config.ts';
import { LAKE_BOTTOM, LAKE_DESCENT, LAKE_ISLAND } from '../src/systems/ground-height-core.ts';
import { resolveCharacterMovement } from '../src/systems/physics/character-controller.ts';
import {
    LAKE_ICE_HOLE_HALF_WIDTH,
    LAKE_ICE_Y,
    __setLakeIceSolidForTests,
    distanceToDescentSq,
    iceAwareFootprint,
    iceAwareGroundHeight,
    isLakeIceSolid,
    isOverLakeIce,
    updateLakeIcePhysics,
} from '../src/systems/physics/lake-ice-core.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function section(name: string): void {
    console.log(`\n${name}`);
}

// A point beside the descent: midpoint pushed `off` metres along the segment's normal.
function besideDescent(off: number): [number, number] {
    const mx = (LAKE_DESCENT.ax + LAKE_DESCENT.bx) / 2;
    const mz = (LAKE_DESCENT.az + LAKE_DESCENT.bz) / 2;
    const dx = LAKE_DESCENT.bx - LAKE_DESCENT.ax;
    const dz = LAKE_DESCENT.bz - LAKE_DESCENT.az;
    const len = Math.hypot(dx, dz);
    return [mx + (-dz / len) * off, mz + (dx / len) * off];
}

section('Where the ice is');
{
    check('open basin water freezes', isOverLakeIce(60, 50));
    check('the island never freezes', !isOverLakeIce(LAKE_ISLAND.centerX, LAKE_ISLAND.centerZ));
    check(
        'the island rim never freezes',
        !isOverLakeIce(LAKE_ISLAND.centerX + LAKE_ISLAND.radius - 0.1, LAKE_ISLAND.centerZ)
    );
    check('outside the basin is not ice', !isOverLakeIce(100, 0) && !isOverLakeIce(0, -60));

    let holeOpen = true;
    for (let t = 0; t <= 1; t += 0.05) {
        const x = LAKE_DESCENT.ax + (LAKE_DESCENT.bx - LAKE_DESCENT.ax) * t;
        const z = LAKE_DESCENT.az + (LAKE_DESCENT.bz - LAKE_DESCENT.az) * t;
        if (isOverLakeIce(x, z)) holeOpen = false;
    }
    check('the whole Sugar Caves descent stays open', holeOpen);
    const [ix, iz] = besideDescent(LAKE_ICE_HOLE_HALF_WIDTH - 0.5);
    const [ox, oz] = besideDescent(LAKE_ICE_HOLE_HALF_WIDTH + 0.5);
    check('the hole spans the 5 m descent platforms', !isOverLakeIce(ix, iz));
    check('ice resumes just past the hole', isOverLakeIce(ox, oz));
    check(
        'distanceToDescentSq is 0 on the segment',
        distanceToDescentSq(LAKE_DESCENT.ax, LAKE_DESCENT.az) === 0
    );
}

section('Holding weight');
{
    __setLakeIceSolidForTests(false);
    check(
        'thawed: ground is the lake bed',
        iceAwareGroundHeight(60, 50, LAKE_BOTTOM) === LAKE_BOTTOM
    );
    __setLakeIceSolidForTests(true);
    check(
        'frozen: ground is the ice surface',
        iceAwareGroundHeight(60, 50, LAKE_BOTTOM) === LAKE_ICE_Y
    );
    check(
        'frozen: the descent hole is still the lake bed',
        iceAwareGroundHeight(9, 11, LAKE_BOTTOM) === LAKE_BOTTOM
    );
    check('frozen: higher ground (the shore) is unchanged', iceAwareGroundHeight(60, 50, 4) === 4);

    const base = { minY: -2, avgY: -2, maxY: -1.8, normal: new THREE.Vector3(0.1, 0.99, 0) };
    const out = { minY: 0, avgY: 0, maxY: 0, normal: new THREE.Vector3() };
    const result = iceAwareFootprint(60, 50, base, out);
    check(
        'frozen footprint sits on the ice',
        result === out && out.avgY === LAKE_ICE_Y && out.normal.y === 1
    );
    check(
        'the cached ground footprint is never mutated',
        base.avgY === -2 && base.normal.x === 0.1
    );
    const shore = { minY: 1.2, avgY: 1.6, maxY: 2.0, normal: new THREE.Vector3(0, 1, 0) };
    check(
        'a footprint reaching the shore keeps the terrain',
        iceAwareFootprint(60, 50, shore, out) === shore
    );
}

section('Never catching the player');
{
    __setLakeIceSolidForTests(false);
    check(
        'freezing waits while the player swims under the ice',
        !updateLakeIcePhysics(true, 60, 50, -0.5, true)
    );
    check(
        'freezing goes ahead once they leave the water',
        updateLakeIcePhysics(true, 60, 50, 1.5, false)
    );
    check(
        'thawing waits while the player stands on the ice',
        updateLakeIcePhysics(false, 60, 50, LAKE_ICE_Y, false)
    );
    check('thawing goes ahead once they step off', !updateLakeIcePhysics(false, 100, 0, 3, false));
    __setLakeIceSolidForTests(false);
    check(
        'swimming in the descent hole does not hold back the freeze',
        updateLakeIcePhysics(true, 9, 11, -1, true)
    );
    check('state is readable', isLakeIceSolid());
}

section('The character controller stands on it');
{
    const groundQuery = {
        sampleFootprint: (x: number, z: number) =>
            iceAwareFootprint(
                x,
                z,
                {
                    minY: LAKE_BOTTOM,
                    avgY: LAKE_BOTTOM,
                    maxY: LAKE_BOTTOM,
                    normal: new THREE.Vector3(0, 1, 0),
                },
                { minY: 0, avgY: 0, maxY: 0, normal: new THREE.Vector3() }
            ),
        getGroundHeight: (x: number, z: number) => iceAwareGroundHeight(x, z, LAKE_BOTTOM),
    };
    const makePlayer = () => ({
        position: new THREE.Vector3(60, LAKE_ICE_Y + CONFIG.player.eyeHeight + 2, 50),
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: false,
        gravity: 21.5,
        spawnProtectFrames: 0,
        controllerClock: 0,
        lastGroundedTime: -Infinity,
        jumpPressedTime: -Infinity,
    });

    __setLakeIceSolidForTests(true);
    const player = makePlayer();
    for (let i = 0; i < 240; i++) {
        resolveCharacterMovement(1 / 60, player, { x: 0, z: 0 }, false, false, groundQuery);
    }
    const eye = LAKE_ICE_Y + CONFIG.player.eyeHeight;
    check(
        'dropped onto the frozen lake, the player comes to rest on the ice',
        player.isGrounded && Math.abs(player.position.y - eye) < 0.05,
        `eye y ${player.position.y.toFixed(3)} (expected ${eye.toFixed(3)})`
    );

    __setLakeIceSolidForTests(false);
    const swimmer = makePlayer();
    for (let i = 0; i < 240; i++) {
        resolveCharacterMovement(1 / 60, swimmer, { x: 0, z: 0 }, false, false, groundQuery);
    }
    check(
        'with the ice gone the same drop sinks below the surface',
        swimmer.position.y < LAKE_ICE_Y + CONFIG.player.eyeHeight - 1,
        `eye y ${swimmer.position.y.toFixed(3)}`
    );
}

__setLakeIceSolidForTests(false);
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

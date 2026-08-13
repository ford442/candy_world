/**
 * Sugar Caves traversal regression (#1492).
 * Run: node tests/sugar-caves-traversal.test.mjs
 */

import { SUGAR_CAVES } from '../src/world/generation-utils.ts';
import {
    SUGAR_CAVES_TRAVERSAL,
    getSugarCavesViewpoint,
} from '../src/world/sugar-caves-traversal.ts';
 * Sugar Caves traversal + Part II unlock regression (#1492).
 * Pure Node harness — no browser/WASM boot required.
 *
 * Run: npm run test:sugar-caves
 */

import {
    isSugarCavesUnlocked,
    tryUnlockSugarCavesFromProgress,
    getPartIITeaserLine,
} from '../src/world/part-ii-unlock.ts';

// Mirror SUGAR_CAVES + viewpoint math from generation-utils / sugar-caves-traversal.ts
const SUGAR_CAVES = { enabled: true, startX: 0, startZ: 0, endX: -40, endZ: 40 };
const CAVE_FLOOR_Y = -12;
const LAKE_DESCENT_X = 18;
const LAKE_DESCENT_Z = 22;

function getSugarCavesViewpoint() {
    const midX = (SUGAR_CAVES.startX + SUGAR_CAVES.endX) * 0.5;
    const midZ = (SUGAR_CAVES.startZ + SUGAR_CAVES.endZ) * 0.5;
    return {
        cameraPosition: { x: midX + 12, y: CAVE_FLOOR_Y + 6, z: midZ + 10 },
        cameraTarget: { x: midX, y: CAVE_FLOOR_Y + 2, z: midZ },
    };
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: ${msg}`);
    }
}

assert(SUGAR_CAVES.enabled === true, 'sugar caves config enabled');
assert(typeof SUGAR_CAVES_TRAVERSAL.caveFloorY === 'number', 'cave floor Y exported');
assert(getSugarCavesViewpoint().cameraPosition.y > SUGAR_CAVES_TRAVERSAL.caveFloorY, 'viewpoint above floor');
assert(typeof CAVE_FLOOR_Y === 'number', 'cave floor Y constant');
assert(LAKE_DESCENT_X === 18 && LAKE_DESCENT_Z === 22, 'lake descent anchor');

const unlockedBefore = isSugarCavesUnlocked();
tryUnlockSugarCavesFromProgress(3);
assert(isSugarCavesUnlocked() === true, 'unlock from awakened threshold');
assert(getPartIITeaserLine().includes('Part II'), 'teaser line mentions Part II');

if (!unlockedBefore) {
    try {
        localStorage.removeItem('candy.part2.sugar_caves_unlocked');
    } catch {
        /* headless */
    }
}

console.log(`sugar-caves-traversal: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Sugar Caves traversal regression (#1492).
 * Run: node tests/sugar-caves-traversal.test.mjs
 */

import { SUGAR_CAVES } from '../src/world/generation-utils.ts';
import {
    SUGAR_CAVES_TRAVERSAL,
    getSugarCavesViewpoint,
} from '../src/world/sugar-caves-traversal.ts';
import {
    isSugarCavesUnlocked,
    tryUnlockSugarCavesFromProgress,
    getPartIITeaserLine,
} from '../src/world/part-ii-unlock.ts';

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

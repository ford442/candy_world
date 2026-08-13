/**
 * Part II door — discovery / awakened progress gate for Sugar Caves descent (#1492).
 */

const UNLOCK_KEY = 'candy.part2.sugar_caves_unlocked';
const AWAKENED_THRESHOLD = 3;

/** Fallback when localStorage is unavailable (Node tests, private mode). */
let _memoryUnlocked = false;

export function isSugarCavesUnlocked(): boolean {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(UNLOCK_KEY) === '1') return true;
    } catch {
        /* ignore */
    }
    return _memoryUnlocked;
}

export function unlockSugarCaves(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(UNLOCK_KEY, '1');
            return;
        }
    } catch {
        /* ignore */
    }
    _memoryUnlocked = true;
}

/** Call when awakened flora count crosses threshold or discovery stamp fires. */
export function tryUnlockSugarCavesFromProgress(awakenedCount: number): boolean {
    if (isSugarCavesUnlocked()) return true;
    if (awakenedCount >= AWAKENED_THRESHOLD) {
        unlockSugarCaves();
        return true;
    }
    return false;
}

export function getPartIITeaserLine(): string {
    return isSugarCavesUnlocked()
        ? 'Part II whispers from the Sugar Caves below the lake…'
        : 'Awaken flora across the preserve to hear the Part II door.';
}

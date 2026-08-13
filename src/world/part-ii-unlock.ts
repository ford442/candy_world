/**
 * Part II door — discovery / awakened progress gate for Sugar Caves descent (#1492).
 *
 * Handles persistent and in-session unlocking for Part II content gates based on
 * awakened flora progression or manual discovery triggers.
 */

const UNLOCK_KEY = 'candy.part2.sugar_caves_unlocked';
const AWAKENED_THRESHOLD = 3;

/** Fallback state when localStorage is unavailable (e.g., Node/SSR tests, private browsing mode). */
let _memoryUnlocked = false;

/**
 * Checks whether the Sugar Caves (Part II) gate is unlocked.
 *
 * @returns `true` if unlocked in persistent storage or session memory; otherwise `false`.
 */
export function isSugarCavesUnlocked(): boolean {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(UNLOCK_KEY) === '1') {
            return true;
        }
    } catch {
        /* Ignore storage access/quota errors in restricted environments */
    }
    return _memoryUnlocked;
}

/**
 * Unlocks the Sugar Caves (Part II) gate persistently and updates session memory.
 */
export function unlockSugarCaves(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(UNLOCK_KEY, '1');
            _memoryUnlocked = true;
            return;
        }
    } catch {
        /* Ignore storage write/quota errors */
    }
    _memoryUnlocked = true;
}

/**
 * Evaluates awakened flora progression and unlocks the Sugar Caves if the threshold is met.
 *
 * @param awakenedCount - The current count of awakened flora in the preserve.
 * @returns `true` if the Sugar Caves are now unlocked (or were previously unlocked); otherwise `false`.
 */
export function tryUnlockSugarCavesFromProgress(awakenedCount: number): boolean {
    if (isSugarCavesUnlocked()) return true;
    if (awakenedCount >= AWAKENED_THRESHOLD) {
        unlockSugarCaves();
        return true;
    }
    return false;
}

/**
 * Returns a UI teaser message based on current Part II unlock progression.
 *
 * @returns A descriptive status line for HUD or menu displays.
 */
export function getPartIITeaserLine(): string {
    return isSugarCavesUnlocked()
        ? 'Part II whispers from the Sugar Caves below the lake…'
        : 'Awaken flora across the preserve to hear the Part II door.';
}
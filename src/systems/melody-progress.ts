/**
 * @file src/systems/melody-progress.ts
 * @brief Melody (quest chain) progress as plain data, between the world document and the lazy
 * objectives chunk (#2028 slice B).
 *
 * The document layer (`progress-bridge.ts`, in `save-ui`) has to read and merge Melody state, but
 * the objective system lives in the lazy `objectives` chunk and the document layer may not import
 * it. This leaf stands between them, the way `progress-events.ts` does for the progress bus:
 * the chunk registers a store when it loads; until then merged state is held here and handed over
 * on registration, so a document opened before the chunk loads loses nothing.
 *
 * Import-free, so it stays in `app`. `unionMelodyProgress` is the one definition of the merge rule;
 * `progress-union.ts` (documents and shared-world sync) and the objective system both call it.
 */

export interface MelodyProgress {
    /** Melodies finished. */
    completed: string[];
    /** Melody id → steps passed (and announced) so far. Absent once the Melody is completed. */
    step: Record<string, number>;
}

export function emptyMelodyProgress(): MelodyProgress {
    return { completed: [], step: {} };
}

/** `__proto__` is a legal document key; as a plain-object key it would not behave as data. */
const UNSAFE_KEY = '__proto__';

/**
 * Union of two Melody states; progress only grows. `completed` is a set union, `step` keeps the
 * larger index per id, and an id that is completed on either side has no `step` entry. The empty
 * state is the identity and either side may be missing, so an autosave taken before the objectives
 * chunk loads cannot erase saved chains.
 */
export function unionMelodyProgress(
    a?: Readonly<MelodyProgress> | null,
    b?: Readonly<MelodyProgress> | null
): MelodyProgress {
    const completed = new Set<string>();
    for (const side of [a, b]) {
        for (const id of side?.completed ?? []) if (id !== UNSAFE_KEY) completed.add(id);
    }
    const step: Record<string, number> = {};
    for (const side of [a, b]) {
        const entries = side?.step ?? {};
        for (const id of Object.keys(entries)) {
            const n = entries[id];
            if (id === UNSAFE_KEY || completed.has(id) || !Number.isFinite(n) || n < 0) continue;
            step[id] = Math.max(step[id] ?? 0, Math.floor(n));
        }
    }
    return { completed: [...completed], step };
}

export function isEmptyMelodyProgress(p: Readonly<MelodyProgress>): boolean {
    return p.completed.length === 0 && Object.keys(p.step).length === 0;
}

export interface MelodyStore {
    /** The state as it stands now. */
    read(): MelodyProgress;
    /**
     * Union `progress` into the live state. State that arrives this way came from a document or a
     * peer, so it must not be announced as something the player just did.
     */
    apply(progress: MelodyProgress): void;
}

let _store: MelodyStore | null = null;
/** State applied while no store is registered; handed to the store on registration. */
let _pending: MelodyProgress = emptyMelodyProgress();

/**
 * The objectives chunk is loaded: from now on reads and merges go to `store`. Anything applied
 * before this is passed to `store.apply` first. Returns an unregister function; the state held
 * by the store comes back here so unregistering does not lose it.
 */
export function registerMelodyStore(store: MelodyStore): () => void {
    _store = store;
    const pending = _pending;
    _pending = emptyMelodyProgress();
    if (!isEmptyMelodyProgress(pending)) store.apply(pending);
    return () => {
        if (_store !== store) return;
        _pending = unionMelodyProgress(_pending, store.read());
        _store = null;
    };
}

/** Melody state for a document capture: the store's, or what was applied before it existed. */
export function readMelodyProgress(): MelodyProgress {
    return _store ? _store.read() : unionMelodyProgress(_pending);
}

/** Merge Melody state from a document or a peer. Never announced. */
export function applyMelodyProgress(progress: Readonly<MelodyProgress> | undefined | null): void {
    if (!progress) return;
    if (_store) _store.apply(unionMelodyProgress(progress));
    else _pending = unionMelodyProgress(_pending, progress);
}

/**
 * @file src/systems/progress-events.ts
 * @brief "The player just made progress" as an event, for shared progress (#1975).
 *
 * The discovery system (discoveries and Night Market stamps) and the awakened
 * store report each first-time gain here. A shared-world room broadcasts them,
 * and applies its peers' inside `applyRemoteProgress`, which keeps a remote
 * gain from being echoed back out. Import-free, so it stays in `app`.
 */

export type ProgressKind = 'awakened' | 'stamp' | 'discovery';

export interface ProgressEvent {
    kind: ProgressKind;
    /** Discovery or stamp id, or an awakened flora's persistent id. */
    id: string;
    /** Flora type, for `awakened`. */
    type?: string;
}

/** Night Market stamps are discoveries under this prefix (`night-market-stamps.ts`). */
const STAMP_ID_PREFIX = 'night_market_stamp:';

export function progressKindOfDiscovery(id: string): 'stamp' | 'discovery' {
    return id.startsWith(STAMP_ID_PREFIX) ? 'stamp' : 'discovery';
}

type Listener = (event: ProgressEvent) => void;

const _listeners: Listener[] = [];
let _remoteDepth = 0;

export function onProgress(listener: Listener): () => void {
    _listeners.push(listener);
    return () => {
        const i = _listeners.indexOf(listener);
        if (i >= 0) _listeners.splice(i, 1);
    };
}

/** Report a first-time gain made by this player (ignored while applying a peer's). */
export function emitProgress(event: ProgressEvent): void {
    if (_remoteDepth > 0 || _listeners.length === 0) return;
    for (const listener of _listeners.slice()) {
        try {
            listener(event);
        } catch (err) {
            console.warn('[Progress] Listener failed:', err);
        }
    }
}

/** Run `fn` as a peer's progress: whatever it unlocks is not re-broadcast. */
export function applyRemoteProgress<T>(fn: () => T): T {
    _remoteDepth++;
    try {
        return fn();
    } finally {
        _remoteDepth--;
    }
}

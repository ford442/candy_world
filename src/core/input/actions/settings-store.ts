/**
 * Persists input settings and rebinds in localStorage (#2027). The issue moves
 * them into WorldDocument settings once #1974 lands; until then they belong to
 * the browser, not the world.
 */

import type { PersistedInput } from './action-layer.ts';

const STORAGE_KEY = 'candy-input-v1';

export function loadPersistedInput(): Partial<PersistedInput> {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Partial<PersistedInput>;
        const overrides: Record<string, string> = {};
        if (parsed.overrides && typeof parsed.overrides === 'object') {
            for (const [k, v] of Object.entries(parsed.overrides)) {
                if (typeof v === 'string') overrides[k] = v;
            }
        }
        return { settings: parsed.settings, overrides };
    } catch {
        return {};
    }
}

export function savePersistedInput(p: PersistedInput): void {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
        // Private mode or storage full: the rebinding still applies for this session.
    }
}

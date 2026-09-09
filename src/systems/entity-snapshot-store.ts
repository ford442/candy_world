/**
 * Sidecar persistence for `EntitySnapshot` records.
 *
 * v1 deliberately does NOT rewrite `assets/map.json` — that is a later editor
 * "apply to source" action. Snapshots live in a sidecar keyed by snapshot id:
 *
 *   - `assets/overrides.json`  — committed / authored overrides (read-only here)
 *   - IndexedDB                — dev-iteration overrides written from the world
 *
 * Load-time merge order is `map.json base → overrides → runtime persistence`
 * (awakened flora), which `mergeSnapshotLayers` implements for the first two.
 *
 * The write path is dev-only: gated behind `?debugPlace`.
 */

import type { CandyMapEntity } from '../world/map-loader.ts';
import { migrateSnapshot, type EntitySnapshot } from './entity-snapshot-core.ts';

const DB_NAME = 'CandyWorldEntitySnapshots';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const OVERRIDES_URL = 'assets/overrides.json';

/** Dev-only gate for anything that writes overrides. */
export function isSnapshotWriteEnabled(): boolean {
    try {
        return new URLSearchParams(window.location.search).get('debugPlace') === '1';
    } catch {
        return false; // non-browser (test) environment
    }
}

function openDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn('[EntitySnapshot] IndexedDB unavailable:', request.error);
            resolve(null);
        };
    });
}

/** Persist one snapshot to the dev sidecar. No-op unless `?debugPlace=1`. */
export async function saveSnapshot(snapshot: EntitySnapshot): Promise<boolean> {
    if (!isSnapshotWriteEnabled()) return false;
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(migrateSnapshot(snapshot));
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (err) {
            console.warn('[EntitySnapshot] Failed to persist snapshot:', err);
            resolve(false);
        } finally {
            db.close();
        }
    });
}

/** Delete one snapshot from the dev sidecar. No-op unless `?debugPlace=1`. */
export async function deleteSnapshot(id: string): Promise<boolean> {
    if (!isSnapshotWriteEnabled()) return false;
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch {
            resolve(false);
        } finally {
            db.close();
        }
    });
}

/** Read every dev-sidecar snapshot, migrating each to the current shape. */
export async function loadDevSnapshots(): Promise<EntitySnapshot[]> {
    const db = await openDb();
    if (!db) return [];
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAll();
            request.onsuccess = () => resolve(migrateAll(request.result ?? []));
            request.onerror = () => resolve([]);
        } catch {
            resolve([]);
        } finally {
            db.close();
        }
    });
}

/** Read the committed `assets/overrides.json` sidecar, if the project ships one. */
export async function loadCommittedOverrides(url = OVERRIDES_URL): Promise<EntitySnapshot[]> {
    if (typeof fetch !== 'function') return [];
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const json = await response.json();
        const raw = Array.isArray(json) ? json : (json?.snapshots ?? []);
        return migrateAll(Array.isArray(raw) ? raw : []);
    } catch {
        return []; // absent sidecar is the normal case
    }
}

function migrateAll(raw: unknown[]): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const entry of raw) {
        try {
            out.push(migrateSnapshot(entry));
        } catch (err) {
            console.warn('[EntitySnapshot] Dropping unreadable snapshot:', err);
        }
    }
    return out;
}

/**
 * Merge the authored `map.json` entities with sidecar overrides.
 *
 * An override replaces the base entity that shares its id, otherwise it is
 * appended. Later layers win, so callers pass overrides in load order —
 * committed sidecar first, dev sidecar second. Runtime persistence (awakened
 * flora) is applied after this, on the live objects.
 */
export function mergeSnapshotLayers(
    base: CandyMapEntity[],
    ...overrideLayers: EntitySnapshot[][]
): CandyMapEntity[] {
    const byId = new Map<string, CandyMapEntity>();
    const order: string[] = [];
    const push = (entity: CandyMapEntity, key: string) => {
        if (!byId.has(key)) order.push(key);
        byId.set(key, entity);
    };

    base.forEach((entity, index) => push(entity, entity.id ?? `base:${index}`));
    for (const layer of overrideLayers) {
        for (const snapshot of layer) {
            push({ ...snapshot.entity, id: snapshot.id }, snapshot.id);
        }
    }

    return order.map((key) => byId.get(key)!);
}

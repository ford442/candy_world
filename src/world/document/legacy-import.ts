/**
 * @file src/world/document/legacy-import.ts
 * @brief One-shot import of the six pre-WorldDocument stores into a v1 document.
 *
 * | Store                       | Where                                         |
 * | --------------------------- | --------------------------------------------- |
 * | save slots                  | IndexedDB `CandyWorldSaveDB` / `saves`        |
 * | discoveries (+ stamps)      | localStorage `candy_world_discovery_v2` (+ v1) |
 * | unlocks + inventory         | localStorage `candy_world_unlocks`            |
 * | Part II door                | localStorage `candy.part2.sugar_caves_unlocked` |
 * | awakened flora              | localStorage `candy_world_awakened_v1`        |
 * | entity snapshots (dev)      | IndexedDB `CandyWorldEntitySnapshots`         |
 *
 * The old keys are never deleted here. While `FEATURE_FLAGS.legacyRead` is on
 * (this release) the systems that own them keep reading and writing them, so a
 * rollback loses nothing; the release after drops the flag and the keys.
 *
 * `buildDocumentFromLegacy` is pure (fixtures in, document out) so the mapping
 * is unit-tested; `readLegacySources` is the browser-side reader.
 */

import {
    inventoryFrom,
    normalizeAwakened,
    snapshotsToPlaceCommands,
    splitStamps,
    stringList,
} from './legacy-records.ts';
import { migrateLegacySave } from './migrations.ts';
import {
    createEmptyDocument,
    validateWorldDocument,
    type DocumentCommand,
    type WorldDocumentV1,
} from './schema.ts';
import type { DocumentStore } from './store.ts';

export const LEGACY_KEYS = {
    discovery: 'candy_world_discovery_v2',
    discoveryV1: 'candy_world_discovery',
    unlocks: 'candy_world_unlocks',
    partII: 'candy.part2.sugar_caves_unlocked',
    awakened: 'candy_world_awakened_v1',
} as const;

/** Set once the import has written a document, so it never runs twice. */
export const LEGACY_IMPORTED_KEY = 'candy_world_document_imported';

/** Raw contents of the six stores, as read (strings are localStorage values). */
export interface LegacySources {
    /** Newest save slot's `SaveData`, if any. */
    saveData?: unknown;
    discovery?: string | null;
    discoveryV1?: string | null;
    unlocks?: string | null;
    partII?: string | null;
    awakened?: string | null;
    /** Dev-sidecar `EntitySnapshot` records. */
    devSnapshots?: unknown[];
}

export type LegacyStoreName =
    'saveSlot' | 'discovery' | 'unlocks' | 'partII' | 'awakened' | 'entitySnapshots';

export interface LegacyImportReport {
    /** Records taken from each store. */
    imported: Record<LegacyStoreName, number>;
    /** Records that could not be read. */
    skipped: Record<LegacyStoreName, number>;
    /** True when no store held anything. */
    empty: boolean;
}

export interface BuildOptions {
    seed: number;
    mapVersion: string;
    now?: number;
    id?: string;
}

function parseJson(text: string | null | undefined): unknown {
    if (typeof text !== 'string' || text.length === 0) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function union(a: readonly string[], b: readonly string[]): string[] {
    return [...new Set([...a, ...b])];
}

/** Discovery ids from either discovery format (v2 `{discoveries: [{id}]}` or v1 arrays). */
function discoveryIds(v2: unknown, v1: unknown): { ids: string[]; skipped: number } {
    const ids: string[] = [];
    let skipped = 0;
    const v2rec = record(v2);
    if (v2rec && Array.isArray(v2rec.discoveries)) {
        for (const d of v2rec.discoveries) {
            const id = record(d)?.id;
            if (typeof id === 'string' && id.length > 0) ids.push(id);
            else skipped++;
        }
    } else if (v2 === null) skipped++;
    const v1rec = record(v1);
    const v1list = Array.isArray(v1) ? v1 : (v1rec?.items ?? v1rec?.discoveries);
    if (Array.isArray(v1list)) ids.push(...stringList(v1list));
    else if (v1 === null) skipped++;
    return { ids: stringList(ids), skipped };
}

/**
 * Merge the six stores into one v1 document. Lists are unions, inventory
 * counts take the larger value, and the Part II door is open if any store says
 * so. Throws only if the result fails validation, which would be a bug here.
 */
export function buildDocumentFromLegacy(
    sources: LegacySources,
    options: BuildOptions
): { doc: WorldDocumentV1; report: LegacyImportReport } {
    const now = options.now ?? Date.now();
    const zero = (): Record<LegacyStoreName, number> => ({
        saveSlot: 0,
        discovery: 0,
        unlocks: 0,
        partII: 0,
        awakened: 0,
        entitySnapshots: 0,
    });
    const report: LegacyImportReport = { imported: zero(), skipped: zero(), empty: true };

    // 1. The newest save slot seeds the document (player, authored entities, its progress).
    let doc = createEmptyDocument({
        seed: options.seed,
        mapVersion: options.mapVersion,
        id: options.id,
        now,
    });
    const save = record(sources.saveData);
    if (save && record(save.metadata) && record(save.player)) {
        const fromSave = migrateLegacySave(save, {
            seed: options.seed,
            mapVersion: options.mapVersion,
            now,
        });
        fromSave.schema = 1;
        fromSave.id = doc.id;
        const checked = validateWorldDocument(fromSave);
        if (checked.ok) {
            doc = checked.doc;
            report.imported.saveSlot = 1;
        } else {
            report.skipped.saveSlot = 1;
        }
    } else if (sources.saveData !== undefined && sources.saveData !== null) {
        report.skipped.saveSlot = 1;
    }
    const progress = doc.progress;

    // 2. Discoveries; stamp ids move to `stamps`.
    const disc = discoveryIds(parseJson(sources.discovery), parseJson(sources.discoveryV1));
    const split = splitStamps(disc.ids);
    progress.discoveries = union(progress.discoveries, split.discoveries);
    progress.stamps = union(progress.stamps, split.stamps);
    report.imported.discovery = disc.ids.length;
    report.skipped.discovery = disc.skipped;

    // 3. Unlocks + inventory.
    const unlocks = parseJson(sources.unlocks);
    const unlocksRec = record(unlocks);
    if (unlocksRec) {
        const ids = stringList(unlocksRec.unlocks);
        progress.unlocks = union(progress.unlocks, ids);
        const inventory = inventoryFrom(unlocksRec.inventory);
        for (const key in inventory) {
            progress.inventory[key] = Math.max(progress.inventory[key] ?? 0, inventory[key]);
        }
        report.imported.unlocks = ids.length + Object.keys(inventory).length;
    } else if (unlocks !== undefined) {
        report.skipped.unlocks = 1;
    }

    // 4. Part II door.
    if (sources.partII === '1') {
        progress.partII.sugarCavesUnlocked = true;
        report.imported.partII = 1;
    } else if (typeof sources.partII === 'string' && sources.partII.length > 0) {
        report.skipped.partII = 1;
    }

    // 5. Awakened flora (compact localStorage payload, schema version 1).
    const awakened = record(parseJson(sources.awakened));
    if (awakened && awakened.version === 1 && Array.isArray(awakened.entries)) {
        const records = normalizeAwakened(awakened.entries, now);
        const byId = new Map(progress.awakened.map((a) => [a.persistentId, a]));
        for (const a of records) {
            const existing = byId.get(a.persistentId);
            if (!existing || a.awakenedAt < existing.awakenedAt) byId.set(a.persistentId, a);
        }
        progress.awakened = [...byId.values()];
        report.imported.awakened = records.length;
        report.skipped.awakened = awakened.entries.length - records.length;
    } else if (sources.awakened) {
        report.skipped.awakened = 1;
    }

    // 6. Dev-sidecar entity snapshots become place commands after the save's own.
    const dev = snapshotsToPlaceCommands(sources.devSnapshots ?? []);
    const placed = new Set(
        doc.commands.flatMap((c: DocumentCommand) => (c.type === 'place' ? [c.snapshot.id] : []))
    );
    for (const cmd of dev.commands) {
        if (cmd.type === 'place' && placed.has(cmd.snapshot.id)) continue;
        doc.commands.push(cmd);
        report.imported.entitySnapshots++;
    }
    report.skipped.entitySnapshots = dev.skipped;

    report.empty = Object.values(report.imported).every((n) => n === 0);
    doc.meta.updatedAt = now;
    if (!doc.meta.title) doc.meta.title = 'My Candy World';

    const checked = validateWorldDocument(doc);
    if (!checked.ok) throw checked.error;
    return { doc: checked.doc, report };
}

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

function readLocal(key: string): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
        return null;
    }
}

function openDb(name: string): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        try {
            // No version: open whatever exists; never create or upgrade a legacy DB here.
            const request = indexedDB.open(name);
            request.onupgradeneeded = () => request.transaction?.abort();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function readAll(dbName: string, storeName: string): Promise<unknown[]> {
    const db = await openDb(dbName);
    if (!db) return [];
    try {
        if (!db.objectStoreNames.contains(storeName)) return [];
        return await new Promise<unknown[]>((resolve) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result ?? []);
            request.onerror = () => resolve([]);
        });
    } catch {
        return [];
    } finally {
        db.close();
    }
}

/** Newest save slot's `SaveData` (records are `{ slotId, timestamp, data }`). */
function newestSave(records: unknown[]): unknown {
    let best: { timestamp: number; data: unknown } | null = null;
    for (const r of records) {
        const rec = record(r);
        if (!rec || !record(rec.data)) continue;
        const ts = typeof rec.timestamp === 'number' ? rec.timestamp : 0;
        if (!best || ts > best.timestamp) best = { timestamp: ts, data: rec.data };
    }
    return best?.data;
}

export async function readLegacySources(): Promise<LegacySources> {
    const [saves, devSnapshots] = await Promise.all([
        readAll('CandyWorldSaveDB', 'saves'),
        readAll('CandyWorldEntitySnapshots', 'snapshots'),
    ]);
    return {
        saveData: newestSave(saves),
        discovery: readLocal(LEGACY_KEYS.discovery),
        discoveryV1: readLocal(LEGACY_KEYS.discoveryV1),
        unlocks: readLocal(LEGACY_KEYS.unlocks),
        partII: readLocal(LEGACY_KEYS.partII),
        awakened: readLocal(LEGACY_KEYS.awakened),
        devSnapshots,
    };
}

export function hasImportedLegacy(): boolean {
    return readLocal(LEGACY_IMPORTED_KEY) !== null;
}

/**
 * Build a document from the legacy stores and save it, once per browser.
 * Returns null when it already ran or there was nothing to import.
 */
export async function importLegacyStoresOnce(
    store: DocumentStore,
    options: BuildOptions
): Promise<{ doc: WorldDocumentV1; report: LegacyImportReport } | null> {
    if (hasImportedLegacy()) return null;
    const result = buildDocumentFromLegacy(await readLegacySources(), options);
    if (!result.report.empty) await store.save(result.doc);
    try {
        localStorage.setItem(LEGACY_IMPORTED_KEY, result.report.empty ? 'empty' : result.doc.id);
    } catch {
        // Storage blocked: the import re-runs next boot, which is harmless (it is a union).
    }
    return result.report.empty ? null : result;
}

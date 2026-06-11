import { FEATURE_FLAGS } from '../core/config.ts';

export interface AwakenedPosition {
    x: number;
    z: number;
}

export interface AwakenedEntityMeta extends AwakenedPosition {
    type: string;
    biome: string;
}

export interface AwakenedRecord {
    key: string;
    type: string;
    biome: string;
    awakenedAt: string;
    lastNoteColor: [number, number, number];
    emissiveScale: number;
}

interface AwakenedSlice {
    version: 1;
    records: AwakenedRecord[];
}

interface AwakenedRoot {
    version: 1;
    updatedAt: string;
    awakened: AwakenedSlice;
}

type AwakenedImportRoot = Partial<AwakenedRoot> & {
    awakened?: Partial<AwakenedSlice> & { records?: unknown };
};

const STORAGE_KEY = 'candy_world_awakened_persistence';
const STORAGE_VERSION = 1 as const;
const DEBOUNCE_MS = 2000;
const MAX_WAIT_MS = 10000;
const AWAKENED_GLOW_FACTOR = 0.18;

let analyticsPromise: Promise<typeof import('./analytics/index.ts')> | null = null;

function nowIso(): string {
    return new Date().toISOString();
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function normalizeNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function colorHexToTuple(color: unknown): [number, number, number] {
    if (Array.isArray(color) && color.length >= 3) {
        return [
            clamp01(normalizeNumber(color[0], 1)),
            clamp01(normalizeNumber(color[1], 1)),
            clamp01(normalizeNumber(color[2], 1)),
        ];
    }

    if (typeof color === 'number' && Number.isFinite(color)) {
        const hex = Math.max(0, Math.floor(color));
        return [
            ((hex >> 16) & 0xff) / 255,
            ((hex >> 8) & 0xff) / 255,
            (hex & 0xff) / 255,
        ];
    }

    return [1, 1, 1];
}

function safeJsonParse<T>(value: string): T | null {
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function isFiniteTuple3(value: unknown): value is [number, number, number] {
    return Array.isArray(value) &&
        value.length === 3 &&
        value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function readStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

function normalizeBiome(biome: unknown, type: string): string {
    return typeof biome === 'string' && biome.trim().length > 0
        ? biome.trim()
        : type;
}

function normalizeType(type: unknown): string {
    return typeof type === 'string' && type.trim().length > 0
        ? type.trim()
        : 'unknown';
}

function normalizePosition(value: unknown): AwakenedPosition | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    const x = normalizeNumber(data.x, Number.NaN);
    const z = normalizeNumber(data.z, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z };
}

function normalizeRoot(raw: unknown): AwakenedRoot | null {
    if (!raw || typeof raw !== 'object') return null;

    const data = raw as AwakenedImportRoot;
    const version = normalizeNumber(data.version, NaN);
    const awakened = data.awakened;
    const recordsInput = awakened?.records;

    if (version !== STORAGE_VERSION || !awakened || !Array.isArray(recordsInput)) {
        return null;
    }

    const records: AwakenedRecord[] = [];
    for (const candidate of recordsInput) {
        if (!candidate || typeof candidate !== 'object') continue;
        const item = candidate as unknown as Record<string, unknown>;
        const key = typeof item.key === 'string' && item.key.length > 0 ? item.key : '';
        const type = normalizeType(item.type);
        const biome = normalizeBiome(item.biome, type);
        const awakenedAt = typeof item.awakenedAt === 'string' && item.awakenedAt.length > 0 ? item.awakenedAt : '';
        const lastNoteColor: [number, number, number] = isFiniteTuple3(item.lastNoteColor)
            ? [item.lastNoteColor[0], item.lastNoteColor[1], item.lastNoteColor[2]]
            : [1, 1, 1];
        const emissiveScale = clamp01(normalizeNumber(item.emissiveScale, 1));

        if (!key || !type || !biome || !awakenedAt) continue;

        records.push({
            key,
            type,
            biome,
            awakenedAt,
            lastNoteColor,
            emissiveScale,
        });
    }

    return {
        version: STORAGE_VERSION,
        updatedAt: typeof data.updatedAt === 'string' && data.updatedAt.length > 0 ? data.updatedAt : nowIso(),
        awakened: {
            version: STORAGE_VERSION,
            records,
        },
    };
}

async function fireAnalyticsEvent(record: AwakenedRecord): Promise<void> {
    try {
        const hook = (globalThis as { __testAwakenedAnalyticsHook?: (record: AwakenedRecord) => void }).__testAwakenedAnalyticsHook;
        if (typeof hook === 'function') {
            hook(record);
            return;
        }
        analyticsPromise ??= import('./analytics/index.ts');
        const { trackEvent } = await analyticsPromise;
        trackEvent('entity_awakened', {
            entityType: record.type,
            biome: record.biome,
            awakenedAt: record.awakenedAt,
            awakenedKey: record.key,
            emissiveScale: record.emissiveScale,
        });
    } catch {
        // Analytics is best-effort only.
    }
}

class AwakenedPersistenceManager {
    private loaded = false;
    private dirty = false;
    private savedOrphanCount = 0;
    private records = new Map<string, AwakenedRecord>();
    private spawnedKeys = new Set<string>();
    private debounceTimer: number | null = null;
    private maxWaitTimer: number | null = null;
    private firstPendingAt = 0;
    private listenersAttached = false;

    private get enabled(): boolean {
        return FEATURE_FLAGS.awakenedPersistence;
    }

    private ensureLoaded(): void {
        if (!this.enabled || this.loaded) return;
        this.loaded = true;

        const storage = readStorage();
        if (!storage) return;

        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return;

        const parsed = safeJsonParse<unknown>(raw);
        const normalized = normalizeRoot(parsed);
        if (!normalized) return;

        this.records.clear();
        for (const record of normalized.awakened.records) {
            this.records.set(record.key, record);
        }
    }

    private ensureListeners(): void {
        if (!this.enabled || this.listenersAttached || typeof window === 'undefined') return;

        const flushOnLifecycle = () => {
            this.flushNow('lifecycle');
        };

        window.addEventListener('pagehide', flushOnLifecycle);
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flushOnLifecycle();
            }
        });
        this.listenersAttached = true;
    }

    private clearTimers(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.maxWaitTimer !== null) {
            clearTimeout(this.maxWaitTimer);
            this.maxWaitTimer = null;
        }
        this.firstPendingAt = 0;
    }

    private buildSnapshot(): AwakenedRoot {
        const records = Array.from(this.records.values());
        const orphanedRecords = records.filter(record => !this.spawnedKeys.has(record.key));
        const orphanRatio = records.length === 0 ? 0 : orphanedRecords.length / records.length;
        const shouldPrune = orphanRatio > 0.25;
        const finalRecords = shouldPrune
            ? records.filter(record => this.spawnedKeys.has(record.key))
            : records;

        this.savedOrphanCount = orphanedRecords.length;
        if (shouldPrune && finalRecords.length !== records.length) {
            for (const orphan of orphanedRecords) {
                this.records.delete(orphan.key);
            }
        }

        return {
            version: STORAGE_VERSION,
            updatedAt: nowIso(),
            awakened: {
                version: STORAGE_VERSION,
                records: finalRecords.map(record => ({
                    key: record.key,
                    type: record.type,
                    biome: record.biome,
                    awakenedAt: record.awakenedAt,
                    lastNoteColor: [record.lastNoteColor[0], record.lastNoteColor[1], record.lastNoteColor[2]],
                    emissiveScale: record.emissiveScale,
                })),
            },
        };
    }

    private persistNow(): void {
        if (!this.enabled) return;
        this.ensureLoaded();

        const storage = readStorage();
        if (!storage) return;

        try {
            const snapshot = this.buildSnapshot();
            storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            this.dirty = false;
        } catch {
            // Ignore quota/serialization failures; the next flush may succeed.
        } finally {
            this.clearTimers();
        }
    }

    initialize(): void {
        if (!this.enabled) return;
        this.ensureLoaded();
        this.ensureListeners();
    }

    deriveKey(meta: AwakenedEntityMeta): string {
        const biome = normalizeBiome(meta.biome, meta.type);
        const x = Math.round(meta.x * 2) / 2;
        const z = Math.round(meta.z * 2) / 2;
        return `awk_v1:${biome}:${x}:${z}:${normalizeType(meta.type)}`;
    }

    registerSpawnedEntity(meta: AwakenedEntityMeta): string {
        if (!this.enabled) return this.deriveKey(meta);
        this.ensureLoaded();
        const key = this.deriveKey(meta);
        this.spawnedKeys.add(key);
        return key;
    }

    getAwakenedScale(key: string): number {
        if (!this.enabled) return 0;
        this.ensureLoaded();
        return this.records.get(key)?.emissiveScale ?? 0;
    }

    getAwakenedRecord(key: string): AwakenedRecord | undefined {
        if (!this.enabled) return undefined;
        this.ensureLoaded();
        return this.records.get(key);
    }

    markAwakened(meta: AwakenedEntityMeta & {
        key?: string;
        emissiveScale?: number;
        lastNoteColor?: unknown;
    }): boolean {
        if (!this.enabled) return false;
        this.ensureLoaded();
        this.ensureListeners();

        const key = meta.key ?? this.deriveKey(meta);
        this.spawnedKeys.add(key);

        if (this.records.has(key)) {
            return false;
        }

        const record: AwakenedRecord = {
            key,
            type: normalizeType(meta.type),
            biome: normalizeBiome(meta.biome, meta.type),
            awakenedAt: nowIso(),
            lastNoteColor: colorHexToTuple(meta.lastNoteColor),
            emissiveScale: clamp01(normalizeNumber(meta.emissiveScale, 1)),
        };

        this.records.set(key, record);
        this.dirty = true;
        this.scheduleSave();
        void fireAnalyticsEvent(record);
        return true;
    }

    scheduleSave(): void {
        if (!this.enabled || !this.dirty) return;
        this.ensureListeners();

        const now = Date.now();
        if (this.firstPendingAt === 0) {
            this.firstPendingAt = now;
        }

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = window.setTimeout(() => this.persistNow(), DEBOUNCE_MS);

        if (this.maxWaitTimer === null) {
            const elapsed = now - this.firstPendingAt;
            const remaining = Math.max(0, MAX_WAIT_MS - elapsed);
            this.maxWaitTimer = window.setTimeout(() => this.persistNow(), remaining);
        }
    }

    flushNow(_reason: 'lifecycle' | 'manual' | 'debounce' = 'manual'): void {
        if (!this.enabled) return;
        if (!this.dirty && this.records.size === 0) return;
        this.persistNow();
    }

    exportToJSON(): string {
        this.ensureLoaded();
        return JSON.stringify(this.buildSnapshot());
    }

    importFromJSON(json: string): boolean {
        if (!this.enabled) return false;
        const parsed = safeJsonParse<unknown>(json);
        const normalized = normalizeRoot(parsed);
        if (!normalized) return false;

        this.ensureLoaded();
        this.records.clear();
        for (const record of normalized.awakened.records) {
            this.records.set(record.key, record);
        }
        this.dirty = true;
        this.scheduleSave();
        return true;
    }

    getStats(): { total: number; awakened: number; orphaned: number } {
        this.ensureLoaded();
        const total = this.records.size;
        let orphaned = 0;
        for (const key of this.records.keys()) {
            if (!this.spawnedKeys.has(key)) orphaned++;
        }
        return { total, awakened: total - orphaned, orphaned: Math.max(orphaned, this.savedOrphanCount) };
    }

    clear(): void {
        this.ensureLoaded();
        this.records.clear();
        this.spawnedKeys.clear();
        this.dirty = true;
        this.persistNow();
    }
}

export const awakenedPersistence = new AwakenedPersistenceManager();

export function initializeAwakenedPersistence(): void {
    awakenedPersistence.initialize();
}

export function deriveAwakenedKey(meta: AwakenedEntityMeta): string {
    return awakenedPersistence.deriveKey(meta);
}

export function registerAwakenedSpawn(meta: AwakenedEntityMeta): string {
    return awakenedPersistence.registerSpawnedEntity(meta);
}

export function getAwakenedGlow(key: string): number {
    return awakenedPersistence.getAwakenedScale(key) > 0 ? awakenedPersistence.getAwakenedScale(key) * AWAKENED_GLOW_FACTOR : 0;
}

export function markAwakened(meta: AwakenedEntityMeta & {
    key?: string;
    emissiveScale?: number;
    lastNoteColor?: unknown;
}): boolean {
    return awakenedPersistence.markAwakened(meta);
}

export function exportAwakenedPersistence(): string {
    return awakenedPersistence.exportToJSON();
}

export function importAwakenedPersistence(json: string): boolean {
    return awakenedPersistence.importFromJSON(json);
}

export function flushAwakenedPersistence(): void {
    awakenedPersistence.flushNow('manual');
}

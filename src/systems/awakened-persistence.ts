/**
 * Awakened flora persistence — durable soft glow for music-reacted plants.
 *
 * Separate from discovery-persistence (spatial "seen" vs music "awakened").
 * Feature-flagged via FEATURE_FLAGS.awakenedPersistence (?awakened, default off).
 */

import * as THREE from 'three';
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import { saveSystem } from './save-system/save-system.ts';
import { trackEvent } from './analytics/index.ts';
import type { AwakenedFloraState } from './save-system/save-types.ts';
import { luminousPlantBatcher } from '../foliage/luminous-plant-batcher.ts';
import {
    computePersistentId,
    persistentIdFromString,
    POSITION_QUANTIZE,
} from './awakened-persistent-id.ts';

// =============================================================================
// Constants & types
// =============================================================================

export const AWAKENED_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'candy_world_awakened_v1';
export const SAVE_DEBOUNCE_MS = 500;

export { computePersistentId, persistentIdFromString, POSITION_QUANTIZE } from './awakened-persistent-id.ts';

export const DEFAULT_AWAKENED_EMISSIVE_SCALE = CONFIG.glow.awakenedGlowMultiplier;

export const AWAKENABLE_TYPES = new Set(['luminous_plant', 'gem_canopy_tree']);

export type AwakenedBatcherKind = 'luminous' | 'gem_fruit';

export interface BatcherInstanceRef {
    batcher: AwakenedBatcherKind;
    instanceIndex: number;
    gemType?: number;
}

export interface AwakenedMeta {
    type: string;
    biome?: string;
    awakenedAt: number;
    lastNoteColor?: number;
    emissiveScale: number;
}

interface StoredPayload {
    version: number;
    entries: Array<{
        id: number;
        t: string;
        b?: string;
        at: number;
        c?: number;
        e: number;
    }>;
}

interface PlacedEntity {
    persistentId: number;
    type: string;
    biome?: string;
    position: THREE.Vector3;
    refs: BatcherInstanceRef[];
}

// =============================================================================
// AwakenedStore
// =============================================================================

const _scratchPos = new THREE.Vector3();
const AWAKEN_RADIUS_SQ = 30 * 30;

function isHeadless(): boolean {
    return typeof window === 'undefined' ||
        (typeof process !== 'undefined' && process.env?.CI === 'true') ||
        (typeof navigator !== 'undefined' && navigator.userAgent.includes('Headless'));
}

function normalizeLegacyState(raw: AwakenedFloraState): { id: number; meta: AwakenedMeta } | null {
    const legacyId = raw.entityId ?? raw.id;
    let id: number;
    if (typeof (raw as { persistentId?: number }).persistentId === 'number') {
        id = (raw as { persistentId: number }).persistentId;
    } else if (typeof legacyId === 'number') {
        id = legacyId >>> 0;
    } else if (typeof legacyId === 'string' && legacyId.length > 0) {
        if (legacyId.startsWith('pos_')) {
            const parts = legacyId.split('_');
            const x = Number(parts[1]);
            const z = Number(parts[2]);
            if (!Number.isNaN(x) && !Number.isNaN(z)) {
                id = computePersistentId(x / 10, z / 10, raw.type ?? 'unknown');
            } else {
                id = persistentIdFromString(legacyId);
            }
        } else {
            id = persistentIdFromString(legacyId);
        }
    } else {
        return null;
    }

    return {
        id,
        meta: {
            type: raw.type ?? 'unknown',
            biome: raw.biome,
            awakenedAt: raw.awakenedAt ?? raw.lastAwakenedTimestamp ?? Date.now(),
            lastNoteColor: raw.lastNoteColor,
            emissiveScale: raw.emissiveScale ?? DEFAULT_AWAKENED_EMISSIVE_SCALE,
        },
    };
}

export class AwakenedStore {
    readonly awakened = new Set<number>();
    private readonly meta = new Map<number, AwakenedMeta>();
    private readonly placed = new Map<number, PlacedEntity>();
    private readonly analyticsFired = new Set<number>();
    private dirty = false;
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private storageAvailable = false;
    private beforeUnloadBound = false;

    constructor() {
        if (isHeadless()) return;
        this.storageAvailable = this.checkStorage();
        this.ensureBeforeUnload();
    }

    isEnabled(): boolean {
        return FEATURE_FLAGS.awakenedPersistence && !isHeadless();
    }

    /** Parse localStorage once; migrate-or-bail on version mismatch (never throws). */
    load(): void {
        if (!this.isEnabled() || !this.storageAvailable) return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as StoredPayload;
            if (parsed.version !== AWAKENED_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
                console.warn('[AwakenedStore] Schema mismatch — bailing on load');
                return;
            }
            for (const entry of parsed.entries) {
                if (typeof entry.id !== 'number') continue;
                this.awakened.add(entry.id);
                this.meta.set(entry.id, {
                    type: entry.t,
                    biome: entry.b,
                    awakenedAt: entry.at,
                    lastNoteColor: entry.c,
                    emissiveScale: entry.e ?? DEFAULT_AWAKENED_EMISSIVE_SCALE,
                });
            }
            console.log(`[AwakenedStore] Loaded ${parsed.entries.length} awakened entries`);
        } catch (e) {
            console.warn('[AwakenedStore] localStorage load failed:', e);
        }
    }

    /** Idempotent — no-op if already awake */
    set(persistentId: number, meta?: Partial<AwakenedMeta>): boolean {
        if (!this.isEnabled() || !persistentId) return false;

        const isNew = !this.awakened.has(persistentId);
        const existing = this.meta.get(persistentId);

        const merged: AwakenedMeta = {
            type: meta?.type ?? existing?.type ?? 'unknown',
            biome: meta?.biome ?? existing?.biome,
            awakenedAt: existing?.awakenedAt ?? meta?.awakenedAt ?? Date.now(),
            lastNoteColor: meta?.lastNoteColor ?? existing?.lastNoteColor,
            emissiveScale: meta?.emissiveScale ?? existing?.emissiveScale ?? DEFAULT_AWAKENED_EMISSIVE_SCALE,
        };

        this.awakened.add(persistentId);
        this.meta.set(persistentId, merged);
        this.dirty = true;

        this.applyVisualState(persistentId, merged);
        this.scheduleDebouncedSave();

        if (isNew && !this.analyticsFired.has(persistentId)) {
            this.analyticsFired.add(persistentId);
            trackEvent('entity_awakened', {
                entityId: String(persistentId),
                type: merged.type,
                biome: merged.biome ?? 'unknown',
            });
        }

        return isNew;
    }

    getMeta(persistentId: number): AwakenedMeta | undefined {
        return this.meta.get(persistentId);
    }

    isAwakened(persistentId: number): boolean {
        return this.awakened.has(persistentId);
    }

    /** Reused output buffer — no allocation */
    getAwakenedIds(out: number[]): number {
        out.length = 0;
        for (const id of this.awakened) {
            out.push(id);
        }
        return out.length;
    }

    registerPlacedEntity(
        persistentId: number,
        type: string,
        biome: string | undefined,
        position: THREE.Vector3,
        refs: BatcherInstanceRef[] = []
    ): void {
        if (!this.isEnabled() || !AWAKENABLE_TYPES.has(type)) return;

        const existing = this.placed.get(persistentId);
        if (existing) {
            existing.refs.push(...refs);
        } else {
            this.placed.set(persistentId, {
                persistentId,
                type,
                biome,
                position: position.clone(),
                refs: [...refs],
            });
        }

        if (this.awakened.has(persistentId)) {
            this.applyVisualState(persistentId, this.meta.get(persistentId));
        }
    }

    tryAwakenNearby(
        type: string,
        origin: THREE.Vector3,
        intensity: number,
        lastNoteColor?: number
    ): void {
        if (!this.isEnabled() || intensity < 0.2 || !AWAKENABLE_TYPES.has(type)) return;

        for (const placed of this.placed.values()) {
            if (placed.type !== type) continue;
            if (this.awakened.has(placed.persistentId)) continue;
            const dx = placed.position.x - origin.x;
            const dz = placed.position.z - origin.z;
            if (dx * dx + dz * dz > AWAKEN_RADIUS_SQ) continue;

            this.set(placed.persistentId, {
                type: placed.type,
                biome: placed.biome,
                lastNoteColor,
            });
        }
    }

    /** Drop orphans (no live instance) and bulk-upload GPU state */
    reconcileAndApplyToBatchers(): void {
        if (!this.isEnabled()) return;

        const knownIds = luminousPlantBatcher.getKnownPersistentIds();
        let dropped = 0;

        for (const id of [...this.awakened]) {
            if (!knownIds.has(id) && !this.placed.has(id)) {
                this.awakened.delete(id);
                this.meta.delete(id);
                dropped++;
                this.dirty = true;
            }
        }

        const bulkEntries: Array<{ persistentId: number; scale: number }> = [];
        for (const id of this.awakened) {
            const meta = this.meta.get(id);
            if (!meta) continue;
            if (knownIds.has(id) || this.placed.has(id)) {
                bulkEntries.push({ persistentId: id, scale: meta.emissiveScale });
            }
        }

        luminousPlantBatcher.applyAwakenedBulk(bulkEntries);

        if (bulkEntries.length > 0 || dropped > 0) {
            console.log(`[AwakenedStore] Applied ${bulkEntries.length} awakened states (${dropped} orphans dropped)`);
        }
    }

    /** @deprecated Use reconcileAndApplyToBatchers */
    applyLoadedStatesToBatchers(): void {
        this.reconcileAndApplyToBatchers();
    }

    serialize(): AwakenedFloraState[] {
        if (!this.isEnabled() || isHeadless()) return [];
        const out: AwakenedFloraState[] = [];
        for (const id of this.awakened) {
            const meta = this.meta.get(id);
            if (!meta) continue;
            out.push({
                persistentId: id,
                entityId: String(id),
                id: String(id),
                type: meta.type,
                biome: meta.biome,
                awakenedAt: meta.awakenedAt,
                lastNoteColor: meta.lastNoteColor,
                emissiveScale: meta.emissiveScale,
                awakened: true,
            });
        }
        return out;
    }

    deserialize(data: AwakenedFloraState[]): void {
        if (!this.isEnabled() || isHeadless()) return;
        this.awakened.clear();
        this.meta.clear();
        for (const raw of data) {
            const normalized = normalizeLegacyState(raw);
            if (!normalized) continue;
            this.awakened.add(normalized.id);
            this.meta.set(normalized.id, normalized.meta);
        }
    }

    exportSnapshot(): string {
        const payload: StoredPayload = {
            version: AWAKENED_SCHEMA_VERSION,
            entries: [],
        };
        for (const id of this.awakened) {
            const m = this.meta.get(id);
            if (!m) continue;
            payload.entries.push({
                id,
                t: m.type,
                b: m.biome,
                at: m.awakenedAt,
                c: m.lastNoteColor,
                e: m.emissiveScale,
            });
        }
        return JSON.stringify(payload);
    }

    importSnapshot(json: string): void {
        if (!this.isEnabled()) return;
        try {
            const parsed = JSON.parse(json) as StoredPayload;
            if (parsed.version !== AWAKENED_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
                console.warn('[AwakenedStore] importSnapshot: schema mismatch');
                return;
            }
            this.awakened.clear();
            this.meta.clear();
            for (const entry of parsed.entries) {
                this.awakened.add(entry.id);
                this.meta.set(entry.id, {
                    type: entry.t,
                    biome: entry.b,
                    awakenedAt: entry.at,
                    lastNoteColor: entry.c,
                    emissiveScale: entry.e ?? DEFAULT_AWAKENED_EMISSIVE_SCALE,
                });
            }
            this.dirty = true;
            this.saveSync();
            this.reconcileAndApplyToBatchers();
        } catch (e) {
            console.warn('[AwakenedStore] importSnapshot failed:', e);
        }
    }

    reset(): void {
        this.awakened.clear();
        this.meta.clear();
        this.placed.clear();
        this.analyticsFired.clear();
        this.dirty = false;
        if (this.storageAvailable) {
            try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        }
    }

    getTotalAwakenedCount(): number {
        return this.awakened.size;
    }

    // -------------------------------------------------------------------------
    // Debug / dev
    // -------------------------------------------------------------------------

    debugAwaken(persistentId: number, emissiveScale = DEFAULT_AWAKENED_EMISSIVE_SCALE): void {
        if (!this.isEnabled()) {
            console.warn('[AwakenedStore] debugAwaken: flag off (?awakened)');
            return;
        }
        this.set(persistentId, { type: 'luminous_plant', biome: 'luminous_plants', emissiveScale });
        this.saveSync();
        console.log(`[AwakenedStore] debugAwaken(${persistentId})`);
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    private scheduleDebouncedSave(): void {
        if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            this.saveSync();
            saveSystem.triggerEventSave('entity_awakened');
        }, SAVE_DEBOUNCE_MS);
    }

    saveSync(): void {
        if (!this.isEnabled() || !this.storageAvailable || !this.dirty) return;
        try {
            const payload: StoredPayload = {
                version: AWAKENED_SCHEMA_VERSION,
                entries: [],
            };
            for (const id of this.awakened) {
                const m = this.meta.get(id);
                if (!m) continue;
                payload.entries.push({
                    id,
                    t: m.type,
                    b: m.biome,
                    at: m.awakenedAt,
                    c: m.lastNoteColor,
                    e: m.emissiveScale,
                });
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            this.dirty = false;
        } catch (e) {
            console.warn('[AwakenedStore] localStorage write failed:', e);
        }
    }

    flushPendingSave(): void {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        this.saveSync();
    }

    private ensureBeforeUnload(): void {
        if (this.beforeUnloadBound || typeof window === 'undefined') return;
        this.beforeUnloadBound = true;
        window.addEventListener('beforeunload', () => {
            this.flushPendingSave();
        });
    }

    private checkStorage(): boolean {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return false;
            const k = '__awakened_test__';
            localStorage.setItem(k, '1');
            localStorage.removeItem(k);
            return true;
        } catch {
            return false;
        }
    }

    private applyVisualState(persistentId: number, meta?: AwakenedMeta): void {
        if (!meta) return;
        const scale = meta.emissiveScale;
        const placed = this.placed.get(persistentId);
        if (placed) {
            for (const ref of placed.refs) {
                if (ref.batcher === 'luminous') {
                    luminousPlantBatcher.applyAwakenedState(persistentId, scale);
                }
            }
        } else if (luminousPlantBatcher.hasPersistentId(persistentId)) {
            luminousPlantBatcher.applyAwakenedState(persistentId, scale);
        }
    }
}

// =============================================================================
// Lazy singleton — never constructed when flag is off
// =============================================================================

let _store: AwakenedStore | null = null;

export function getAwakenedStore(): AwakenedStore | null {
    if (!FEATURE_FLAGS.awakenedPersistence || isHeadless()) return null;
    if (!_store) {
        _store = new AwakenedStore();
        _store.load();
    }
    return _store;
}

/** Resolve stable persistentId from a placed object */
export function resolvePersistentId(obj: THREE.Object3D): number {
    const ud = obj.userData;
    if (typeof ud.persistentId === 'number') {
        return ud.persistentId >>> 0;
    }
    if (typeof ud.persistentId === 'string' && ud.persistentId.length > 0) {
        return persistentIdFromString(ud.persistentId);
    }
    if (typeof ud.mapEntityId === 'string' && ud.mapEntityId.length > 0) {
        return persistentIdFromString(ud.mapEntityId);
    }
    obj.getWorldPosition(_scratchPos);
    const typeId = (typeof ud.type === 'string' && ud.type) ? ud.type : 'unknown';
    return computePersistentId(_scratchPos.x, _scratchPos.z, typeId);
}

// =============================================================================
// Facade for existing call sites (music-reactivity, placement hooks, save)
// =============================================================================

function store(): AwakenedStore | null {
    return getAwakenedStore();
}

export const awakenedPersistence = {
    isEnabled(): boolean {
        return FEATURE_FLAGS.awakenedPersistence && !isHeadless();
    },

    resolvePersistentId,

    registerPlacedEntity(
        persistentId: number,
        type: string,
        biome: string | undefined,
        position: THREE.Vector3,
        refs: BatcherInstanceRef[] = []
    ): void {
        store()?.registerPlacedEntity(persistentId, type, biome, position, refs);
    },

    markAwakened(
        persistentId: number,
        meta: { type: string; biome?: string; lastNoteColor?: number; emissiveScale?: number }
    ): boolean {
        return store()?.set(persistentId, meta) ?? false;
    },

    isAwakened(persistentId: number): boolean {
        return store()?.isAwakened(persistentId) ?? false;
    },

    getState(persistentId: number): AwakenedMeta | undefined {
        return store()?.getMeta(persistentId);
    },

    tryAwakenNearby(
        type: string,
        origin: THREE.Vector3,
        intensity: number,
        lastNoteColor?: number
    ): void {
        store()?.tryAwakenNearby(type, origin, intensity, lastNoteColor);
    },

    applyLoadedStatesToBatchers(): void {
        store()?.reconcileAndApplyToBatchers();
    },

    reconcileOrphans(): number {
        const s = store();
        if (!s) return 0;
        const before = s.getTotalAwakenedCount();
        s.reconcileAndApplyToBatchers();
        return before - s.getTotalAwakenedCount();
    },

    serialize(): AwakenedFloraState[] {
        return store()?.serialize() ?? [];
    },

    deserialize(data: AwakenedFloraState[]): void {
        store()?.deserialize(data);
    },

    reset(): void {
        store()?.reset();
        _store = null;
    },

    getTotalAwakenedCount(): number {
        return store()?.getTotalAwakenedCount() ?? 0;
    },

    /** @deprecated Use getAwakenedStore */
    loadFromLocalStorage(): void {
        store()?.load();
    },

    debugAwaken(persistentId: number, emissiveScale?: number): void {
        store()?.debugAwaken(persistentId, emissiveScale);
    },

    exportSnapshot(): string {
        return store()?.exportSnapshot() ?? '{"version":1,"entries":[]}';
    },

    importSnapshot(json: string): void {
        store()?.importSnapshot(json);
    },
};

/** @deprecated Use AwakenedStore */
export { AwakenedStore as AwakenedPersistenceManager };

if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.awakenedPersistence = awakenedPersistence;
    w.debugAwaken = (id: number) => awakenedPersistence.debugAwaken(id);
}

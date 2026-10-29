/**
 * Lazy awakened-flora facade — hot path imports this instead of awakened-persistence.ts
 * so the ~20 KB of persistence logic loads in its own chunk after boot, not in `app`.
 */
import * as THREE from 'three';
import { FEATURE_FLAGS } from '../core/config.ts';
import { resolvePersistentId } from './awakened-resolve.ts';
import type { BatcherInstanceRef, AwakenedMeta } from './awakened-types.ts';

type AwakenedModule = typeof import('./awakened-persistence.ts');

let _mod: AwakenedModule | null = null;
let _load: Promise<AwakenedModule | null> | null = null;
let _eventSaveTrigger: ((eventType: string) => void) | null = null;

function ensure(): Promise<AwakenedModule | null> {
    if (!FEATURE_FLAGS.awakenedPersistence) return Promise.resolve(null);
    if (_mod) return Promise.resolve(_mod);
    if (!_load) {
        _load = import('./awakened-persistence.ts').then((m) => {
            _mod = m;
            if (_eventSaveTrigger) m.setEventSaveTrigger(_eventSaveTrigger);
            return m;
        });
    }
    return _load;
}

export type { BatcherInstanceRef, AwakenedMeta, AwakenedBatcherKind } from './awakened-types.ts';
export { resolvePersistentId } from './awakened-resolve.ts';

export function initAwakenedPersistenceIfNeeded(): void {
    void ensure();
}

export function getAwakenedStore(): ReturnType<AwakenedModule['getAwakenedStore']> {
    return _mod?.getAwakenedStore() ?? null;
}

export const awakenedPersistence = {
    isEnabled(): boolean {
        return (
            FEATURE_FLAGS.awakenedPersistence && (_mod?.awakenedPersistence.isEnabled() ?? false)
        );
    },

    resolvePersistentId,

    registerPlacedEntity(
        persistentId: number,
        type: string,
        biome: string | undefined,
        position: THREE.Vector3,
        refs: BatcherInstanceRef[] = []
    ): void {
        void ensure().then((m) =>
            m?.awakenedPersistence.registerPlacedEntity(persistentId, type, biome, position, refs)
        );
    },

    markAwakened(
        persistentId: number,
        meta: { type: string; biome?: string; lastNoteColor?: number; emissiveScale?: number }
    ): boolean {
        if (!FEATURE_FLAGS.awakenedPersistence) return false;
        const store = _mod?.getAwakenedStore();
        if (store) return _mod!.awakenedPersistence.markAwakened(persistentId, meta);
        void ensure().then((m) => m?.awakenedPersistence.markAwakened(persistentId, meta));
        return false;
    },

    isAwakened(persistentId: number): boolean {
        return _mod?.awakenedPersistence.isAwakened(persistentId) ?? false;
    },

    /** The type of the awakenable flora placed under this id, if one is (and the store is loaded). */
    placedType(persistentId: number): string | undefined {
        return _mod?.awakenedPersistence.placedType(persistentId);
    },

    getState(persistentId: number): AwakenedMeta | undefined {
        return _mod?.awakenedPersistence.getState(persistentId);
    },

    tryAwakenNearby(
        type: string,
        origin: THREE.Vector3,
        intensity: number,
        lastNoteColor?: number
    ): void {
        if (!FEATURE_FLAGS.awakenedPersistence) return;
        if (_mod) {
            _mod.awakenedPersistence.tryAwakenNearby(type, origin, intensity, lastNoteColor);
            return;
        }
        void ensure().then((m) =>
            m?.awakenedPersistence.tryAwakenNearby(type, origin, intensity, lastNoteColor)
        );
    },

    applyLoadedStatesToBatchers(): void {
        void ensure().then((m) => m?.awakenedPersistence.applyLoadedStatesToBatchers());
    },

    reconcileOrphans(): number {
        return _mod?.awakenedPersistence.reconcileOrphans() ?? 0;
    },

    serialize(): ReturnType<AwakenedModule['awakenedPersistence']['serialize']> {
        return _mod?.awakenedPersistence.serialize() ?? [];
    },

    /** Awakened flora so far (0 until the module loads). Allocation-free. */
    count(): number {
        return _mod?.getAwakenedStore()?.getTotalAwakenedCount() ?? 0;
    },

    /**
     * Union `records` into the live store (a loaded WorldDocument), keeping
     * whatever is already awake. Waits for the module, unlike `deserialize`
     * on a cold store, which would drop entries loaded after it ran.
     */
    merge(
        records: Parameters<AwakenedModule['awakenedPersistence']['deserialize']>[0]
    ): Promise<void> {
        return ensure().then((m) => {
            if (!m || records.length === 0) return;
            const live = m.awakenedPersistence.serialize();
            const known = new Set(live.map((r) => r.persistentId));
            const merged = live.concat(records.filter((r) => !known.has(r.persistentId)));
            m.awakenedPersistence.deserialize(merged);
            m.awakenedPersistence.applyLoadedStatesToBatchers();
        });
    },

    deserialize(data: Parameters<AwakenedModule['awakenedPersistence']['deserialize']>[0]): void {
        void ensure().then((m) => m?.awakenedPersistence.deserialize(data));
    },

    reset(): void {
        void ensure().then((m) => m?.awakenedPersistence.reset());
    },

    /** save-system.ts registers its event save here; the store calls it after persisting. */
    setEventSaveTrigger(trigger: (eventType: string) => void): void {
        _eventSaveTrigger = trigger;
        _mod?.setEventSaveTrigger(trigger);
    },
};

/**
 * @deprecated Use awakened-persistence.ts — thin re-export for backward compatibility.
 */
export {
    AwakenedPersistenceManager as FloraPersistenceManager,
    awakenedPersistence as floraPersistenceManager,
    DEFAULT_AWAKENED_EMISSIVE_SCALE,
} from './awakened-persistence.ts';

export type { AwakenedFloraState } from './save-system/save-types.ts';

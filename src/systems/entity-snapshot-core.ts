/**
 * Typed, versioned per-entity snapshots.
 *
 * An `EntitySnapshot` is plain JSON built ON TOP of the canonical
 * `CandyMapEntity` record that lives in `assets/map.json`, so a snapshot is
 * trivially diffable against / mergeable with the authored map.
 *
 * Composition, not reimplementation:
 *   - serialize  → `world/map-entity-record.ts` (extracted from `map-exporter.ts`)
 *   - restore    → `processMapEntity` (injected; see `entity-snapshot.ts`)
 *   - versioning → the `save-system/save-types.ts` migration idiom
 *
 * This module is renderer-free and importable from a plain Node test.
 */

import * as THREE from 'three';
import type { WeatherSystem } from '../world/generation-utils.ts';
import { buildEntityFromObject, round } from '../world/map-entity-record.ts';
import type { CandyMapEntity } from '../world/map-loader.ts';
import { computePersistentId } from './awakened-persistent-id.ts';

/** Bump when the snapshot envelope changes; add a matching step to MIGRATIONS. */
export const CURRENT_SNAPSHOT_VERSION = 2;

/** Authored animation metadata that survives the map.json round-trip. */
export interface EntitySnapshotUserData {
    animationType?: string;
    animationOffset?: number;
    animationSpeed?: number;
}

export interface EntitySnapshot {
    /** Integer; stamped to CURRENT only after migration. */
    schemaVersion: number;
    /** Stable, generated at snapshot time — never the position hash. */
    id: string;
    /** The canonical map.json record. */
    entity: CandyMapEntity;
    userData?: EntitySnapshotUserData;
    /** Biome / music-binding tags, sorted and de-duplicated. */
    tags?: string[];
    /** awakened-persistence position hash — legacy lookup of pre-existing flora only. */
    legacyPositionHash?: string;
}

export interface SnapshotOptions {
    /** Stable id to stamp; one is generated when omitted. */
    id?: string;
    /** Include the legacy awakened-persistence position hash (default: true). */
    includeLegacyHash?: boolean;
}

/**
 * The authored transform, stashed on the object at restore/placement time.
 *
 * Batchers bake scale (and often a randomized yaw) into geometry, so the CPU
 * mirror's `Object3D` no longer reports what the author asked for. Anything
 * that places or edits an entity records the authored values here so the next
 * snapshot is lossless. Editors that move/rescale an entity MUST re-stamp it.
 */
export interface AuthoredTransform {
    scale?: CandyMapEntity['scale'];
    rotation?: CandyMapEntity['rotation'];
}

const AUTHORED_KEY = 'snapshotAuthored';

let _idCounter = 0;

/** Monotonic, collision-resistant snapshot id. Never derived from position. */
export function nextSnapshotId(prefix = 'snap'): string {
    _idCounter++;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${_idCounter.toString(36)}_${rand}`;
}

/** Record the authored transform on a live object (see `AuthoredTransform`). */
export function markAuthoredTransform(obj: THREE.Object3D, authored: AuthoredTransform): void {
    if (!obj) return;
    const stored: AuthoredTransform = {};
    if (authored.scale !== undefined) stored.scale = authored.scale;
    if (authored.rotation !== undefined) stored.rotation = authored.rotation;
    obj.userData[AUTHORED_KEY] = stored;
}

export function getAuthoredTransform(obj: THREE.Object3D): AuthoredTransform | undefined {
    const authored = obj?.userData?.[AUTHORED_KEY];
    return authored && typeof authored === 'object' ? (authored as AuthoredTransform) : undefined;
}

function deriveTags(entity: CandyMapEntity, obj?: THREE.Object3D): string[] {
    const tags = new Set<string>();
    if (entity.biome) tags.add(`biome:${entity.biome}`);
    const music = entity.music as Record<string, unknown> | undefined;
    if (music) {
        const biomeTag = music.biomeTag ?? music.biome ?? music.biomeOverride;
        if (typeof biomeTag === 'string') tags.add(`music:${biomeTag}`);
        if (typeof music.reactivityProfile === 'string')
            tags.add(`profile:${music.reactivityProfile}`);
        if (Number.isInteger(music.trackerChannel)) tags.add(`channel:${music.trackerChannel}`);
    }
    if (typeof entity.note === 'string') tags.add(`note:${entity.note}`);
    const reactivityType = obj?.userData?.reactivityType;
    if (typeof reactivityType === 'string') tags.add(`reactivity:${reactivityType}`);
    return [...tags].sort();
}

/**
 * Snapshot ONE logical entity.
 *
 * For a batched entity this is the batcher's CPU mirror `Object3D` — the
 * authored unit. The transform is read from that CPU object (and from the
 * authored transform stamped alongside it); an `InstancedMesh`'s
 * `instanceMatrix` is never read back, and `mapAsync` is never called.
 *
 * Returns `null` for objects that carry no exportable map type.
 */
export function snapshotEntity(
    obj: THREE.Object3D,
    idOrOptions?: string | SnapshotOptions
): EntitySnapshot | null {
    const options: SnapshotOptions =
        typeof idOrOptions === 'string' ? { id: idOrOptions } : (idOrOptions ?? {});

    const entity = buildEntityFromObject(obj, 0);
    if (!entity) return null;

    const id = options.id ?? nextSnapshotId();
    entity.id = id;

    // The authored transform wins: batchers bake scale/yaw into geometry, so the
    // CPU mirror reports an identity transform that would silently lose them.
    const authored = getAuthoredTransform(obj);
    if (authored?.scale !== undefined) entity.scale = authored.scale;
    if (authored?.rotation !== undefined) entity.rotation = authored.rotation;

    const snapshot: EntitySnapshot = {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: canonicalizeEntity(entity),
        tags: deriveTags(entity, obj),
    };

    const userData: EntitySnapshotUserData = {};
    if (typeof obj.userData?.animationType === 'string')
        userData.animationType = obj.userData.animationType;
    if (typeof obj.userData?.animationOffset === 'number')
        userData.animationOffset = round(obj.userData.animationOffset, 6);
    if (typeof obj.userData?.animationSpeed === 'number')
        userData.animationSpeed = round(obj.userData.animationSpeed, 6);
    for (const _ in userData) {
        snapshot.userData = userData;
        break;
    }

    if (options.includeLegacyHash !== false) {
        const [x, , z] = snapshot.entity.position;
        snapshot.legacyPositionHash = String(computePersistentId(x, z, snapshot.entity.type));
    }

    return snapshot;
}

const ENTITY_KEY_ORDER: (keyof CandyMapEntity)[] = [
    'id',
    'type',
    'persistentId',
    'position',
    'rotation',
    'scale',
    'variant',
    'size',
    'note',
    'noteIndex',
    'hasFace',
    'category',
    'layer',
    'biome',
    'music',
    'placement',
    'baseOffset',
    'critical',
    'isObstacle',
    'params',
];

function roundDeep(value: unknown, digits: number): unknown {
    if (typeof value === 'number') return Number.isFinite(value) ? round(value, digits) : value;
    if (Array.isArray(value)) return value.map((v) => roundDeep(v, digits));
    if (value && typeof value === 'object') {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(src).sort()) {
            if (src[key] === undefined) continue;
            out[key] = roundDeep(src[key], digits);
        }
        return out;
    }
    return value;
}

/**
 * Canonical form of a map record: rounded floats and a stable key order, so two
 * records can be compared semantically (never by `JSON.stringify` of Three.js
 * internals).
 */
export function canonicalizeEntity(entity: CandyMapEntity): CandyMapEntity {
    const out: Record<string, unknown> = {};
    for (const key of ENTITY_KEY_ORDER) {
        const value = entity[key];
        if (value === undefined) continue;
        // Quaternion components keep 6 digits; everything else 4 (matches the exporter).
        const digits = key === 'rotation' ? 6 : 4;
        out[key] = roundDeep(value, digits);
    }
    for (const key of Object.keys(entity).sort()) {
        if (key in out) continue;
        const value = (entity as unknown as Record<string, unknown>)[key];
        if (value === undefined) continue;
        out[key] = roundDeep(value, 4);
    }
    return out as unknown as CandyMapEntity;
}

// ---------------------------------------------------------------------------
// MIGRATIONS — linear v → v+1, mirroring save-types.ts `MigrationFunction`.
// ---------------------------------------------------------------------------

type SnapshotMigration = (data: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, SnapshotMigration> = {
    /**
     * v1 → v2: v1 stored the awakened position hash as the general-purpose
     * `positionHash`; v2 demotes it to `legacyPositionHash` (lookup of
     * pre-existing flora only) and guarantees a `tags` array.
     */
    1: (data) => {
        const next = { ...data };
        if (next.positionHash !== undefined && next.legacyPositionHash === undefined) {
            next.legacyPositionHash = String(next.positionHash);
        }
        delete next.positionHash;
        if (!Array.isArray(next.tags)) next.tags = [];
        return next;
    },
};

/**
 * Migrate a raw (possibly older) snapshot to the current shape.
 * Rejects snapshots written by a newer version; stamps CURRENT only after all
 * steps have run.
 */
export function migrateSnapshot(raw: unknown): EntitySnapshot {
    if (!raw || typeof raw !== 'object') {
        throw new Error('[EntitySnapshot] Cannot migrate a non-object snapshot');
    }

    let data = { ...(raw as Record<string, unknown>) };
    const rawVersion = data.schemaVersion;
    let version =
        typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? Math.floor(rawVersion) : 1;

    if (version > CURRENT_SNAPSHOT_VERSION) {
        throw new Error(
            `[EntitySnapshot] Cannot load snapshot from future version ${version} (current ${CURRENT_SNAPSHOT_VERSION})`
        );
    }

    while (version < CURRENT_SNAPSHOT_VERSION) {
        const step = MIGRATIONS[version];
        if (!step) {
            throw new Error(`[EntitySnapshot] Missing migration step for version ${version}`);
        }
        data = step(data);
        version++;
    }

    if (!data.entity || typeof data.entity !== 'object') {
        throw new Error('[EntitySnapshot] Snapshot is missing its map entity record');
    }
    if (typeof data.id !== 'string' || data.id.length === 0) {
        data.id = nextSnapshotId();
    }

    data.schemaVersion = CURRENT_SNAPSHOT_VERSION;
    return data as unknown as EntitySnapshot;
}

// ---------------------------------------------------------------------------
// RESTORE
// ---------------------------------------------------------------------------

/** The record handed to `processMapEntity` (migrated, id-stamped). */
export function toRestoreRecord(snapshot: EntitySnapshot): CandyMapEntity {
    const current = migrateSnapshot(snapshot);
    return { ...current.entity, id: current.id };
}

export interface RestoreDeps {
    /** The existing registration path — `processMapEntity` in production. */
    processEntity: (item: CandyMapEntity, weatherSystem: WeatherSystem | null) => void;
    weatherSystem?: WeatherSystem | null;
    /**
     * Live registry the registration path appends to (`animatedFoliage`), used
     * to find the objects this restore created so their authored transform and
     * animation metadata can be stamped.
     */
    registry?: THREE.Object3D[];
    /** Called once after the restore when collidables were added (`populatePhysicsGrids`). */
    onCollidersChanged?: () => void;
}

/**
 * Restore one snapshot through an injected registration path.
 *
 * Production wiring lives in `entity-snapshot.ts`; the injection seam exists so
 * the record/migration logic stays testable without booting the world.
 */
export function restoreEntityWith(snapshot: EntitySnapshot, deps: RestoreDeps): THREE.Object3D[] {
    const current = migrateSnapshot(snapshot);
    const record = { ...current.entity, id: current.id };
    const registry = deps.registry;
    const before = registry ? registry.length : 0;

    deps.processEntity(record, deps.weatherSystem ?? null);

    const created = registry ? registry.slice(before) : [];
    for (const obj of created) {
        if (!obj) continue;
        markAuthoredTransform(obj, { scale: record.scale, rotation: record.rotation });
        obj.userData.mapEntityId = current.id;
        if (current.userData?.animationType)
            obj.userData.animationType = current.userData.animationType;
        if (current.userData?.animationOffset !== undefined)
            obj.userData.animationOffset = current.userData.animationOffset;
        if (current.userData?.animationSpeed !== undefined)
            obj.userData.animationSpeed = current.userData.animationSpeed;
    }

    deps.onCollidersChanged?.();
    return created;
}

/**
 * Apply a snapshot's transform + authored metadata onto an existing object,
 * without going through the registration path.
 */
export function applyEntitySnapshot(snapshot: EntitySnapshot, obj: THREE.Object3D): void {
    const current = migrateSnapshot(snapshot);
    const { position, rotation, scale } = current.entity;

    if (position) obj.position.set(position[0], position[1], position[2]);
    if (rotation !== undefined && rotation !== null) {
        if (typeof rotation === 'number') {
            obj.rotation.y = rotation;
        } else if (Array.isArray(rotation)) {
            if (rotation.length === 4) {
                const [qx, qy, qz, qw] = rotation as [number, number, number, number];
                obj.quaternion.set(qx, qy, qz, qw);
            } else if (rotation.length === 3) {
                obj.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ');
            }
        } else if (typeof rotation === 'object') {
            if ('quat' in rotation && Array.isArray(rotation.quat)) {
                const [qx, qy, qz, qw] = rotation.quat;
                obj.quaternion.set(qx, qy, qz, qw);
            } else if ('euler' in rotation && Array.isArray(rotation.euler)) {
                const [rx, ry, rz] = rotation.euler;
                const order =
                    rotation.order &&
                    ['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'].includes(rotation.order)
                        ? rotation.order
                        : 'YXZ';
                obj.rotation.set(rx, ry, rz, order as THREE.EulerOrder);
            }
        }
    }
    if (scale !== undefined) {
        if (Array.isArray(scale)) obj.scale.set(scale[0], scale[1], scale[2]);
        else if (typeof scale === 'number') obj.scale.setScalar(scale);
    }

    markAuthoredTransform(obj, { scale: current.entity.scale, rotation: current.entity.rotation });

    if (current.userData) {
        if (current.userData.animationType)
            obj.userData.animationType = current.userData.animationType;
        if (current.userData.animationOffset !== undefined)
            obj.userData.animationOffset = current.userData.animationOffset;
        if (current.userData.animationSpeed !== undefined)
            obj.userData.animationSpeed = current.userData.animationSpeed;
    }

    obj.userData.mapEntityId = current.id;
    if (current.entity.type) obj.userData.type = current.entity.type;
    if (current.entity.variant) obj.userData.variant = current.entity.variant;
    if (current.entity.note) obj.userData.note = current.entity.note;
    if (current.entity.noteIndex !== undefined) obj.userData.noteIndex = current.entity.noteIndex;
}

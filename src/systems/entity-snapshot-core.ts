import * as THREE from 'three';
import { normalizeMapEntityType } from '../world/generation-utils.ts';
import type { CandyMapEntity } from '../world/map-loader.ts';

export const CURRENT_SNAPSHOT_VERSION = 1;

export interface EntitySnapshot {
    schemaVersion: number;
    id: string; // generated, monotonic or UUID, not position hash
    entity: CandyMapEntity; // map.json record
    userData?: {
        animationType?: string;
        animationOffset?: number;
        animationSpeed?: number;
    };
    tags?: string[];
    legacyPositionHash?: string;
}

/**
 * Creates a stable map snapshot of a single instantiated foliage object.
 * Extracts the canonical CandyMapEntity via map-exporter logic, and tags it with a stable ID.
 */
export function snapshotEntity(
    obj: THREE.Object3D,
    id: string
): EntitySnapshot | null {
    // Basic export metadata extraction, matching map-exporter's buildEntityFromObject
    const exportMeta = (obj.userData?.mapExport ?? {}) as Record<string, unknown>;
    const mappedType = normalizeMapEntityType(
        (exportMeta.type as string) ?? obj.userData?.mapEntityType ?? obj.userData?.type
    );
    if (!mappedType) return null;

    const _worldPos = new THREE.Vector3();
    const _worldQuat = new THREE.Quaternion();
    const _worldScale = new THREE.Vector3();
    obj.getWorldPosition(_worldPos);
    obj.getWorldQuaternion(_worldQuat);
    obj.getWorldScale(_worldScale);

    const provenance = typeof exportMeta.provenance === 'string' ? exportMeta.provenance : 'runtime';
    const sourceId = typeof exportMeta.sourceId === 'string' ? exportMeta.sourceId : undefined;

    // Helper: round floats
    const round = (val: number, decimals = 4) => {
        const p = Math.pow(10, decimals);
        return Math.round(val * p) / p;
    };

    // Helper: normalize scale
    const normalizeScale = (s: THREE.Vector3) => {
        const sx = round(s.x);
        const sy = round(s.y);
        const sz = round(s.z);
        if (Math.abs(sx - sy) < 0.0001 && Math.abs(sy - sz) < 0.0001) return sx;
        return [sx, sy, sz] as [number, number, number];
    };

    const params: Record<string, unknown> = exportMeta.params && typeof exportMeta.params === 'object'
        ? { ...(exportMeta.params as Record<string, unknown>) }
        : {};

    params.provenance = provenance;
    if (sourceId) params.sourceId = sourceId;
    if (obj.userData?.isBatched) params.batched = true;

    // Add note info if missing from params but present on entity
    const note = exportMeta.note ?? obj.userData?.note;
    const noteIndex = exportMeta.noteIndex ?? obj.userData?.noteIndex;
    if (note !== undefined && !params.note) params.note = note;
    if (noteIndex !== undefined && !params.noteIndex) params.noteIndex = noteIndex;

    const baseOffset = exportMeta.baseOffset ?? params.baseOffset;
    if (typeof baseOffset === 'number' && Number.isFinite(baseOffset)) {
        params.baseOffset = baseOffset;
    }

    const entity: CandyMapEntity = {
        type: mappedType,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: { quat: [round(_worldQuat.x, 6), round(_worldQuat.y, 6), round(_worldQuat.z, 6), round(_worldQuat.w, 6)] },
        scale: normalizeScale(_worldScale),
        params,
    };

    if (exportMeta.variant) entity.variant = String(exportMeta.variant);
    if (note !== undefined) entity.note = String(note);
    if (typeof noteIndex === 'number') entity.noteIndex = noteIndex;

    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity,
        userData: {
            animationType: obj.userData?.animationType,
            animationOffset: obj.userData?.animationOffset,
            animationSpeed: obj.userData?.animationSpeed,
        },
    };
}

/**
 * Migrates a raw snapshot object to the current version.
 * Will throw if the schema version is newer than currently supported.
 */
export function migrateSnapshot(raw: unknown): EntitySnapshot {
    const dataObj = raw as Record<string, unknown>;
    const version = (dataObj.schemaVersion as number) || 1;

    if (version > CURRENT_SNAPSHOT_VERSION) {
        throw new Error(`Cannot load snapshot from future version: ${version}`);
    }

    const data = { ...dataObj };

    // v1 -> v2, etc. migrations go here
    /*
    if (version === 1) {
        // ... transform ...
        version = 2;
    }
    */

    data.schemaVersion = CURRENT_SNAPSHOT_VERSION;
    return data as unknown as EntitySnapshot;
}

/**
 * Applies a snapshot directly to an existing Object3D.
 */
export function applyEntitySnapshot(snapshot: EntitySnapshot, obj: THREE.Object3D): void {
    const current = migrateSnapshot(snapshot);
    const { position, rotation, scale, params: _params } = current.entity;

    if (position) obj.position.set(position[0], position[1], position[2]);
    if (rotation) {
        if (typeof rotation === 'object' && 'quat' in rotation && Array.isArray(rotation.quat)) {
            const [qx, qy, qz, qw] = rotation.quat;
            obj.quaternion.set(qx, qy, qz, qw);
        } else if (typeof rotation === 'object' && 'euler' in rotation && Array.isArray(rotation.euler)) {
            const [rx, ry, rz] = rotation.euler;
            const order = rotation.order === 'XYZ' || rotation.order === 'YZX' || rotation.order === 'ZXY' || rotation.order === 'XZY' || rotation.order === 'YXZ' || rotation.order === 'ZYX'
                ? rotation.order
                : 'YXZ';
            obj.rotation.set(rx, ry, rz, order);
        } else if (Array.isArray(rotation) && rotation.length === 4) {
            const [qx, qy, qz, qw] = rotation as [number, number, number, number];
            obj.quaternion.set(qx, qy, qz, qw);
        } else if (Array.isArray(rotation) && rotation.length === 3) {
            obj.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ');
        } else if (typeof rotation === 'number') {
            obj.rotation.y = rotation;
        }
    }
    if (scale) {
        if (Array.isArray(scale)) {
            obj.scale.set(scale[0], scale[1], scale[2]);
        } else if (typeof scale === 'number') {
            obj.scale.setScalar(scale);
        }
    }

    if (current.userData) {
        if (current.userData.animationType) obj.userData.animationType = current.userData.animationType;
        if (current.userData.animationOffset !== undefined) obj.userData.animationOffset = current.userData.animationOffset;
        if (current.userData.animationSpeed !== undefined) obj.userData.animationSpeed = current.userData.animationSpeed;
    }

    if (current.entity.type) obj.userData.type = current.entity.type;
    if (current.entity.variant) obj.userData.variant = current.entity.variant;
    if (current.entity.note) obj.userData.note = current.entity.note;
    if (current.entity.noteIndex !== undefined) obj.userData.noteIndex = current.entity.noteIndex;
}

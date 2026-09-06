import * as THREE from 'three';
import { create } from '../world/foliage-registry.ts';

export interface EntitySnapshot {
    id: string;
    type: string;
    position: [number, number, number];
    rotation: { quat: [number, number, number, number] };
    scale: [number, number, number];
    persistentId?: string;
    variant?: string;
    note?: string;
    noteIndex?: number;
    hasFace?: boolean;
    category?: string;
    layer?: string;
    biome?: string;
    placement?: 'ground' | 'absolute' | 'offset';
    baseOffset?: number;
    music?: {
        biome?: string;
        biomeTag?: string;
        biomeOverride?: string;
        channels?: number[];
        intensityScale?: number;
        trackerChannel?: number;
        reactivityProfile?: string;
        noteColorOverride?: string;
    };
    params?: Record<string, unknown>;
}

const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();

function round(val: number, decimals = 4): number {
    const p = Math.pow(10, decimals);
    return Math.round(val * p) / p;
}

export function exportEntitySnapshot(obj: THREE.Object3D): EntitySnapshot | null {
    const mapExport = (obj.userData?.mapExport ?? {}) as Record<string, unknown>;

    // Attempt to extract the type
    let mappedType = mapExport.type as string | undefined;
    if (!mappedType) mappedType = obj.userData?.mapEntityType as string | undefined;
    if (!mappedType) mappedType = obj.userData?.type as string | undefined;

    if (!mappedType || typeof mappedType !== 'string') return null;

    obj.getWorldPosition(_worldPos);
    obj.getWorldQuaternion(_worldQuat);
    obj.getWorldScale(_worldScale);

    const snapshot: EntitySnapshot = {
        id: obj.userData?.mapEntityId || obj.uuid,
        type: mappedType,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: { quat: [round(_worldQuat.x, 6), round(_worldQuat.y, 6), round(_worldQuat.z, 6), round(_worldQuat.w, 6)] },
        scale: [round(_worldScale.x), round(_worldScale.y), round(_worldScale.z)]
    };

    if (obj.userData?.persistentId) {
        snapshot.persistentId = obj.userData.persistentId;
    }

    if (mapExport.variant || obj.userData?.variant) {
        snapshot.variant = mapExport.variant || obj.userData?.variant;
    }

    if (mapExport.note || obj.userData?.note) {
        snapshot.note = mapExport.note || obj.userData?.note;
    }

    if (mapExport.noteIndex !== undefined || obj.userData?.noteIndex !== undefined) {
        snapshot.noteIndex = mapExport.noteIndex ?? obj.userData?.noteIndex;
    }

    if (mapExport.hasFace !== undefined || obj.userData?.hasFace !== undefined) {
        snapshot.hasFace = mapExport.hasFace ?? obj.userData?.hasFace;
    }

    if (mapExport.category) snapshot.category = mapExport.category as string;
    if (mapExport.layer) snapshot.layer = mapExport.layer as string;
    if (mapExport.biome || obj.userData?.biome) snapshot.biome = (mapExport.biome || obj.userData?.biome) as string;
    if (mapExport.placement) snapshot.placement = mapExport.placement as any;
    if (mapExport.baseOffset !== undefined) snapshot.baseOffset = mapExport.baseOffset as number;

    if (mapExport.music || obj.userData?.music) {
        snapshot.music = (mapExport.music || obj.userData?.music) as any;
    }

    if (mapExport.params) {
        snapshot.params = mapExport.params as Record<string, unknown>;
    } else if (obj.userData?.params) {
        snapshot.params = obj.userData.params as Record<string, unknown>;
    }

    return snapshot;
}

export function importEntitySnapshot(snapshot: EntitySnapshot, applyToObj?: THREE.Object3D): THREE.Object3D | null {
    let obj = applyToObj;

    if (!obj) {
        // Prepare spawn parameters
        const params: Record<string, unknown> = { ...(snapshot.params || {}) };
        if (snapshot.variant !== undefined) params.variant = snapshot.variant;
        if (snapshot.note !== undefined) params.note = snapshot.note;
        if (snapshot.noteIndex !== undefined) params.noteIndex = snapshot.noteIndex;
        if (snapshot.hasFace !== undefined) params.hasFace = snapshot.hasFace;
        if (snapshot.persistentId !== undefined) params.persistentId = snapshot.persistentId;

        // Use the uniform scale if it is uniform
        if (snapshot.scale[0] === snapshot.scale[1] && snapshot.scale[1] === snapshot.scale[2]) {
            params.scale = snapshot.scale[0];
        } else {
            params.scale = snapshot.scale;
        }

        const created = create(snapshot.type, params);
        if (!created) {
            return null;
        }
        obj = created;
    }

    // Apply transforms
    obj.position.set(snapshot.position[0], snapshot.position[1], snapshot.position[2]);
    obj.quaternion.set(snapshot.rotation.quat[0], snapshot.rotation.quat[1], snapshot.rotation.quat[2], snapshot.rotation.quat[3]);
    obj.scale.set(snapshot.scale[0], snapshot.scale[1], snapshot.scale[2]);

    // Apply metadata back to userData
    obj.userData.mapEntityType = snapshot.type;
    obj.userData.mapEntityId = snapshot.id;
    if (snapshot.biome) obj.userData.biome = snapshot.biome;
    if (snapshot.persistentId) obj.userData.persistentId = snapshot.persistentId;
    if (snapshot.note) obj.userData.note = snapshot.note;
    if (snapshot.noteIndex !== undefined) obj.userData.noteIndex = snapshot.noteIndex;
    if (snapshot.hasFace !== undefined) obj.userData.hasFace = snapshot.hasFace;

    if (snapshot.music) {
        if (typeof snapshot.music.trackerChannel === 'number') obj.userData.trackerChannel = snapshot.music.trackerChannel;
        if (typeof snapshot.music.reactivityProfile === 'string') obj.userData.reactivityProfile = snapshot.music.reactivityProfile;
        if (typeof snapshot.music.intensityScale === 'number') obj.userData.reactivityIntensityScale = snapshot.music.intensityScale;
    }

    obj.userData.mapExport = {
        type: snapshot.type,
        sourceId: snapshot.id,
        provenance: 'snapshot',
        variant: snapshot.variant,
        note: snapshot.note,
        noteIndex: snapshot.noteIndex,
        hasFace: snapshot.hasFace,
        category: snapshot.category,
        layer: snapshot.layer,
        biome: snapshot.biome,
        music: snapshot.music,
        placement: snapshot.placement,
        baseOffset: snapshot.baseOffset,
        params: snapshot.params
    };

    return obj;
}

export function exportWorldSnapshots(objects: THREE.Object3D[]): EntitySnapshot[] {
    const snapshots: EntitySnapshot[] = [];
    for (let i = 0; i < objects.length; i++) {
        const snap = exportEntitySnapshot(objects[i]);
        if (snap) {
            snapshots.push(snap);
        }
    }
    return snapshots;
}

export function importWorldSnapshots(snapshots: EntitySnapshot[]): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (let i = 0; i < snapshots.length; i++) {
        const obj = importEntitySnapshot(snapshots[i]);
        if (obj) {
            objects.push(obj);
        }
    }
    return objects;
}

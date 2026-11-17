/**
 * Stable persistentId resolution without the awakened persistence store.
 */
import * as THREE from 'three';
import { computePersistentId, persistentIdFromString } from './awakened-persistent-id.ts';

const _scratchPos = new THREE.Vector3();

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
    const typeId = typeof ud.type === 'string' && ud.type ? ud.type : 'unknown';
    return computePersistentId(_scratchPos.x, _scratchPos.z, typeId);
}

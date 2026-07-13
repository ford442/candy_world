/**
 * Shared instanced LOD attribute helpers for foliage batchers.
 * Keeps `instanceLodFactor` in sync when buffers grow.
 */
import * as THREE from 'three';

export const INSTANCE_LOD_ATTR = 'instanceLodFactor';

export function initInstanceLodAttribute(mesh: THREE.InstancedMesh, capacity: number): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    mesh.geometry.setAttribute(INSTANCE_LOD_ATTR, attr);
    return attr;
}

export function ensureInstanceLodAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    const existing = mesh.geometry.getAttribute(INSTANCE_LOD_ATTR) as THREE.InstancedBufferAttribute | undefined;
    if (existing) return existing;
    return initInstanceLodAttribute(mesh, mesh.instanceMatrix.count);
}

export function copyInstanceLodOnGrow(
    oldMesh: THREE.InstancedMesh,
    newMesh: THREE.InstancedMesh,
    newCapacity: number
): void {
    const oldAttr = oldMesh.geometry.getAttribute(INSTANCE_LOD_ATTR) as THREE.InstancedBufferAttribute | undefined;
    const newAttr = initInstanceLodAttribute(newMesh, newCapacity);
    if (oldAttr) {
        newAttr.array.set(oldAttr.array);
    }
}

import * as THREE from 'three';
import { createClayMaterial, foliageMaterials } from './materials';

let grassMeshes: THREE.InstancedMesh[] = [];
const dummy = new THREE.Object3D();
const MAX_PER_MESH = 1000;

export function initGrassSystem(scene: THREE.Scene, count = 5000) {
    grassMeshes = [];
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);
    const mat = (foliageMaterials as Record<string, THREE.Material>).grass || createClayMaterial(0x7CFC00);
    const meshCount = Math.ceil(count / MAX_PER_MESH);
    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat as THREE.Material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        scene.add(mesh);
        grassMeshes.push(mesh);
    }
    return grassMeshes;
}

export function addGrassInstance(x: number, y: number, z: number) {
    const mesh = grassMeshes.find(m => (m.count < (m.instanceMatrix.count || 0)));
    if (!mesh) return;
    const index = mesh.count;
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

import * as THREE from 'three';
import { createClayMaterial, registerReactiveMaterial } from '../materials';

export function createVine(options: any = {}) {
  const { color = 0x228B22, length = 3 } = options;
  const group = new THREE.Group();
  for (let i = 0; i < length; i++) {
    const segmentGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
    const segment = new THREE.Mesh(segmentGeo, createClayMaterial(color) as any);
    segment.position.y = i * 0.5;
    segment.rotation.z = Math.sin(i * 0.5) * 0.2;
    group.add(segment);
  }
  group.userData.animationType = 'vineSway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'vine';
  return group;
}

export function createVineCluster(x: number, z: number) {
  const cluster = new THREE.Group();
  cluster.position.set(x, 0, z);
  for (let i = 0; i < 3; i++) {
    const vine = createVine();
    vine.position.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    cluster.add(vine);
  }
  return cluster;
}

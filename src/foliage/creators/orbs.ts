import * as THREE from 'three';
import { createClayMaterial, registerReactiveMaterial } from '../materials';
import type { CreateFoliageOptions } from '../types';

export function createFloatingOrb(options: CreateFoliageOptions = {}) {
  const { color = 0x87CEEB, size = 0.5 } = options as CreateFoliageOptions;
  const geo = new THREE.SphereGeometry(size, 16, 16);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }) as THREE.Material;
  registerReactiveMaterial(mat);
  const orb = new THREE.Mesh(geo, mat as THREE.Material);
  orb.castShadow = true;
  orb.userData.animationType = 'float';
  orb.userData.animationOffset = Math.random() * 10;
  orb.userData.type = 'orb';
  return orb;
}

export function createFloatingOrbCluster(x: number, z: number) {
  const cluster = new THREE.Group();
  cluster.position.set(x, 5, z);
  for (let i = 0; i < 3; i++) {
    const orb = createFloatingOrb();
    orb.position.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    cluster.add(orb);
  }
  return cluster;
}

export function createBalloonBush(options: CreateFoliageOptions = {}) {
  const { color = 0xFF4500 } = options as CreateFoliageOptions;
  const group = new THREE.Group();
  const sphereCount = 5 + Math.floor(Math.random() * 5);
  const mat = createClayMaterial(color);
  registerReactiveMaterial(mat);
  for (let i = 0; i < sphereCount; i++) {
    const r = 0.3 + Math.random() * 0.4;
    const geo = new THREE.SphereGeometry(r, 16, 16);
    const mesh = new THREE.Mesh(geo, mat as THREE.Material);
    mesh.position.set((Math.random() - 0.5) * 0.8, r + (Math.random()) * 0.8, (Math.random() - 0.5) * 0.8);
    mesh.castShadow = true;
    group.add(mesh);
  }
  group.userData.animationType = 'bounce';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'shrub';
  return group;
}

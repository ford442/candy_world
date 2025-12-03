import * as THREE from 'three';
import { createClayMaterial } from '../materials';
import { createGlowingFlower } from './flowers';

export function createRainingCloud(options: any = {}) {
  const { color = 0xB0C4DE, rainIntensity = 50 } = options;
  const group = new THREE.Group();
  const cloudGeo = new THREE.SphereGeometry(1.5, 16, 16);
  const cloudMat = createClayMaterial(color);
  const cloud = new THREE.Mesh(cloudGeo, cloudMat as any);
  cloud.castShadow = true;
  group.add(cloud);
  const rainGeo = new THREE.BufferGeometry();
  const rainCount = rainIntensity;
  const positions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 3;
    positions[i * 3 + 1] = Math.random() * -2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
  const rain = new THREE.Points(rainGeo, rainMat);
  group.add(rain);
  group.userData.animationType = 'rain';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'cloud';
  return group;
}

export function createGlowingFlowerPatch(x: number, z: number) {
  const patch = new THREE.Group();
  patch.position.set(x, 0, z);
  for (let i = 0; i < 5; i++) {
    const gf = createGlowingFlower();
    gf.position.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
    patch.add(gf);
  }
  return patch;
}

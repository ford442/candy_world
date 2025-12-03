import * as THREE from 'three';
import { createClayMaterial, foliageMaterials, registerReactiveMaterial } from '../materials';

export function createFloweringTree(options: any = {}) {
  const { color = 0xFF69B4 } = options;
  const group = new THREE.Group();
  const trunkH = 3 + Math.random() * 2;
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkH, 16);
  const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x8B5A2B));
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);
  const bloomMat = createClayMaterial(color);
  registerReactiveMaterial(bloomMat);
  const bloomCount = 5 + Math.floor(Math.random() * 5);
  for (let i = 0; i < bloomCount; i++) {
    const bloomGeo = new THREE.SphereGeometry(0.8 + Math.random() * 0.4, 16, 16);
    const bloom = new THREE.Mesh(bloomGeo, bloomMat as any);
    bloom.position.set((Math.random() - 0.5) * 2, trunkH + Math.random() * 1.5, (Math.random() - 0.5) * 2);
    bloom.castShadow = true;
    group.add(bloom);
  }
  group.userData.animationType = 'gentleSway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'tree';
  return group;
}

export function createShrub(options: any = {}) {
  const { color = 0x32CD32 } = options;
  const group = new THREE.Group();
  const baseGeo = new THREE.SphereGeometry(1 + Math.random() * 0.5, 16, 16);
  const base = new THREE.Mesh(baseGeo, createClayMaterial(color));
  base.position.y = 0.5;
  base.castShadow = true;
  group.add(base);
  const flowerMat = createClayMaterial(0xFF69B4);
  registerReactiveMaterial(flowerMat);
  const flowerCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < flowerCount; i++) {
    const flowerGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const flower = new THREE.Mesh(flowerGeo, flowerMat as any);
    flower.position.set((Math.random() - 0.5) * 1.5, 1 + Math.random() * 0.5, (Math.random() - 0.5) * 1.5);
    group.add(flower);
  }
  group.userData.animationType = 'bounce';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'shrub';
  return group;
}

export function createBubbleWillow(options: any = {}) {
  const { color = 0x8A2BE2 } = options;
  const group = new THREE.Group();
  const trunkH = 2.5 + Math.random();
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, trunkH, 12);
  const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x5D4037));
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);
  const branchCount = 6 + Math.floor(Math.random() * 4);
  const branchMat = createClayMaterial(color);
  registerReactiveMaterial(branchMat);
  for (let i = 0; i < branchCount; i++) {
    const branchGroup = new THREE.Group();
    branchGroup.position.y = trunkH * 0.9;
    branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;
    const length = 1.5 + Math.random();
    const capsuleGeo = new THREE.CapsuleGeometry(0.2, length, 8, 16);
    const capsule = new THREE.Mesh(capsuleGeo, branchMat as any);
    capsule.position.set(0.5, -length/2, 0);
    capsule.rotation.z = -Math.PI / 6;
    branchGroup.add(capsule);
    group.add(branchGroup);
  }
  group.userData.animationType = 'gentleSway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'tree';
  return group;
}

export function createPrismRoseBush(options: any = {}) {
  const group = new THREE.Group();
  const stemsMat = createClayMaterial(0x5D4037);
  const baseHeight = 1.0 + Math.random() * 0.5;
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, baseHeight, 8);
  trunkGeo.translate(0, baseHeight / 2, 0);
  const trunk = new THREE.Mesh(trunkGeo, stemsMat as any);
  trunk.castShadow = true;
  group.add(trunk);
  const branchCount = 3 + Math.floor(Math.random() * 3);
  const roseColors = [0xFF0055, 0xFFAA00, 0x00CCFF, 0xFF00FF, 0x00FF88];
  for (let i = 0; i < branchCount; i++) {
    const branchGroup = new THREE.Group();
    branchGroup.position.y = baseHeight * 0.8;
    branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;
    branchGroup.rotation.z = Math.PI / 4;
    const branchLen = 0.8 + Math.random() * 0.5;
    const branchGeo = new THREE.CylinderGeometry(0.08, 0.1, branchLen, 6);
    branchGeo.translate(0, branchLen / 2, 0);
    const branch = new THREE.Mesh(branchGeo, stemsMat as any);
    branchGroup.add(branch);
    const roseGroup = new THREE.Group();
    roseGroup.position.y = branchLen;
    const color = roseColors[Math.floor(Math.random() * roseColors.length)];
    const petalMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, emissive: 0x000000, emissiveIntensity: 0.0 });
    registerReactiveMaterial(petalMat);
    const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
    const outer = new THREE.Mesh(outerGeo as any, petalMat as any);
    outer.scale.set(1, 0.6, 1);
    roseGroup.add(outer);
    const innerGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const inner = new THREE.Mesh(innerGeo as any, petalMat as any);
    inner.position.y = 0.05;
    roseGroup.add(inner);
    const washGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const washMat = foliageMaterials.lightBeam.clone();
    washMat.color.setHex(color);
    const wash = new THREE.Mesh(washGeo as any, washMat as any);
    wash.userData.isWash = true;
    roseGroup.add(wash);
    branchGroup.add(roseGroup);
    group.add(branchGroup);
  }
  group.userData.animationType = 'sway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'flower';
  return group;
}

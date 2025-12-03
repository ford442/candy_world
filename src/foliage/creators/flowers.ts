import * as THREE from 'three';
import { foliageMaterials, registerReactiveMaterial, createClayMaterial } from '../materials';
import type { CreateFoliageOptions, FoliageUserData } from '../types';

export function createFlower(options: CreateFoliageOptions = {}) {
  const { color = null, shape = 'simple' } = options as CreateFoliageOptions;
  const group = new THREE.Group();
  const stemHeight = 0.6 + Math.random() * 0.4;
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
  stemGeo.translate(0, stemHeight / 2, 0);
  const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
  stem.castShadow = true;
  group.add(stem);
  const head = new THREE.Group();
  head.position.y = stemHeight;
  group.add(head);
  const centerGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
  head.add(center);
  let petalMat: THREE.Material;
  if (color) {
    petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);
  } else {
    petalMat = foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];
  }
  if (shape === 'simple') {
    const petalCount = 5 + Math.floor(Math.random() * 2);
    const petalGeo = new THREE.IcosahedronGeometry(0.15, 0);
    petalGeo.scale(1, 0.5, 1);
    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeo, petalMat as THREE.Material);
      petal.position.set(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
      petal.rotation.z = Math.PI / 4;
      head.add(petal);
    }
  } else if (shape === 'multi') {
    const petalCount = 8 + Math.floor(Math.random() * 4);
    const petalGeo = new THREE.SphereGeometry(0.12, 8, 8);
    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeo, petalMat as any);
      petal.position.set(Math.cos(angle) * 0.2, Math.sin(i * 0.5) * 0.1, Math.sin(angle) * 0.2);
      head.add(petal);
    }
  }
  group.userData.animationOffset = Math.random() * 10;
  group.userData.animationType = 'sway';
  group.userData.type = 'flower';
  return group;
}

export function createGlowingFlower(options: CreateFoliageOptions = {}) {
  const { color = 0xFFD700, intensity = 1.5 } = options;
  const group = new THREE.Group();
  const stemHeight = 0.6 + Math.random() * 0.4;
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
  stemGeo.translate(0, stemHeight / 2, 0);
  const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
  stem.castShadow = true;
  group.add(stem);
  const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.8 });
  registerReactiveMaterial(headMat);
  const head = new THREE.Mesh(headGeo, headMat as THREE.Material);
  head.position.y = stemHeight;
  group.add(head);
  const washGeo = new THREE.SphereGeometry(1.5, 16, 16);
  const wash = new THREE.Mesh(washGeo, foliageMaterials.lightBeam);
  wash.position.y = stemHeight;
  wash.userData.isWash = true;
  group.add(wash);
  group.userData.animationType = 'glowPulse';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'flower';
  return group;
}

export function createStarflower(options: CreateFoliageOptions = {}) {
  const { color = 0xFF6EC7 } = options;
  const group = new THREE.Group();
  const stemH = 0.7 + Math.random() * 0.4;
  const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, stemH, 6);
  stemGeo.translate(0, stemH / 2, 0);
  const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
  stem.castShadow = true;
  group.add(stem);
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), foliageMaterials.flowerCenter);
  center.position.y = stemH;
  group.add(center);
  const petalGeo = new THREE.ConeGeometry(0.09, 0.2, 6);
  const petalMat = createClayMaterial(color);
  registerReactiveMaterial(petalMat);
  const petalCount = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < petalCount; i++) {
    const petal = new THREE.Mesh(petalGeo, petalMat as THREE.Material);
    const angle = (i / petalCount) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 0.16, stemH, Math.sin(angle) * 0.16);
    petal.rotation.x = Math.PI * 0.5;
    petal.rotation.z = angle;
    group.add(petal);
  }
  const beamGeo = new THREE.ConeGeometry(0.02, 8, 8, 1, true);
  beamGeo.translate(0, 4, 0);
  const beamMat = foliageMaterials.lightBeam.clone();
  beamMat.color.setHex(color);
  const beam = new THREE.Mesh(beamGeo, beamMat as THREE.Material);
  beam.position.y = stemH;
  beam.userData.isBeam = true;
  group.add(beam);
  group.userData.animationType = 'spin';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'starflower';
  return group;
}

export function createBellBloom(options: CreateFoliageOptions = {}) {
  const { color = 0xFFD27F } = options;
  const group = new THREE.Group();
  const stemH = 0.4 + Math.random() * 0.2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stemH, 6), createClayMaterial(0x2E8B57));
  stem.castShadow = true;
  stem.position.y = 0;
  group.add(stem);
  const petalGeo = new THREE.ConeGeometry(0.12, 0.28, 10);
  const petalMat = createClayMaterial(color);
  registerReactiveMaterial(petalMat);
  const petals = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < petals; i++) {
    const p = new THREE.Mesh(petalGeo, petalMat as THREE.Material);
    const angle = (i / petals) * Math.PI * 2;
    p.position.set(Math.cos(angle) * 0.08, -0.08, Math.sin(angle) * 0.08);
    p.rotation.x = Math.PI;
    p.castShadow = true;
    group.add(p);
  }
  group.userData.animationType = 'sway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'flower';
  return group;
}

export function createPuffballFlower(options: CreateFoliageOptions = {}) {
  const { color = 0xFF69B4 } = options;
  const group = new THREE.Group();
  const stemH = 1.0 + Math.random() * 0.5;
  const stemGeo = new THREE.CylinderGeometry(0.1, 0.12, stemH, 8);
  const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x6B8E23));
  stem.position.y = stemH / 2;
  stem.castShadow = true;
  group.add(stem);
  const headR = 0.4 + Math.random() * 0.2;
  const headGeo = new THREE.SphereGeometry(headR, 16, 16);
  const headMat = createClayMaterial(color);
  registerReactiveMaterial(headMat);
  const head = new THREE.Mesh(headGeo, headMat as THREE.Material);
  head.position.y = stemH;
  head.castShadow = true;
  group.add(head);
  const sporeCount = 4 + Math.floor(Math.random() * 4);
  const sporeGeo = new THREE.SphereGeometry(headR * 0.3, 8, 8);
  const sporeMat = createClayMaterial(color + 0x111111);
  registerReactiveMaterial(sporeMat);
  for (let i = 0; i < sporeCount; i++) {
    const spore = new THREE.Mesh(sporeGeo, sporeMat as THREE.Material);
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    spore.position.set(x * headR, stemH + y * headR, z * headR);
    group.add(spore);
  }
  group.userData.animationType = 'sway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'flower';
  return group;
}

export function createWisteriaCluster(options: CreateFoliageOptions = {}) {
  const { color = 0xCFA0FF, strands = 4 } = options;
  const group = new THREE.Group();
  const bloomMat = createClayMaterial(color);
  registerReactiveMaterial(bloomMat);
  for (let s = 0; s < strands; s++) {
    const strand = new THREE.Group();
    const length = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < length; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), createClayMaterial(0x2E8B57) as THREE.Material);
      seg.position.y = -i * 0.35;
      seg.rotation.z = Math.sin(i * 0.5) * 0.15;
      strand.add(seg);
      if (i > 0 && Math.random() > 0.6) {
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), bloomMat as THREE.Material);
        b.position.y = seg.position.y - 0.1;
        b.position.x = (Math.random() - 0.5) * 0.06;
        b.position.z = (Math.random() - 0.5) * 0.06;
        strand.add(b);
      }
    }
    strand.position.x = (Math.random() - 0.5) * 0.6;
    strand.position.y = 0;
    group.add(strand);
  }
  group.userData.animationType = 'vineSway';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'vine';
  return group;
}

export function createHelixPlant(options: CreateFoliageOptions = {}) {
  const { color = 0x00FA9A } = options;
  const group = new THREE.Group();
  class SpiralCurve extends THREE.Curve<THREE.Vector3> {
    scale: number;
    constructor(scale = 1) {
      super();
      this.scale = scale;
    }
    getPoint(t: number, optionalTarget = new THREE.Vector3()) {
      const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale;
      const ty = t * 2.0 * this.scale;
      const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale;
      return optionalTarget.set(tx, ty, tz);
    }
  }
  const path = new SpiralCurve(1.0 + Math.random() * 0.5);
  const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
  const mat = createClayMaterial(color);
  registerReactiveMaterial(mat);
  const mesh = new THREE.Mesh(tubeGeo as THREE.BufferGeometry, mat as THREE.Material);
  mesh.castShadow = true;
  group.add(mesh);
  const tipGeo = new THREE.SphereGeometry(0.15, 8, 8);
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5 });
  registerReactiveMaterial(tipMat);
  const tip = new THREE.Mesh(tipGeo as THREE.BufferGeometry, tipMat as THREE.Material);
  const endPoint = (path as any).getPoint(1);
  tip.position.copy(endPoint as any);
  group.add(tip);
  group.userData.animationType = 'spring';
  group.userData.animationOffset = Math.random() * 10;
  group.userData.type = 'shrub';
  return group;
}

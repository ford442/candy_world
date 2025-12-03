import * as THREE from 'three';
import { createClayMaterial } from '../materials';

export function createGrass(options: any = {}) {
  const { color = 0x7CFC00, shape = 'tall' } = options;
  const material = createClayMaterial(color);
  let geo: THREE.BufferGeometry | undefined;
  if (shape === 'tall') {
    const height = 0.5 + Math.random();
    geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);
    const pos = (geo as any).attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > height * 0.5) {
        const bendFactor = (y - height * 0.5) / (height * 0.5);
        pos.setX(i, pos.getX(i) + bendFactor * 0.1);
      }
    }
  } else if (shape === 'bushy') {
    const height = 0.2 + Math.random() * 0.3;
    geo = new THREE.CylinderGeometry(0.1, 0.05, height, 8);
    geo.translate(0, height / 2, 0);
  }
  if (geo) (geo as any).computeVertexNormals();
  const blade = new THREE.Mesh(geo as THREE.BufferGeometry, material);
  blade.castShadow = true;
  blade.userData.type = 'grass';
  blade.userData.animationType = shape === 'tall' ? 'sway' : 'bounce';
  blade.userData.animationOffset = Math.random() * 10;
  return blade;
}

// Keep a helper leaf particle here for now
export function createLeafParticle(options: any = {}) {
  const { color = 0x00ff00 } = options;
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.1, 0.1, 0, 0.2);
  leafShape.quadraticCurveTo(-0.1, 0.1, 0, 0);
  const geo = new THREE.ShapeGeometry(leafShape);
  const mat = createClayMaterial(color);
  const leaf = new THREE.Mesh(geo, mat as any);
  leaf.castShadow = true;
  return leaf;
}

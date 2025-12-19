#!/usr/bin/env node
import * as THREE from 'three';
import { animateFoliage } from '../src/foliage/animation.js';

function colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

async function run() {
  // Setup material and object
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2244aa) });
  mat.emissive = new THREE.Color(0x000000);
  mat.emissiveIntensity = 0;
  mat.userData = mat.userData || {};
  mat.userData.baseColor = mat.color.clone();
  mat.userData.baseEmissive = mat.emissive.clone();

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.userData = mesh.userData || {};

  // Put mesh into a foliageObject group
  const foliage = new THREE.Group();
  foliage.userData = foliage.userData || {};
  foliage.userData.reactiveMeshes = [mesh];
  foliage.userData.type = 'flower';

  // Trigger a flash: strong red
  mesh.userData.flashIntensity = 1.0;
  mesh.userData.flashColor = new THREE.Color(0xff0000);
  mesh.userData.flashDecay = 0.2;

  // Step the animation several frames to allow flash and decay + fade-back
  for (let i = 0; i < 30; i++) {
    animateFoliage(foliage, i * 0.016 * 2, null, false, false);
  }

  const emissiveDist = colorDistance(mat.emissive, mat.userData.baseEmissive);
  const colorDist = colorDistance(mat.color, mat.userData.baseColor);

  console.log('Post-run distances — emissiveDist=', emissiveDist.toFixed(4), 'colorDist=', colorDist.toFixed(4), 'emissiveIntensity=', (mat.emissiveIntensity||0).toFixed(4));

  const success = emissiveDist < 0.05 && (mat.emissiveIntensity || 0) < 0.05;
  if (success) {
    console.log('OK: Flash faded back toward base');
    process.exit(0);
  } else {
    console.error('FAIL: Flash did not sufficiently fade back to base');
    process.exit(2);
  }
}

run().catch(err => {
  console.error('ERROR running fadeback check:', err);
  process.exit(3);
});

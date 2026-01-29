import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
  createClayMaterial,
  createCandyMaterial,
  registerReactiveMaterial,
  uGlitchIntensity
} from './common.ts';
import { vec3, positionLocal, sin, attribute, uv } from 'three/tsl';
import { uTime } from './common.ts';
import { applyGlitch } from './glitch.js';

const MAX_PINES = 200; // conservative default for performance

export class PortamentoPineBatcher {
  initialized = false;
  count = 0;
  logicPines: Array<THREE.Object3D> = [];

  // Instanced meshes
  trunkMesh: THREE.InstancedMesh | null = null;
  needleMesh: THREE.InstancedMesh | null = null;
  bendAttribute: THREE.InstancedBufferAttribute | null = null;

  // scratch
  dummy = new THREE.Object3D();
  _color = new THREE.Color();

  init() {
    if (this.initialized) return;

    // Geometry: merged trunk + needles (pr-281 approach)
    const height = 4.0;
    const segments = 6;
    const segHeight = height / segments;

    const trunkGeometries: THREE.BufferGeometry[] = [];
    const needleGeometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < segments; i++) {
      const yBase = i * segHeight;
      const rBot = 0.4 * (1 - i / segments) + 0.1;
      const rTop = 0.4 * (1 - (i + 1) / segments) + 0.1;

      const tGeo = new THREE.CylinderGeometry(rTop, rBot, segHeight, 8);
      tGeo.translate(0, yBase + segHeight / 2, 0);
      trunkGeometries.push(tGeo);

      if (i > 1) {
        const needleCount = 8;
        for (let n = 0; n < needleCount; n++) {
          const nGeo = new THREE.ConeGeometry(0.1, 0.6, 4);
          nGeo.rotateZ(1.5);
          nGeo.rotateY((n / needleCount) * Math.PI * 2);
          const px = Math.cos((n / needleCount) * Math.PI * 2) * rBot;
          const pz = Math.sin((n / needleCount) * Math.PI * 2) * rBot;
          nGeo.translate(px, segHeight * 0.5, pz);
          nGeo.translate(0, yBase, 0);
          needleGeometries.push(nGeo);
        }
      }
    }

    const trunkGeo = mergeGeometries(trunkGeometries) as THREE.BufferGeometry;
    const needleGeo = mergeGeometries(needleGeometries) as THREE.BufferGeometry;
    if (!trunkGeo || !needleGeo) {
      console.error('[PortamentoPineBatcher] Geometry merge failed');
      return;
    }

    const trunkMat = createClayMaterial(0x8b4513);
    const needleMat = createCandyMaterial(0x2e8b57, 0.5);
    registerReactiveMaterial(needleMat);

    this.bendAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1);
    trunkGeo.setAttribute('instanceBend', this.bendAttribute);
    needleGeo.setAttribute('instanceBend', this.bendAttribute);

    // TSL bending logic (audio-reactive hook left via instanceBend)
    const applyBend = (material) => {
      const instanceBend = attribute('instanceBend', 'float');
      const pos = positionLocal;
      const bendFactor = pos.y.mul(0.2);
      const bendCurve = bendFactor.mul(bendFactor);
      const wobble = sin(uTime.mul(3.0).add(pos.y)).mul(0.1).mul(instanceBend);
      const bendOffset = bendCurve.mul(instanceBend).add(wobble);
      const newPos = pos.add(vec3(bendOffset, 0, 0));
      const glitched = applyGlitch(uv(), newPos, uGlitchIntensity || 0.0);
      material.positionNode = glitched.position;
    };

    applyBend(trunkMat);
    applyBend(needleMat);

    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_PINES);
    this.needleMesh = new THREE.InstancedMesh(needleGeo, needleMat, MAX_PINES);
    this.trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.needleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trunkMesh.castShadow = this.needleMesh.castShadow = true;
    this.trunkMesh.receiveShadow = this.needleMesh.receiveShadow = true;

    foliageGroup.add(this.trunkMesh);
    foliageGroup.add(this.needleMesh);

    this.initialized = true;
    console.log('[PortamentoPineBatcher] Initialized');
  }

  register(dummy: THREE.Object3D, options = {}) {
    if (!this.initialized) this.init();
    if (this.count >= MAX_PINES) {
      console.warn('[PortamentoBatcher] Max limit reached');
      return;
    }

    const i = this.count++;
    dummy.userData.batchIndex = i;
    dummy.userData.bendFactor = 0;
    this.logicPines[i] = dummy;

    // Apply initial transform
    this.dummy.position.copy(dummy.position);
    this.dummy.quaternion.copy(dummy.quaternion);
    this.dummy.scale.copy(dummy.scale);
    this.dummy.updateMatrix();

    this.trunkMesh!.setMatrixAt(i, this.dummy.matrix);
    this.needleMesh!.setMatrixAt(i, this.dummy.matrix);
    this.bendAttribute!.setX(i, 0);

    this.trunkMesh!.instanceMatrix.needsUpdate = true;
    this.needleMesh!.instanceMatrix.needsUpdate = true;

    this.trunkMesh!.count = this.count;
    this.needleMesh!.count = this.count;

    return i;
  }

  updateInstance(idx: number, dummy: THREE.Object3D) {
    if (!this.initialized) return;
    this.dummy.position.copy(dummy.position);
    this.dummy.quaternion.copy(dummy.quaternion);
    this.dummy.scale.copy(dummy.scale);
    this.dummy.updateMatrix();
    this.trunkMesh!.setMatrixAt(idx, this.dummy.matrix);
    this.needleMesh!.setMatrixAt(idx, this.dummy.matrix);
    this.trunkMesh!.instanceMatrix.needsUpdate = true;
    this.needleMesh!.instanceMatrix.needsUpdate = true;
  }

  setBendForIndex(idx: number, value: number) {
    if (!this.bendAttribute) return;
    this.bendAttribute.array[idx] = value;
    this.bendAttribute.needsUpdate = true;
  }

  update() {
    if (!this.initialized || this.count === 0) return;
    const time = performance.now() * 0.001;
    let needsUpdate = false;

    for (let i = 0; i < this.count; i++) {
      const dummy = this.logicPines[i];
      if (!dummy) continue;
      let targetBend = Math.sin(time + i) * 0.2;
      if (dummy.userData?.isHovered) targetBend += 0.5;
      const last = (dummy.userData && dummy.userData._lastBend) || 0;
      if (Math.abs(targetBend - last) > 0.01) {
        dummy.userData._lastBend = targetBend;
        this.bendAttribute!.setX(i, targetBend);
        needsUpdate = true;
      }
    }

    if (needsUpdate) this.bendAttribute!.needsUpdate = true;
  }
}

export const portamentoPineBatcher = new PortamentoPineBatcher();

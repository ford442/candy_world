import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
  createUnifiedMaterial,
  registerReactiveMaterial,
  calculateWindSway,
  calculatePlayerPush
} from './common.ts';
import {
  vec3,
  positionLocal,
  attribute,
  uv,
  mix,
  color,
  float
} from 'three/tsl';

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

    // --- TSL ANIMATION LOGIC ---
    // Combined deformation: Note Bend + Wind Sway + Player Push
    const animatedPosition = (basePos) => {
        // 1. Instance Bend (Note Play)
        const instanceBend = attribute('instanceBend', 'float');
        // Quadratic bend: more at top
        const bendDisplace = vec3(instanceBend.mul(basePos.y.pow(2.0)), float(0.0), float(0.0));

        // 2. Wind Sway (Ambient)
        const windDisplace = calculateWindSway(basePos);

        // 3. Player Push (Interaction)
        const pushDisplace = calculatePlayerPush(basePos);

        return basePos.add(bendDisplace).add(windDisplace).add(pushDisplace);
    };

    const animPos = animatedPosition(positionLocal);

    // --- MATERIALS ---

    // 1. Trunk: Magic Copper with Patina
    const trunkMat = createUnifiedMaterial(0xB87333, {
        metalness: 0.8,
        roughness: 0.4,
        bumpStrength: 0.2, // Oxidation texture
        noiseScale: 4.0,
        triplanar: true,
        iridescenceStrength: 0.3, // Oil slick look
        colorNode: mix(color(0xB87333), color(0x2E8B57), positionLocal.y.mul(0.25).min(1.0)), // Green at bottom
        deformationNode: animPos
    });

    // 2. Needles: Glowing Emerald Glass
    const needleMat = createUnifiedMaterial(0x2E8B57, {
        transmission: 0.4,
        roughness: 0.2,
        sheen: 1.0,
        sheenColor: 0x00FF00,
        audioReactStrength: 1.0, // Pulse with music
        deformationNode: animPos
    });

    registerReactiveMaterial(needleMat);

    this.bendAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1);
    trunkGeo.setAttribute('instanceBend', this.bendAttribute);
    needleGeo.setAttribute('instanceBend', this.bendAttribute);

    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_PINES);
    this.needleMesh = new THREE.InstancedMesh(needleGeo, needleMat, MAX_PINES);
    this.trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.needleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trunkMesh.castShadow = this.needleMesh.castShadow = true;
    this.trunkMesh.receiveShadow = this.needleMesh.receiveShadow = true;

    foliageGroup.add(this.trunkMesh);
    foliageGroup.add(this.needleMesh);

    this.initialized = true;
    console.log('[PortamentoPineBatcher] Initialized (Magic Copper Edition)');
  }

  register(dummy: THREE.Object3D, options = {}) {
    if (!this.initialized) this.init();
    if (this.count >= MAX_PINES) {
      console.warn('[PortamentoBatcher] Max limit reached');
      return;
    }

    // Safety: Ensure physics state exists if not initialized by logic object factory
    if (!dummy.userData.reactivityState) {
        dummy.userData.reactivityState = { currentBend: 0, velocity: 0 };
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
    // Legacy support for musical_flora.js:
    // This function is called with 'velocity' by the logic object logic.
    // However, the logic object updates its own shared state (dummy.userData.reactivityState).
    // The physics loop in update() below reads that state directly.
    // So we don't need to manually update the attribute here; the loop handles it
    // including the spring physics integration.
  }

  update(time: number, audioState: any) {
    if (!this.initialized || this.count === 0) return;

    let needsUpdate = false;
    const dt = 0.016; // Fixed physics step

    for (let i = 0; i < this.count; i++) {
        const pine = this.logicPines[i];
        if (!pine || !pine.userData.reactivityState) continue;

        const state = pine.userData.reactivityState; // { currentBend, velocity }

        // Spring Physics (Hooke's Law + Damping)
        const k = 10.0;     // Stiffness
        const damp = 0.92;  // Friction

        const force = -k * state.currentBend;
        state.velocity += force * dt;
        state.velocity *= damp;
        state.currentBend += state.velocity * dt;

        // If significant change, update attribute
        const last = pine.userData._lastUploadedBend || 0;
        if (Math.abs(state.currentBend - last) > 0.001) {
             this.bendAttribute!.setX(i, state.currentBend);
             pine.userData._lastUploadedBend = state.currentBend;
             needsUpdate = true;
        }
    }

    if (needsUpdate) {
        this.bendAttribute!.needsUpdate = true;
    }
  }
}

export const portamentoPineBatcher = new PortamentoPineBatcher();

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
  createUnifiedMaterial,
  registerReactiveMaterial,
  calculateWindSway,
  calculatePlayerPush,
  createJuicyRimLight,
  uAudioHigh,
  uAudioLow
} from './index.ts';
import { uTwilight } from './sky.ts';
import {
  vec3,
  positionLocal,
  attribute,
  uv,
  mix,
  color,
  float
} from 'three/tsl';
import { PlantPoseMachine } from './plant-pose-machine.ts';
import { CONFIG } from '../core/config.ts';

const MAX_PINES = 200; // conservative default for performance
/** Default melody channel index used when config does not specify channelIndex. */
const DEFAULT_MELODY_CHANNEL_INDEX = 2;
const _scratchMatrix = new THREE.Matrix4();

export class PortamentoPineBatcher {
  initialized = false;
  count = 0;
  logicPines: Array<THREE.Object3D> = [];

  // Instanced meshes
  trunkMesh: THREE.InstancedMesh | null = null;
  needleMesh: THREE.InstancedMesh | null = null;
  bendAttribute: THREE.InstancedBufferAttribute | null = null;

  // scratch
  _color = new THREE.Color();

  /**
   * Per-instance ADSR pose machine — drives the spring rest position for each pine.
   * Allocated once with MAX_PINES capacity; no per-frame allocations.
   */
  private _poseMachine: PlantPoseMachine = new PlantPoseMachine(MAX_PINES);

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

    // 🎨 Palette: TSL Audio-Reactive Juice & Neon Rim Light
    const baseGlowColor = color(0x00FF00);
    const audioGlow = uAudioHigh.mul(1.5).add(uAudioLow.mul(0.5));
    const rimLight = createJuicyRimLight(baseGlowColor, float(1.5), float(3.0), null);

    // Add audio-reactive emissive pulse scaled by night visibility (twilight)
    needleMat.emissiveNode = baseGlowColor.mul(audioGlow).add(rimLight).mul(float(1.0).add(uTwilight));

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

    // ⚡ OPTIMIZATION: Eliminate CPU overhead and GC spikes from Matrix4 composition by writing directly to instanceMatrix.array
    // Compose directly from the logic object's properties without using a proxy THREE.Object3D
    _scratchMatrix.compose(dummy.position, dummy.quaternion, dummy.scale);
    _scratchMatrix.toArray(this.trunkMesh!.instanceMatrix.array, i * 16);
    _scratchMatrix.toArray(this.needleMesh!.instanceMatrix.array, i * 16);

    this.bendAttribute!.setX(i, 0);

    this.trunkMesh!.instanceMatrix.needsUpdate = true;
    this.needleMesh!.instanceMatrix.needsUpdate = true;

    this.trunkMesh!.count = this.count;
    this.needleMesh!.count = this.count;

    return i;
  }

  updateInstance(idx: number, dummy: THREE.Object3D) {
    if (!this.initialized) return;

    // ⚡ OPTIMIZATION: Eliminate CPU overhead and GC spikes from Matrix4 composition by writing directly to instanceMatrix.array
    // Compose directly from the logic object's properties without using a proxy THREE.Object3D
    _scratchMatrix.compose(dummy.position, dummy.quaternion, dummy.scale);
    _scratchMatrix.toArray(this.trunkMesh!.instanceMatrix.array, idx * 16);
    _scratchMatrix.toArray(this.needleMesh!.instanceMatrix.array, idx * 16);

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

  update(time: number, audioState: any, dayNightBias: number = 1.0) {
    if (!this.initialized || this.count === 0) return;

    let needsUpdate = false;
    const dt = 0.016; // Fixed physics step

    // --- Pose machine: advance per-instance ADSR envelopes ---
    // Use melody channel (index from config) volume as shared channel intensity.
    const poseConfig = CONFIG.plantPose.portamentoPine;
    const channelIdx = poseConfig.channelIndex ?? DEFAULT_MELODY_CHANNEL_INDEX;
    let channelIntensity = 0.0;
    if (audioState && audioState.channelData && audioState.channelData[channelIdx]) {
        channelIntensity = audioState.channelData[channelIdx].volume || 0;
    }
    this._poseMachine.update(this.count, dt, channelIntensity, dayNightBias, poseConfig);

    for (let i = 0; i < this.count; i++) {
        const pine = this.logicPines[i];
        if (!pine || !pine.userData.reactivityState) continue;

        const state = pine.userData.reactivityState; // { currentBend, velocity }

        // --- Spring rest position driven by ADSR pose ---
        // At day with no music: pose ≈ 0   (straight)
        // At night:             pose ≈ -0.05 (gentle droop)
        // Music active:         pose ramps toward dayTarget * sustainLevel (visible forward lean)
        const poseTarget = this._poseMachine.getPose(i);

        // Spring Physics (Hooke's Law + Damping) toward ADSR target
        const k = 10.0;     // Stiffness
        const damp = 0.92;  // Friction

        const force = -k * (state.currentBend - poseTarget);
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

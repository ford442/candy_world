import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  vec3,
  positionLocal,
  attribute,
  uv,
  mix,
  color,
  float,
  sin,
  instanceIndex
} from 'three/tsl';
import { runGpuPlantPose, shouldUseGpuPlantPose } from '../compute/gpu-plant-pose.ts';
import { camera } from '../core/camera-ref.ts';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../core/scheduler/types.ts';
import { CONFIG } from '../core/config.ts';
import { BiomeUniforms, circadianDayGlowMult, circadianNightGlowMult } from '../systems/biome-uniforms.ts';
import { getActiveWave } from '../systems/music-reactivity/music-wave.ts';
import { getGroundAlignedQuaternion } from '../world/placement-utils.ts';
import { foliageGroup } from '../world/state.ts';
import { applyInstanceAnimation, ANIMATION_TYPES } from './animation-nodes.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import {
    createUnifiedMaterial,
    applyStandardDeformation,
    createJuicyRimLight,
    uAudioHigh,
    uAudioLow,
    uTime,
    asVec3,
    type Vec3Node,
} from './material-core.ts';
import { PlantPoseMachine } from './plant-pose-machine.ts';
import { uTwilight } from './sky.ts';

const MAX_PINES = 200; // conservative default for performance
/** Default melody channel index used when config does not specify channelIndex. */
const DEFAULT_MELODY_CHANNEL_INDEX = 2;
const _scratchMatrix = new THREE.Matrix4();
const _scratchQuaternion = new THREE.Quaternion();

export class PortamentoPineBatcher extends InstancedBatcher<THREE.Object3D> {
  initialized = false;
  declare public count: number;
  dropped = 0;
  logicPines: Array<THREE.Object3D> = [];

  // Instanced meshes
  trunkMesh: THREE.InstancedMesh | null = null;
  needleMesh: THREE.InstancedMesh | null = null;
  bendAttribute: THREE.InstancedBufferAttribute | null = null;

  // scratch
  _color = new THREE.Color();

  /** One ADSR envelope per pine, moved with its dense slot. */
  private _poseMachines: PlantPoseMachine[] = [];
  private _cpuPoses = new Float32Array(MAX_PINES);
  private _lastGpuPoses: Float32Array | null = null;
  private _gpuPoseInFlight = false;
  private _poseGeneration = 0;
  private _swapping = false;

  constructor() {
    super('portamento-pines', 'animate', MAX_PINES);
  }

  init() {
    if (this.initialized) return;
    this.ensureMesh();
  }

  protected createMesh(capacity: number): THREE.InstancedMesh {

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
      throw new Error('[PortamentoPineBatcher] Geometry merge failed');
    }

    // --- TSL ANIMATION LOGIC ---
    // Combined deformation: Note Bend + Wind Sway + Player Push
    const animatedPosition = (basePos: Vec3Node) => {
        // 1. Instance Bend (Note Play)
        const instanceBend = attribute('instanceBend', 'float');
        // Quadratic bend: more at top
        const bendDisplace = vec3(instanceBend.mul(basePos.y.pow(2.0)), float(0.0), float(0.0));

        return applyStandardDeformation(basePos.add(bendDisplace));
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
        seasonRole: 'leaf',
        transmission: 0.4,
        roughness: 0.2,
        sheen: 1.0,
        sheenColor: 0x00FF00,
        audioReactStrength: 1.0, // Pulse with music
        deformationNode: animPos
    });

    // 🎨 Palette: TSL Audio-Reactive Juice & Neon Rim Light
    const baseGlowColor = asVec3(color(0x00FF00));
    const audioGlow = uAudioHigh.mul(1.5).add(uAudioLow.mul(0.5));
    const rimLight = createJuicyRimLight(baseGlowColor, float(1.5), float(3.0), null);

    // 🎨 PALETTE: Twilight Glow for portamento pines
    const glowPhaseOffset = float(instanceIndex).mul(0.1);
    const idlePulse = sin(uTime.mul(float(CONFIG.glow.glowPulseFrequency)).add(glowPhaseOffset)).mul(float(CONFIG.glow.glowPulseAmplitude)).add(1.0).mul(float(0.5)).mul(uAudioHigh.mul(0.3).add(0.7));
    const targetGlowColor = color(CONFIG.glow.glowColorMap['portamento']);

    // Music Impact / Twilight fix: uTwilight is now explicitly multiplied into the glow tint
    // (matching the exact pattern from simple-flower-batcher.ts:161).
    // Previously this was a stub (imported but not wired into the final emissive graph in some paths).
    const twilightGlowTint = targetGlowColor
        .mul(uTwilight)
        .mul(float(CONFIG.glow.glowIntensityMax))
        .mul(float(0.3).add(idlePulse));

    needleMat.emissiveNode = baseGlowColor
        .mul(BiomeUniforms.arpeggioGrove.noteColor)
        .mul(audioGlow)
        .mul(circadianDayGlowMult(0.3))
        .add(rimLight.mul(circadianDayGlowMult(0.3)))
        .add(twilightGlowTint.mul(circadianNightGlowMult()));
    registerReactiveMaterial(needleMat);

    this.bendAttribute = this.registerAttribute(new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    trunkGeo.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1));
    trunkGeo.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1));
    needleGeo.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1));
    needleGeo.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1));
    trunkGeo.setAttribute('instanceBend', this.bendAttribute);
    needleGeo.setAttribute('instanceBend', this.bendAttribute);

    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, capacity);
    this.needleMesh = this.linkMesh(new THREE.InstancedMesh(needleGeo, needleMat, capacity));
    this.trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.needleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trunkMesh.castShadow = this.needleMesh.castShadow = true;
    this.trunkMesh.receiveShadow = this.needleMesh.receiveShadow = true;

    foliageGroup.add(this.trunkMesh);
    foliageGroup.add(this.needleMesh);

    this.initialized = true;
    console.log('[PortamentoPineBatcher] Initialized (Magic Copper Edition)');
    return this.trunkMesh;
  }

  protected writeRecord(dummy: THREE.Object3D, slot: number, array: Float32Array): void {
    if (!this._swapping) {
      getGroundAlignedQuaternion(dummy, _scratchQuaternion);
      _scratchMatrix.compose(dummy.position, _scratchQuaternion, dummy.scale).toArray(array, slot * 16);
      _scratchMatrix.toArray(this.needleMesh!.instanceMatrix.array as Float32Array, slot * 16);
    }
    this._swapping = false;
    dummy.userData.batchIndex = slot;
  }

  protected onSwap(from: number, to: number): void {
    this.logicPines[to] = this.logicPines[from];
    this._poseMachines[to] = this._poseMachines[from];
    this._swapping = true;
  }

  protected step(): void {}

  register(dummy: THREE.Object3D, options = {}): number | undefined {
    const existing = this.slotOfKey(dummy.id);
    if (existing !== undefined) return existing;
    if (this.count >= this.capacity) {
      if (this.dropped++ === 0) console.warn('[PortamentoBatcher] Max limit reached');
      return;
    }
    if (!dummy.userData.reactivityState) {
      dummy.userData.reactivityState = { currentBend: 0, velocity: 0 };
    }
    const handle = this.addKeyed(dummy.id, dummy);
    if (handle === null) return;
    const i = this.slotOf(handle)!;
    dummy.userData.bendFactor = 0;
    dummy.userData._lastUploadedBend = 0;
    this.logicPines[i] = dummy;
    this._poseMachines[i] = new PlantPoseMachine(1);
    this._poseGeneration++;
    this._lastGpuPoses = null;
    this.bendAttribute!.setX(i, 0);
    this.flush();
    return i;
  }

  removeInstance(dummy: THREE.Object3D): void {
    if (!dummy || this.slotOfKey(dummy.id) === undefined) return;
    this.removeKeyed(dummy.id);
    this.logicPines.length = this.count;
    this._poseMachines.length = this.count;
    dummy.userData.batchIndex = undefined;
    this._poseGeneration++;
    this._lastGpuPoses = null;
    this.flush();
  }

  updateInstance(idx: number, dummy: THREE.Object3D) {
    if (!this.mesh || this.logicPines[idx] !== dummy) return;
    this.writeRecord(dummy, idx, this.mesh.instanceMatrix.array as Float32Array);
    this.markSlotDirty(idx);
    this.trunkMesh!.boundingSphere = null;
    this.needleMesh!.boundingSphere = null;
    this.flush();
  }

  setBendForIndex(idx: number, value: number) {
    // Legacy support for musical_flora.js:
    // This function is called with 'velocity' by the logic object logic.
    // However, the logic object updates its own shared state (dummy.userData.reactivityState).
    // The physics loop in update() below reads that state directly.
    // So we don't need to manually update the attribute here; the loop handles it
    // including the spring physics integration.
  }

  update(ctx: FrameContext): void;
  update(time: number, audioState: any, dayNightBias?: number): void;
  update(time: number | FrameContext, audioState?: any, dayNightBias: number = 1.0): void {
    if (typeof time !== 'number') {
      super.update(time);
      return;
    }
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
    const activeWave = getActiveWave();
    const cameraPos = camera ? camera.position : undefined;

    let poseSlot = 0;
    const getPlantPos = (_index: number, out: THREE.Vector3) => {
        if (!this.trunkMesh) return;
        const array = this.trunkMesh.instanceMatrix.array as Float32Array;
        const offset = poseSlot * 16;
        out.set(array[offset + 12], array[offset + 13], array[offset + 14]);
    };

    const useGpuPose = shouldUseGpuPlantPose(this.count);

    if (useGpuPose && this._lastGpuPoses && this._lastGpuPoses.length >= this.count) {
        this._applyPoseState(this._lastGpuPoses, dt);
    } else {
        for (poseSlot = 0; poseSlot < this.count; poseSlot++) {
            const machine = this._poseMachines[poseSlot];
            machine.update(1, dt, channelIntensity, dayNightBias, poseConfig, activeWave, getPlantPos, cameraPos);
            this._cpuPoses[poseSlot] = machine.getPose(0);
        }
        this._applyPoseState(this._cpuPoses, dt);
    }

    if (useGpuPose && !this._gpuPoseInFlight) {
        let wave = null;
        if (activeWave) {
            wave = {
                originX: activeWave.origin?.x ?? cameraPos?.x ?? 0,
                originY: activeWave.origin?.y ?? cameraPos?.y ?? 0,
                originZ: activeWave.origin?.z ?? cameraPos?.z ?? 0,
                radiusSq: Math.max(0, (performance.now() - activeWave.timestamp) / 1000 * (activeWave.speed || 25.0)) ** 2,
            };
        }

        this._gpuPoseInFlight = true;
        const generation = this._poseGeneration;
        void runGpuPlantPose({
            count: this.count,
            delta: dt,
            channelIntensity,
            dayNightBias,
            config: poseConfig,
            wave,
        }).then((poses) => {
            if (poses && generation === this._poseGeneration) this._lastGpuPoses = poses;
        }).finally(() => {
            this._gpuPoseInFlight = false;
        });
    }

    for (let i = 0; i < this.count; i++) {
        const pine = this.logicPines[i];
        if (!pine || !pine.userData.reactivityState) continue;
        const state = pine.userData.reactivityState;
        const last = pine.userData._lastUploadedBend || 0;
        if (Math.abs(state.currentBend - last) > 0.001) {
             this.bendAttribute!.array[i] = state.currentBend;
             pine.userData._lastUploadedBend = state.currentBend;
             this.markSlotDirty(i);
             needsUpdate = true;
        }
    }

    if (needsUpdate) {
        this.flush();
    }
  }

  private _applyPoseState(poses: Float32Array, dt: number) {
    for (let i = 0; i < this.count; i++) {
        const pine = this.logicPines[i];
        if (!pine || !pine.userData.reactivityState) continue;

        const state = pine.userData.reactivityState; // { currentBend, velocity }

        // --- Spring rest position driven by ADSR pose ---
        // At day with no music: pose ≈ 0   (straight)
        // At night:             pose ≈ -0.05 (gentle droop)
        // Music active:         pose ramps toward dayTarget * sustainLevel (visible forward lean)
        const poseTarget = poses[i];

        // Spring Physics (Hooke's Law + Damping) toward ADSR target
        const k = 10.0;     // Stiffness
        const damp = 0.92;  // Friction

        const force = -k * (state.currentBend - poseTarget);
        state.velocity += force * dt;
        state.velocity *= damp;
        state.currentBend += state.velocity * dt;
    }
  }

  dispose(): void {
    for (const pine of this.logicPines) pine.userData.batchIndex = undefined;
    super.dispose();
    this.logicPines.length = 0;
    this._poseMachines.length = 0;
    this.trunkMesh = this.needleMesh = null;
    this.bendAttribute = null;
    this.initialized = false;
    this.dropped = 0;
    this._lastGpuPoses = null;
    this._poseGeneration++;
  }
}

export const portamentoPineBatcher = new PortamentoPineBatcher();

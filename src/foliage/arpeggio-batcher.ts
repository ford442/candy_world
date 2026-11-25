import * as THREE from 'three';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv, varying,
    smoothstep, attribute, positionWorld, If, vec4, varyingProperty
} from 'three/tsl';
import { camera } from '../core/camera-ref.ts';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../core/scheduler/types.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { CONFIG } from '../core/config.ts';
import { BiomeUniforms, getBiomeUniforms, type BiomeId } from '../systems/biome-uniforms.ts';
import { getActiveWave } from '../systems/music-reactivity/music-wave.ts';
import { dynamicRadiiView } from '../utils/wasm-physics.ts';
import { foliageGroup } from '../world/state.ts';

const ARPEGGIO_BIOME: BiomeId = 'arpeggio_grove';
const arpeggioUniforms = getBiomeUniforms(ARPEGGIO_BIOME); // Future-proof: adding new biomes only requires updating the helper + JSON
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGroundAlignedQuaternion } from '../world/placement-utils.ts';
import { applyAerialPerspective } from './aerial-perspective.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { applyGlitch } from './glitch.ts';
import { uTime, uGlitchIntensity } from './material-core.ts';
import {
    createCandyMaterial,
    sharedGeometries,
    applyStandardDeformation,
    createJuicyRimLight,
    createStandardNodeMaterial,
    uAudioHigh,
    uPlayerPosition,
    applyBaseContactAO,
    getBaseContactHeight,
    asNode,
    type FloatNode,
} from './material-core.ts';
import { applySeasonTint } from './material-core/season-nodes.ts';
import { PlantPoseMachine } from './plant-pose-machine.ts';
import { runGpuPlantPose, shouldUseGpuPlantPose } from '../compute/gpu-plant-pose.ts';

const MAX_FERNS = getCIAdjustedCount(500, 0.1, 50); // Reduced from 2000 for WebGPU uniform buffer limits
const FRONDS_PER_FERN = 5;
const _scratchMatrix = new THREE.Matrix4();
const _scratchQuaternion = new THREE.Quaternion();

export class ArpeggioFernBatcher extends InstancedBatcher<THREE.Object3D> {
    initialized: boolean;
    declare public count: number;
    logicFerns: any[];

    private static _debugLogged = false;

    // GPU Buffers

    // Scratch
    _color: THREE.Color;

    // GLOBAL TSL Uniform
    public globalUnfurl: number = 0;
    public uFernUnfurl: any;

    // Global Logic State
    private currentTargetStep: number = 0;
    private currentUnfurlValue: number = 0;
    private lastTrigger: boolean = false;

    // Matrix/color batching state (SoA → native or TS writeInstancePose)
    dropped = 0;

    /**
     * Day/night pose state machine — single slot (global unfurl for all ferns).
     * Uses a Float32Array of capacity 1; no per-frame allocations.
     */
    private _poseMachine!: PlantPoseMachine;
    private _lastGpuPoses: Float32Array | null = null;
    private _gpuPoseInFlight = false;
    private _poseGeneration = 0;
    private _swapping = false;

    constructor() {
        super('arpeggio-ferns', 'animate', MAX_FERNS);
        this.initialized = false;
        this.logicFerns = [];

        this._color = new THREE.Color();

        // Initialize global uniform
        this.uFernUnfurl = uniform(float(0.0));

    }

    init() {
        if (this.initialized) return;
        this.ensureMesh();
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {

        // Single-slot pose machine for global fern unfurl (capacity=1, no per-frame alloc)
        this._poseMachine = new PlantPoseMachine(1);

        // --- Geometry Preparation ---

        // 1. Frond Geometry (Base Scale 1.0)
        const frondHeight = 2.3;
        const frondGeo = new THREE.BoxGeometry(0.1, frondHeight, 0.02, 1, 16, 1);
        frondGeo.translate(0, frondHeight / 2, 0); // Pivot at bottom

        // 2. Base Geometry
        const baseGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
        baseGeo.translate(0, 0.25, 0);

        const geometriesToMerge: THREE.BufferGeometry[] = [];

        // --- BASE SETUP ---
        // Base is at (0,0,0) locally, no rotation
        // Attributes: aIsFrond=0, aFrondAngle=0, aFrondTilt=0
        const baseCount = baseGeo.attributes.position.count;
        const baseIsFrond = new Float32Array(baseCount).fill(0);
        const baseAngle = new Float32Array(baseCount).fill(0);
        const baseTilt = new Float32Array(baseCount).fill(0);

        baseGeo.setAttribute('aIsFrond', new THREE.BufferAttribute(baseIsFrond, 1));
        baseGeo.setAttribute('aFrondAngle', new THREE.BufferAttribute(baseAngle, 1));
        baseGeo.setAttribute('aFrondTilt', new THREE.BufferAttribute(baseTilt, 1));

        geometriesToMerge.push(baseGeo);

        // --- FROND SETUP (5 copies) ---
        const frondYOffset = 0.4; // From original code logic
        const tiltAngle = 0.2; // From original code logic

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const angle = (f / FRONDS_PER_FERN) * Math.PI * 2;
            const geo = frondGeo.clone();

            // Apply transformations that define the frond's rest position relative to the fern center
            // 1. Tilt (Rotate X)
            geo.rotateX(tiltAngle);
            // 2. Fan (Rotate Y)
            geo.rotateY(angle);
            // 3. Lift (Translate Y)
            geo.translate(0, frondYOffset, 0);

            // Attributes
            const count = geo.attributes.position.count;
            const isFrond = new Float32Array(count).fill(1.0);
            const frondAngle = new Float32Array(count).fill(angle);
            const frondTilt = new Float32Array(count).fill(tiltAngle);

            geo.setAttribute('aIsFrond', new THREE.BufferAttribute(isFrond, 1));
            geo.setAttribute('aFrondAngle', new THREE.BufferAttribute(frondAngle, 1));
            geo.setAttribute('aFrondTilt', new THREE.BufferAttribute(frondTilt, 1));

            geometriesToMerge.push(geo);
        }

        // Merge Everything
        const mergedGeo = mergeGeometries(geometriesToMerge);

        // --- MATERIAL SETUP ---

        // 1. Base Properties (Mixed based on aIsFrond)
        const isFrondAttr = attribute('aIsFrond', 'float');

        // Base: 0x2E8B57, Rough 0.8, Metal 0.0
        // Frond: 0x00FF88, Rough 0.6, Metal 0.1
        // Frond accent (hue-shifted purple-violet — blended in by uHueShift)
        const baseColor = color(0x2E8B57);
        const frondColor = color(0x00FF88);
        const frondAccentColor = color(0x8844FF); // Purple-violet accent for hue shift
        // Arpeggio Grove hue shift: mix frond colour towards accent based on uHueShift channel
        const dynamicFrondColor = mix(frondColor, frondAccentColor, arpeggioUniforms.hueShift);
        const mixedColor = mix(baseColor, dynamicFrondColor, isFrondAttr);

        const mixedRough = mix(float(0.8), float(0.6), isFrondAttr);
        const mixedMetal = mix(float(0.0), float(0.1), isFrondAttr);

        const material = createStandardNodeMaterial({
            color: 0xFFFFFF, // Overridden by node
            roughness: 1.0,
            metalness: 0.0
        });
        registerReactiveMaterial(material);

        // Lightweight debug indicator for biome tagging / music reactivity system
        if (!ArpeggioFernBatcher._debugLogged && CONFIG.debugNoteReactivity) {
            console.log('[Biome] ArpeggioFernBatcher using biome=', ARPEGGIO_BIOME, 'via getBiomeUniforms()');
            ArpeggioFernBatcher._debugLogged = true;
        }

        material.colorNode = mixedColor; // Will be multiplied by instanceColor in fragment logic?
        // Actually, createStandardNodeMaterial usually sets basic properties.
        // We override them here.
        material.roughnessNode = mixedRough;
        material.metalnessNode = mixedMetal;

        // --- VERTEX LOGIC (CURL) ---

        const frondAngle = attribute('aFrondAngle', 'float');
        const frondTilt = attribute('aFrondTilt', 'float'); // 0.2
        const pos = positionLocal; // Vertex Position in Fern Local Space

        // We need to un-rotate the vertex to apply the curl in canonical space (Z-aligned)
        // Inverse of: Translate(0, 0.4, 0) -> RotateY(angle) -> RotateX(tilt)
        // Wait, matrix multiplication order is Translate * RotateY * RotateX * v
        // So v_world = T * Ry * Rx * v_local
        // To unwind: v_local = Rx' * Ry' * T' * v_world
        // But we baked T * Ry * Rx into the geometry.
        // So 'pos' is v_world (relative to fern center).

        // Step 1: Untranslate Y
        const p1 = vec3(pos.x, pos.y.sub(float(frondYOffset)), pos.z);

        // Step 2: Unrotate Y (angle)
        // x' = x*cos(-a) - z*sin(-a)
        // z' = x*sin(-a) + z*cos(-a)
        const cY = cos(frondAngle.negate());
        const sY = sin(frondAngle.negate());
        const p2 = vec3(
            p1.x.mul(cY).sub(p1.z.mul(sY)),
            p1.y,
            p1.x.mul(sY).add(p1.z.mul(cY))
        );

        // Step 3: Unrotate X (tilt)
        // y' = y*cos(-t) - z*sin(-t)
        // z' = y*sin(-t) + z*cos(-t)
        const cX = cos(frondTilt.negate());
        const sX = sin(frondTilt.negate());
        const p3 = vec3(
            p2.x,
            p2.y.mul(cX).sub(p2.z.mul(sX)),
            p2.y.mul(sX).add(p2.z.mul(cX))
        );

        // p3 is now in "Canonical Frond Space" (Vertical along Y, facing Z?)
        // Frond geometry was: Box(..., height=2.3). Translated(0, 1.15, 0).
        // So p3.y is 0..2.3. p3.z is thickness. p3.x is width.

        // --- APPLY CURL LOGIC ---
        // Logic from original code, adapted for p3
        const baseUnfurl = this.uFernUnfurl;
        const spatialDelay = sin(positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3))).mul(0.1);
        const instanceUnfurl = baseUnfurl.add(spatialDelay).clamp(0.0, 1.0);

        const yNorm = p3.y.div(float(frondHeight));

        const maxCurl = float(-4.0);
        const minCurl = float(-0.2);
        const currentTotalCurl = mix(maxCurl, minCurl, instanceUnfurl);

        const theta = currentTotalCurl.mul(yNorm);
        const wavePhase = uTime.mul(5.0).add(yNorm.mul(4.0));
        const wave = sin(wavePhase).mul(0.1).mul(instanceUnfurl).mul(yNorm);

        const finalAngle = theta.add(wave);

        const cCurl = cos(finalAngle);
        const sCurl = sin(finalAngle);

        // Curl around X axis (modifying Y and Z)
        // y' = y*cos - z*sin
        // z' = y*sin + z*cos
        const curledY = p3.y.mul(cCurl).sub(p3.z.mul(sCurl));
        const curledZ = p3.y.mul(sCurl).add(p3.z.mul(cCurl));

        const pCurled = vec3(p3.x, asNode<FloatNode>(curledY), asNode<FloatNode>(curledZ));

        // --- RE-WIND ROTATION ---
        // Inverse of Step 3 (Rotate X)
        const cX2 = cos(frondTilt);
        const sX2 = sin(frondTilt);
        const p4 = vec3(
            pCurled.x,
            pCurled.y.mul(cX2).sub(pCurled.z.mul(sX2)),
            pCurled.y.mul(sX2).add(pCurled.z.mul(cX2))
        );

        // Inverse of Step 2 (Rotate Y)
        const cY2 = cos(frondAngle);
        const sY2 = sin(frondAngle);
        const p5 = vec3(
            p4.x.mul(cY2).sub(p4.z.mul(sY2)),
            p4.y,
            p4.x.mul(sY2).add(p4.z.mul(cY2))
        );

        // Inverse of Step 1 (Translate Y)
        const pFinalFrond = vec3(p5.x, p5.y.add(float(frondYOffset)), p5.z);

        // --- COMBINE WITH BASE ---
        // If it's a base vertex, use original position. If frond, use curled.
        const combinedPos = mix(pos, pFinalFrond, isFrondAttr);

        // --- JUICE (Audio, Interaction, Wind) ---
        // Audio Pulse (Scale width/thickness with High Freq)
        const audioScale = uAudioHigh.mul(0.3).add(1.0);
        // Apply audio scale only to fronds? Or both?
        // Original code applied to fronds only.
        const pulsedPos = mix(
            combinedPos,
            vec3(combinedPos.x.mul(audioScale), combinedPos.y, combinedPos.z.mul(audioScale)),
            isFrondAttr
        );

        // Interaction (Bending)
        const withWind = applyStandardDeformation(pulsedPos);

        // Bobbing (Unfurl bounce)
        const bob = instanceUnfurl.mul(0.2);
        const finalPos = withWind.add(vec3(0, bob, 0));

        const glitched = applyGlitch(uv(), finalPos, uGlitchIntensity);
        material.positionNode = glitched.position;

        // Fragment Shader: Instance Color Tint + Rim Light
        const baseInstanceColor = varyingProperty('vec3', 'vInstanceColor');
        // Mix instance color into base color, then apply distance-driven aerial perspective
        material.colorNode = applyBaseContactAO(
            applyAerialPerspective(
                applySeasonTint(mixedColor.mul(baseInstanceColor), 'leaf'),
                positionWorld,
            ),
            positionLocal.y,
            float(getBaseContactHeight('arpeggio_fern')),
        );

        // Juicy Rim Light
        const rim = createJuicyRimLight(baseInstanceColor, float(2.0), float(3.0), null);
        const audioEmissive = uAudioHigh.mul(0.5);
        // Arpeggio Grove shimmer: soft teal sparkle driven by melody channels
        const shimmerColor = color(0x88FFCC);
        const shimmerGlow = arpeggioUniforms.shimmer.mul(shimmerColor).mul(3.0);
        material.emissiveNode = rim.add(baseInstanceColor.mul(audioEmissive)).add(shimmerGlow);

        // --- INSTANCED MESH ---
        const mesh = new THREE.InstancedMesh(mergedGeo, material, capacity);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        foliageGroup.add(mesh);

        this.initialized = true;
        console.log(`[ArpeggioBatcher] Initialized unified mesh system (Cap: ${MAX_FERNS})`);
        return mesh;
    }

    protected writeRecord(dummy: THREE.Object3D, slot: number, array: Float32Array): void {
        if (!this._swapping) {
            getGroundAlignedQuaternion(dummy, _scratchQuaternion);
            _scratchMatrix.compose(dummy.position, _scratchQuaternion, dummy.scale).toArray(array, slot * 16);
        }
        this._swapping = false;
        dummy.userData.batchIndex = slot;
    }

    protected onSwap(from: number, to: number): void {
        this.logicFerns[to] = this.logicFerns[from];
        this._swapping = true;
    }

    protected step(): void {}

    dispose(): void {
        for (const fern of this.logicFerns) fern.userData.batchIndex = undefined;
        super.dispose();
        this.logicFerns.length = 0;
        this.initialized = false;
        this.dropped = 0;
        this._lastGpuPoses = null;
        this._poseGeneration++;
        this.currentTargetStep = this.currentUnfurlValue = this.globalUnfurl = 0;
        this.lastTrigger = false;
        this.uFernUnfurl.value = 0;
    }

    register(dummy: THREE.Object3D, options: { color?: number; scale?: number } = {}): void {
        if (this.hasKey(dummy.id)) return;
        if (this.count >= this.capacity) {
            if (this.dropped++ === 0) console.warn('[ArpeggioBatcher] Max limit reached');
            return;
        }
        dummy.scale.setScalar(options.scale ?? 1);
        const handle = this.addKeyed(dummy.id, dummy);
        if (handle === null) return;
        const i = this.slotOf(handle)!;
        dummy.userData.unfurlFactor = 0;
        this.logicFerns[i] = dummy;
        this._color.setHex(options.color ?? 0x00FF88);
        this.mesh!.instanceColor!.setXYZ(i, this._color.r, this._color.g, this._color.b);
        this.flush();
    }

    removeInstance(dummy: THREE.Object3D): void {
        if (!dummy || this.slotOfKey(dummy.id) === undefined) return;
        this.removeKeyed(dummy.id);
        this.logicFerns.length = this.count;
        dummy.userData.batchIndex = undefined;
        this.flush();
    }

    updateInstance(index: number, dummy: THREE.Object3D): void {
        if (!this.mesh || this.logicFerns[index] !== dummy) return;
        this.writeRecord(dummy, index, this.mesh.instanceMatrix.array as Float32Array);
        this.markSlotDirty(index);
    }

    update(ctx: FrameContext): void;
    update(audioState?: any, dayNightBias?: number): void;
    update(audioState: any = null, dayNightBias: number = 1.0): void {
        if (audioState && typeof audioState.dt === 'number' && typeof audioState.rawDt === 'number') {
            super.update(audioState as FrameContext);
            return;
        }
        if (!this.initialized || this.count === 0) return;

        this.flush();

        // --- Arpeggio detection (unchanged) ---
        let arpeggioActive = false;
        let noteTrigger = false;
        if (audioState && audioState.channelData) {
            for (const ch of audioState.channelData) {
                if (ch.activeEffect === 4 || (ch.activeEffect === 0 && ch.effectValue && ch.effectValue > 0)) {
                    arpeggioActive = true;
                }
                if (ch.trigger > 0.1) {
                    noteTrigger = true;
                }
            }
        }

        const maxSteps = 12;
        let nextTarget = this.currentTargetStep;

        if (arpeggioActive) {
            if (noteTrigger && !this.lastTrigger) {
                nextTarget += 1;
                if (nextTarget > maxSteps) nextTarget = maxSteps;
            }
        } else {
            nextTarget = 0;
        }

        this.currentTargetStep = nextTarget;
        this.lastTrigger = noteTrigger;

        const speed = (nextTarget > this.currentUnfurlValue) ? 0.3 : 0.05;
        this.currentUnfurlValue += (nextTarget - this.currentUnfurlValue) * speed;

        // --- Day/night ADSR envelope (pose machine) ---
        // Channel intensity: 1.0 when arpeggio is active, 0.0 otherwise.
        const channelIntensity = arpeggioActive ? 1.0 : 0.0;
        const poseConfig = CONFIG.plantPose.arpeggioFern;

        // Fixed dt (60 Hz assumption) keeps parity with portamento batcher convention.
        const activeWave = getActiveWave();
        const cameraPos = camera ? camera.position : undefined;

        const getPlantPos = (index: number, out: THREE.Vector3) => {
            if (!this.mesh) return;
            const array = this.mesh.instanceMatrix.array as Float32Array;
            const offset = index * 16;
            out.set(array[offset + 12], array[offset + 13], array[offset + 14]);
        };

        let dnBaseline = 0;
        const useGpuPose = shouldUseGpuPlantPose(1);

        if (useGpuPose && this._lastGpuPoses && this._lastGpuPoses.length >= 1) {
            dnBaseline = this._lastGpuPoses[0];
        } else {
            this._poseMachine.update(1, 0.016, channelIntensity, dayNightBias, poseConfig, activeWave, getPlantPos, cameraPos);
            dnBaseline = this._poseMachine.getPose(0);
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
                count: 1,
                delta: 0.016,
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

        // Day/night baseline from pose machine (0 = night-closed, up to nightTarget/dayTarget).
        // Blends a gentle partial-open bias from daylight into the step-driven unfurl.
        // Final unfurl: day/night baseline + step-driven contribution in the remaining range.
        const stepUnfurl = this.currentUnfurlValue / maxSteps;
        const unfurl = dnBaseline + stepUnfurl * (1.0 - dnBaseline);

        this.globalUnfurl = unfurl;
        this.uFernUnfurl.value = unfurl;

        // ⚡ OPTIMIZATION: Zero-Allocation WASM Physics Sync
        // Write the expanded radius directly into the WASM memory view
        if (dynamicRadiiView) {
            // Base radius is ~2.0 when closed, expands to ~8.0 when unfurled
            const activeRadius = 2.0 + (unfurl * 6.0);
            for (let i = 0; i < this.count; i++) {
                // scale.x applies uniformly, so multiply by scale
                dynamicRadiiView[i] = activeRadius * this.logicFerns[i].scale.x;
            }
        }
    }
}

export const arpeggioFernBatcher = new ArpeggioFernBatcher();

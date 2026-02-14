import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createCandyMaterial,
    registerReactiveMaterial,
    sharedGeometries,
    applyPlayerInteraction,
    calculateWindSway,
    createJuicyRimLight,
    createStandardNodeMaterial,
    uAudioHigh,
    uPlayerPosition
} from './common.ts';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv, varying,
    smoothstep, attribute, positionWorld
} from 'three/tsl';
import { uTime, uGlitchIntensity } from './common.ts';
import { applyGlitch } from './glitch.ts';

const MAX_FERNS = 2000; // Cap at 2000 ferns (10,000 fronds)
const FRONDS_PER_FERN = 5;

export class ArpeggioFernBatcher {
    initialized: boolean;
    count: number;
    logicFerns: any[];

    // GPU Buffers
    frondMesh: THREE.InstancedMesh | null;
    unfurlAttribute: THREE.InstancedBufferAttribute | null;
    baseMesh: THREE.InstancedMesh | null;

    // Scratch
    dummy: THREE.Object3D;
    _color: THREE.Color;

    // GLOBAL TSL Uniform
    public globalUnfurl: number = 0;
    public uFernUnfurl: any;

    // Global Logic State
    private currentTargetStep: number = 0;
    private currentUnfurlValue: number = 0;
    private lastTrigger: boolean = false;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicFerns = [];

        this.frondMesh = null;
        this.unfurlAttribute = null;
        this.baseMesh = null;

        this.dummy = new THREE.Object3D();
        this._color = new THREE.Color();

        // Initialize global uniform
        this.uFernUnfurl = uniform(float(0.0));
    }

    init() {
        if (this.initialized) return;

        // 1. Frond Geometry (Base Scale 1.0)
        const frondHeight = 2.3;
        const frondGeo = new THREE.BoxGeometry(0.1, frondHeight, 0.02, 1, 16, 1);
        frondGeo.translate(0, frondHeight / 2, 0); // Pivot at bottom

        // 2. Frond Material (TSL) - PALETTE UPGRADE
        const frondMat = createStandardNodeMaterial({
            color: 0x00FF88,
            roughness: 0.6,
            metalness: 0.1
        });
        registerReactiveMaterial(frondMat);

        // TSL Logic
        // Reads 'instanceUnfurl' from GLOBAL UNIFORM
        const baseUnfurl = this.uFernUnfurl;

        // PALETTE: Add Organic Delay based on World Position (Wave effect)
        const spatialDelay = sin(positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3))).mul(0.1);
        const instanceUnfurl = baseUnfurl.add(spatialDelay).clamp(0.0, 1.0);

        const pos = positionLocal;
        const yNorm = pos.y.div(float(frondHeight));

        const maxCurl = float(-4.0);
        const minCurl = float(-0.2);
        const currentTotalCurl = mix(maxCurl, minCurl, instanceUnfurl);

        const theta = currentTotalCurl.mul(yNorm);
        const wavePhase = uTime.mul(5.0).add(yNorm.mul(4.0));
        const wave = sin(wavePhase).mul(0.1).mul(instanceUnfurl).mul(yNorm);

        const finalAngle = theta.add(wave);

        const c = cos(finalAngle);
        const s = sin(finalAngle);

        const newY = pos.y.mul(c).sub(pos.z.mul(s));
        const newZ = pos.y.mul(s).add(pos.z.mul(c));

        // Base curled position
        const curledPos = vec3(pos.x, newY, newZ);

        // PALETTE: Audio Pulse (Scale width/thickness with High Freq)
        const audioScale = uAudioHigh.mul(0.3).add(1.0);
        const pulsedPos = vec3(curledPos.x.mul(audioScale), curledPos.y, curledPos.z.mul(audioScale));

        // PALETTE: Juice (Player Interaction + Wind)
        // Apply Interaction first
        const withInteraction = applyPlayerInteraction(pulsedPos);
        // Apply Wind Sway
        const withWind = withInteraction.add(calculateWindSway(pulsedPos));

        const bob = instanceUnfurl.mul(0.2);
        const finalPos = withWind.add(vec3(0, bob, 0));

        const glitched = applyGlitch(uv(), finalPos, uGlitchIntensity);
        frondMat.positionNode = glitched.position;

        // PALETTE: Fragment Shader Logic
        const baseColor = attribute('instanceColor', 'vec3');
        frondMat.colorNode = baseColor;

        // Juicy Rim Light + Audio Pulse
        const rim = createJuicyRimLight(baseColor, float(2.0), float(3.0), null);
        const audioEmissive = uAudioHigh.mul(0.5);
        frondMat.emissiveNode = rim.add(baseColor.mul(audioEmissive));

        // 3. Create InstancedMeshes (Single)
        const totalFronds = MAX_FERNS * FRONDS_PER_FERN;

        const chunkGeo = frondGeo.clone();
        // Removed instanceUnfurl attribute

        this.frondMesh = new THREE.InstancedMesh(chunkGeo, frondMat, totalFronds);
        // Explicitly init instanceColor for TSL usage
        this.frondMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(totalFronds * 3), 3);
        this.frondMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.frondMesh.castShadow = true;
        this.frondMesh.receiveShadow = true;
        this.frondMesh.frustumCulled = false;
        this.frondMesh.count = 0;

        foliageGroup.add(this.frondMesh);

        // 4. Base Geometry & Mesh
        const baseGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
        baseGeo.translate(0, 0.25, 0);

        // PALETTE: Upgrade Base Material
        const baseMat = createStandardNodeMaterial({
            color: 0x2E8B57,
            roughness: 0.8
        });

        // Base Fragment Logic
        const baseInstanceColor = attribute('instanceColor', 'vec3');
        baseMat.colorNode = baseInstanceColor;
        const baseRim = createJuicyRimLight(baseInstanceColor, float(1.0), float(3.0), null);
        baseMat.emissiveNode = baseRim;

        // Base Vertex Logic (Interaction)
        baseMat.positionNode = applyPlayerInteraction(positionLocal);

        this.baseMesh = new THREE.InstancedMesh(baseGeo, baseMat, MAX_FERNS);
        this.baseMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FERNS * 3), 3);
        this.baseMesh.castShadow = true;
        this.baseMesh.receiveShadow = true;
        this.baseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.baseMesh.count = 0;
        foliageGroup.add(this.baseMesh);

        this.initialized = true;
        console.log(`[ArpeggioBatcher] Initialized single-mesh system (Cap: ${MAX_FERNS})`);
    }

    register(dummy, options = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_FERNS) {
            console.warn('[ArpeggioBatcher] Max limit reached');
            return;
        }

        const { color = 0x00FF88, scale = 1.0 } = options;
        const i = this.count;
        this.count++;

        // Store reference
        dummy.userData.batchIndex = i;
        dummy.userData.unfurlFactor = 0;
        this.logicFerns.push(dummy);

        // 1. Setup Base Instance
        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * scale;
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();

        this.baseMesh!.setMatrixAt(i, this.dummy.matrix);

        // PALETTE: Sync Base Color
        this._color.setHex(color);
        this.baseMesh!.setColorAt(i, this._color);

        // Update count
        this.baseMesh!.count = this.count;
        this.baseMesh!.instanceMatrix.needsUpdate = true;
        if (this.baseMesh!.instanceColor) this.baseMesh!.instanceColor.needsUpdate = true;


        // 2. Setup Frond Instances
        const startIdx = i * FRONDS_PER_FERN;
        const frondYOffset = 0.4 * scale;

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const idx = startIdx + f;

            // Transform
            this.dummy.position.copy(dummy.position);
            this.dummy.position.y += frondYOffset;
            this.dummy.rotation.copy(dummy.rotation);
            this.dummy.rotateY((f / FRONDS_PER_FERN) * Math.PI * 2);
            this.dummy.rotateX(0.2);
            this.dummy.scale.setScalar(scale);
            this.dummy.updateMatrix();

            this.frondMesh!.setMatrixAt(idx, this.dummy.matrix);
            this.frondMesh!.setColorAt(idx, this._color);
        }

        // Update count
        this.frondMesh!.count = this.count * FRONDS_PER_FERN;
        this.frondMesh!.instanceMatrix.needsUpdate = true;
        if (this.frondMesh!.instanceColor) this.frondMesh!.instanceColor.needsUpdate = true;
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        // Update Base
        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * dummy.scale.x;
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.baseMesh!.setMatrixAt(index, this.dummy.matrix);
        this.baseMesh!.instanceMatrix.needsUpdate = true;

        // Update Fronds
        const startIdx = index * FRONDS_PER_FERN;
        const frondYOffset = 0.4 * dummy.scale.x;

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const idx = startIdx + f;

            this.dummy.position.copy(dummy.position);
            this.dummy.position.y += frondYOffset;
            this.dummy.rotation.copy(dummy.rotation);
            this.dummy.rotateY((f / FRONDS_PER_FERN) * Math.PI * 2);
            this.dummy.rotateX(0.2);
            this.dummy.scale.copy(dummy.scale);
            this.dummy.updateMatrix();

            this.frondMesh!.setMatrixAt(idx, this.dummy.matrix);
        }
        this.frondMesh!.instanceMatrix.needsUpdate = true;
    }

    update(audioState: any = null) {
        if (!this.initialized || this.count === 0) return;

        // ⚡ OPTIMIZATION: Logic moved from WASM/Per-Object to Batch Loop
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

        // --- GLOBAL LOGIC ---
        // Replacing the per-instance loop with global state tracking

        let nextTarget = this.currentTargetStep;

        if (arpeggioActive) {
            // Check for trigger edge (noteTrigger && !lastTrigger)
            if (noteTrigger && !this.lastTrigger) {
                nextTarget += 1;
                if (nextTarget > maxSteps) nextTarget = maxSteps;
            }
        } else {
            // Reset if arpeggio stops
            nextTarget = 0;
        }

        // Store state for next frame
        this.currentTargetStep = nextTarget;
        this.lastTrigger = noteTrigger;

        // Smooth Interpolation
        const speed = (nextTarget > this.currentUnfurlValue) ? 0.3 : 0.05;
        this.currentUnfurlValue += (nextTarget - this.currentUnfurlValue) * speed;

        // Normalized 0..1
        const unfurl = this.currentUnfurlValue / maxSteps;

        // Update Global State
        this.globalUnfurl = unfurl;
        this.uFernUnfurl.value = unfurl;
    }
}

export const arpeggioFernBatcher = new ArpeggioFernBatcher();

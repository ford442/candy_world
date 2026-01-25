import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createCandyMaterial,
    registerReactiveMaterial,
    sharedGeometries
} from './common.js';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv, attribute, varying
} from 'three/tsl';
import { uTime, uGlitchIntensity } from './common.js';
import { applyGlitch } from './glitch.js';

const MAX_FERNS = 2000; // Cap at 2000 ferns (10,000 fronds)
const FRONDS_PER_FERN = 5;
// Chunk size to avoid Uniform Buffer overflow (64KB limit).
const CHUNK_SIZE = 1000;

export class ArpeggioFernBatcher {
    initialized: boolean;
    count: number;
    logicFerns: any[];

    // GPU Buffers
    frondMeshes: THREE.InstancedMesh[];
    unfurlAttributes: THREE.InstancedBufferAttribute[];
    baseMeshes: THREE.InstancedMesh[];

    // Scratch
    dummy: THREE.Object3D;
    _color: THREE.Color;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicFerns = [];

        this.frondMeshes = [];
        this.unfurlAttributes = [];
        this.baseMeshes = [];

        this.dummy = new THREE.Object3D();
        this._color = new THREE.Color();
    }

    init() {
        if (this.initialized) return;

        // 1. Frond Geometry (Base Scale 1.0)
        const frondHeight = 2.3;
        const frondGeo = new THREE.BoxGeometry(0.1, frondHeight, 0.02, 1, 16, 1);
        frondGeo.translate(0, frondHeight / 2, 0); // Pivot at bottom

        // 2. Frond Material (TSL)
        const frondMat = createCandyMaterial(0x00FF88, 0.9);
        registerReactiveMaterial(frondMat);

        // TSL Logic
        // Reads 'instanceUnfurl' from geometry attribute
        const instanceUnfurl = attribute('instanceUnfurl', 'float');

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
        const newPos = vec3(pos.x, newY, newZ);

        const bob = instanceUnfurl.mul(0.2);
        const bobbedPos = newPos.add(vec3(0, bob, 0));

        const glitched = applyGlitch(uv(), bobbedPos, uGlitchIntensity);
        frondMat.positionNode = glitched.position;

        // 3. Create InstancedMeshes (Chunks)
        const totalFronds = MAX_FERNS * FRONDS_PER_FERN;
        const numChunks = Math.ceil(totalFronds / CHUNK_SIZE);

        for(let i=0; i<numChunks; i++) {
            const remaining = totalFronds - (i * CHUNK_SIZE);
            const count = Math.min(CHUNK_SIZE, remaining);

            // Clone geometry to attach unique attribute
            const chunkGeo = frondGeo.clone();
            const chunkAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
            chunkGeo.setAttribute('instanceUnfurl', chunkAttr);
            this.unfurlAttributes.push(chunkAttr);

            const mesh = new THREE.InstancedMesh(chunkGeo, frondMat, count);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            mesh.count = 0;

            this.frondMeshes.push(mesh);
            foliageGroup.add(mesh);
        }

        // 4. Base Geometry & Mesh
        // Base fits in one batch (2000 instances < 1000? No, 2000 > 1000).
        // Wait, 2000 * 64 = 128,000 bytes. This also exceeds 64KB!
        // We must chunk baseMesh too!
        // MAX_FERNS = 2000.
        // Base mesh logic:

        const baseGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
        baseGeo.translate(0, 0.25, 0);
        const baseMat = createCandyMaterial(0x2E8B57);

        // Split Base Mesh (2000 instances)
        this.baseMeshes = [];
        const baseChunks = Math.ceil(MAX_FERNS / CHUNK_SIZE);
        for(let i=0; i<baseChunks; i++) {
            const remaining = MAX_FERNS - (i * CHUNK_SIZE);
            const count = Math.min(CHUNK_SIZE, remaining);

            const mesh = new THREE.InstancedMesh(baseGeo, baseMat, count);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            this.baseMeshes.push(mesh);
            foliageGroup.add(mesh);
        }

        this.initialized = true;
        console.log(`[ArpeggioBatcher] Initialized with ${numChunks} frond chunks and ${baseChunks} base chunks`);
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
        const baseChunkIdx = Math.floor(i / CHUNK_SIZE);
        const baseLocalIdx = i % CHUNK_SIZE;

        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * scale;
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();

        const baseMesh = this.baseMeshes[baseChunkIdx];
        baseMesh.setMatrixAt(baseLocalIdx, this.dummy.matrix);
        // Update count
        if (baseMesh.count < baseLocalIdx + 1) baseMesh.count = baseLocalIdx + 1;
        baseMesh.instanceMatrix.needsUpdate = true;


        // 2. Setup Frond Instances
        const startIdx = i * FRONDS_PER_FERN;
        const frondYOffset = 0.4 * scale;
        this._color.setHex(color);

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const idx = startIdx + f;
            const chunkIdx = Math.floor(idx / CHUNK_SIZE);
            const localIdx = idx % CHUNK_SIZE;

            const mesh = this.frondMeshes[chunkIdx];
            const attr = this.unfurlAttributes[chunkIdx];

            // Transform
            this.dummy.position.copy(dummy.position);
            this.dummy.position.y += frondYOffset;
            this.dummy.rotation.copy(dummy.rotation);
            this.dummy.rotateY((f / FRONDS_PER_FERN) * Math.PI * 2);
            this.dummy.rotateX(0.2);
            this.dummy.scale.setScalar(scale);
            this.dummy.updateMatrix();

            mesh.setMatrixAt(localIdx, this.dummy.matrix);
            mesh.setColorAt(localIdx, this._color);

            // Update count
            if (mesh.count < localIdx + 1) mesh.count = localIdx + 1;

            // Init Attribute
            attr.setX(localIdx, 0);

            // Mark updates
            // (We'll optimize by setting needsUpdate once at end if batching multiple registers,
            // but here register is called one by one)
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            attr.needsUpdate = true;
        }
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        // Update Base
        const baseChunkIdx = Math.floor(index / CHUNK_SIZE);
        const baseLocalIdx = index % CHUNK_SIZE;

        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * dummy.scale.x;
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        const baseMesh = this.baseMeshes[baseChunkIdx];
        baseMesh.setMatrixAt(baseLocalIdx, this.dummy.matrix);
        baseMesh.instanceMatrix.needsUpdate = true;

        // Update Fronds
        const startIdx = index * FRONDS_PER_FERN;
        const frondYOffset = 0.4 * dummy.scale.x;

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const idx = startIdx + f;
            const chunkIdx = Math.floor(idx / CHUNK_SIZE);
            const localIdx = idx % CHUNK_SIZE;

            this.dummy.position.copy(dummy.position);
            this.dummy.position.y += frondYOffset;
            this.dummy.rotation.copy(dummy.rotation);
            this.dummy.rotateY((f / FRONDS_PER_FERN) * Math.PI * 2);
            this.dummy.rotateX(0.2);
            this.dummy.scale.copy(dummy.scale);
            this.dummy.updateMatrix();

            const mesh = this.frondMeshes[chunkIdx];
            mesh.setMatrixAt(localIdx, this.dummy.matrix);
            mesh.instanceMatrix.needsUpdate = true;
        }
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

        // Loop through active ferns and sync unfurl state
        for (let i = 0; i < this.count; i++) {
            const dummy = this.logicFerns[i];

            // 1. Update State Machine
            let nextTarget = dummy.userData.targetStep || 0;
            const lastTrigger = dummy.userData.lastTrigger || false;

            if (arpeggioActive) {
                if (noteTrigger && !lastTrigger) {
                    nextTarget += 1;
                    if (nextTarget > maxSteps) nextTarget = maxSteps;
                }
            } else {
                nextTarget = 0;
            }

            dummy.userData.targetStep = nextTarget;
            dummy.userData.lastTrigger = noteTrigger;

            let currentUnfurl = dummy.userData.unfurlStep || 0;
            const speed = (nextTarget > currentUnfurl) ? 0.3 : 0.05;
            currentUnfurl += (nextTarget - currentUnfurl) * speed;
            dummy.userData.unfurlStep = currentUnfurl;

            const unfurl = currentUnfurl / maxSteps;
            dummy.userData.unfurlFactor = unfurl;

            // 2. Update Attribute if changed
            if (Math.abs(unfurl - (dummy.userData._lastUnfurl || 0)) > 0.001 || dummy.userData._lastUnfurl === undefined) {
                dummy.userData._lastUnfurl = unfurl;

                const startIdx = i * FRONDS_PER_FERN;
                for (let f = 0; f < FRONDS_PER_FERN; f++) {
                    const idx = startIdx + f;
                    const chunkIdx = Math.floor(idx / CHUNK_SIZE);
                    const localIdx = idx % CHUNK_SIZE;

                    this.unfurlAttributes[chunkIdx].setX(localIdx, unfurl);
                    this.unfurlAttributes[chunkIdx].needsUpdate = true;
                }
            }
        }
    }
}

export const arpeggioFernBatcher = new ArpeggioFernBatcher();

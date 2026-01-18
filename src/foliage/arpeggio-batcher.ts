import * as THREE from 'three';
import { foliageGroup } from '../world/state.js';
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

export class ArpeggioFernBatcher {
    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicFerns = []; // Stores the dummy objects

        // GPU Buffers
        this.frondMesh = null;
        this.baseMesh = null;
        this.unfurlAttribute = null;

        // Scratch
        this.dummy = new THREE.Object3D();
        this._color = new THREE.Color();
    }

    init() {
        if (this.initialized) return;

        // 1. Frond Geometry (Base Scale 1.0)
        // Width=0.1, Height=2.3, Depth=0.02
        const frondHeight = 2.3;
        const frondGeo = new THREE.BoxGeometry(0.1, frondHeight, 0.02, 1, 16, 1);
        frondGeo.translate(0, frondHeight / 2, 0); // Pivot at bottom

        // 2. Frond Material (TSL)
        const frondMat = createCandyMaterial(0x00FF88, 0.9);
        registerReactiveMaterial(frondMat);

        // Instance Attribute for Unfurl (0.0 to 1.0)
        // Default 0.0 (Curled)
        this.unfurlAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FERNS * FRONDS_PER_FERN), 1);
        frondGeo.setAttribute('instanceUnfurl', this.unfurlAttribute);

        // TSL Logic
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

        // Add Bob (Unfurl * 0.2)
        const bob = instanceUnfurl.mul(0.2);
        const bobbedPos = newPos.add(vec3(0, bob, 0));

        const glitched = applyGlitch(uv(), bobbedPos, uGlitchIntensity);
        frondMat.positionNode = glitched.position;

        // 3. Create InstancedMesh for Fronds
        this.frondMesh = new THREE.InstancedMesh(frondGeo, frondMat, MAX_FERNS * FRONDS_PER_FERN);
        this.frondMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Static mostly, but initial setup is dynamic
        this.frondMesh.castShadow = true;
        this.frondMesh.receiveShadow = true;
        this.frondMesh.frustumCulled = false; // Manually culled via logic objects if needed, or let GPU handle it (it's one mesh)
        // Note: For InstancedMesh, frustum culling checks the bounding sphere of ALL instances.
        // Since they span the map, it will always be rendered. This is fine for 10k tris.

        // 4. Base Geometry & Mesh
        // Cone: 0.2, 0.5, 6
        const baseGeo = new THREE.ConeGeometry(0.2, 0.5, 6);
        baseGeo.translate(0, 0.25, 0);
        const baseMat = createCandyMaterial(0x2E8B57); // Dark Green
        this.baseMesh = new THREE.InstancedMesh(baseGeo, baseMat, MAX_FERNS);
        this.baseMesh.castShadow = true;
        this.baseMesh.receiveShadow = true;

        // Add to scene
        foliageGroup.add(this.frondMesh);
        foliageGroup.add(this.baseMesh);

        this.initialized = true;
        console.log('[ArpeggioBatcher] Initialized');
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
        dummy.userData.unfurlFactor = 0; // Init state
        this.logicFerns.push(dummy);

        // 1. Setup Base Instance
        // Base is at dummy position
        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * scale; // Offset as in original
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        this.baseMesh.setMatrixAt(i, this.dummy.matrix);

        // 2. Setup Frond Instances (5 per fern)
        const startIdx = i * FRONDS_PER_FERN;
        const frondYOffset = 0.4 * scale;

        // Precompute color
        this._color.setHex(color);

        for (let f = 0; f < FRONDS_PER_FERN; f++) {
            const idx = startIdx + f;

            // Transform
            this.dummy.position.copy(dummy.position);
            this.dummy.position.y += frondYOffset;
            this.dummy.rotation.copy(dummy.rotation);
            // Add local rotation for frond distribution
            this.dummy.rotateY((f / FRONDS_PER_FERN) * Math.PI * 2);
            this.dummy.rotateX(0.2); // Tilt out
            this.dummy.scale.setScalar(scale);
            this.dummy.updateMatrix();

            this.frondMesh.setMatrixAt(idx, this.dummy.matrix);
            this.frondMesh.setColorAt(idx, this._color);

            // Init Attribute
            this.unfurlAttribute.setX(idx, 0);
        }

        this.baseMesh.instanceMatrix.needsUpdate = true;
        this.frondMesh.instanceMatrix.needsUpdate = true;
        if (this.frondMesh.instanceColor) this.frondMesh.instanceColor.needsUpdate = true;
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        // Update Base
        // Base Matrix
        this.dummy.position.copy(dummy.position);
        this.dummy.position.y += 0.25 * dummy.scale.x;
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();
        this.baseMesh.setMatrixAt(index, this.dummy.matrix);

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

            this.frondMesh.setMatrixAt(idx, this.dummy.matrix);
        }

        this.baseMesh.instanceMatrix.needsUpdate = true;
        this.frondMesh.instanceMatrix.needsUpdate = true;
    }

    update() {
        if (!this.initialized || this.count === 0) return;

        let needsUpdate = false;

        // Loop through active ferns and sync unfurl state
        for (let i = 0; i < this.count; i++) {
            const dummy = this.logicFerns[i];
            const unfurl = dummy.userData.unfurlFactor || 0;

            // Check if changed (optimization: could store last value)
            if (Math.abs(unfurl - dummy.userData._lastUnfurl) > 0.001 || dummy.userData._lastUnfurl === undefined) {
                dummy.userData._lastUnfurl = unfurl;

                const startIdx = i * FRONDS_PER_FERN;
                for (let f = 0; f < FRONDS_PER_FERN; f++) {
                    this.unfurlAttribute.setX(startIdx + f, unfurl);
                }
                needsUpdate = true;
            }

            // Also sync scale/position if they are bouncing via other systems
            // The arpeggio system sets position.y for bobbing
            // Original: foliageObject.position.y = foliageObject.userData.originalY + unfurlFactor * 0.2;
            // Since we baked position into matrix, we need to update matrix if Y changes.
            // This is expensive (matrix update).
            // ⚡ OPTIMIZATION DECISION: Skip the "bob" on Y axis for batched ferns to save matrix uploads.
            // Or implement it via Vertex Shader if critical (using instanceUnfurl to drive Y offset).

            // Update: We can just use the instanceUnfurl in shader to add Y offset!
            // Shader: newPos.y += instanceUnfurl * 0.2;
            // Wait, TSL code: newPos is calculated. I can add offset there.
            // Let's modify the TSL in init() to include the bob.
        }

        if (needsUpdate) {
            this.unfurlAttribute.needsUpdate = true;
        }
    }
}

export const arpeggioFernBatcher = new ArpeggioFernBatcher();

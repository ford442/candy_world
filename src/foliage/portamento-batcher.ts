import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
    createClayMaterial,
    createCandyMaterial,
    registerReactiveMaterial
} from './common.js';
import {
    vec3, positionLocal, sin, attribute, uv
} from 'three/tsl';
import { uTime, uGlitchIntensity } from './common.js';
import { applyGlitch } from './glitch.js';

const MAX_PINES = 200; // Cap at 200 pines

export class PortamentoPineBatcher {
    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicPines = []; // Stores the dummy objects

        // GPU Buffers
        this.trunkMesh = null;
        this.needleMesh = null;
        this.bendAttribute = null;

        // Scratch
        this.dummy = new THREE.Object3D();
    }

    init() {
        if (this.initialized) return;

        // 1. Geometry Generation (Merged)
        const height = 4.0;
        const segments = 6;
        const segHeight = height / segments;

        const trunkGeometries = [];
        const needleGeometries = [];

        for (let i = 0; i < segments; i++) {
            const yBase = i * segHeight;
            const rBot = 0.4 * (1 - i/segments) + 0.1;
            const rTop = 0.4 * (1 - (i+1)/segments) + 0.1;

            // Trunk Segment
            const tGeo = new THREE.CylinderGeometry(rTop, rBot, segHeight, 8);
            tGeo.translate(0, yBase + segHeight/2, 0);
            trunkGeometries.push(tGeo);

            // Needles (only for i > 1)
            if (i > 1) {
                const needleCount = 8;
                for (let n = 0; n < needleCount; n++) {
                    const nGeo = new THREE.ConeGeometry(0.1, 0.6, 4);

                    // Rotation
                    nGeo.rotateZ(1.5);
                    nGeo.rotateY((n/needleCount) * Math.PI * 2);

                    // Position
                    const px = Math.cos((n/needleCount) * Math.PI * 2) * rBot;
                    const pz = Math.sin((n/needleCount) * Math.PI * 2) * rBot;
                    const py = segHeight * 0.5;

                    nGeo.translate(px, py, pz); // Local to segment
                    nGeo.translate(0, yBase, 0); // World offset

                    needleGeometries.push(nGeo);
                }
            }
        }

        let trunkGeo = mergeGeometries(trunkGeometries);
        let needleGeo = mergeGeometries(needleGeometries);

        if (!trunkGeo || !needleGeo) {
            console.error('[PortamentoBatcher] Geometry merge failed');
            return;
        }

        // 2. Materials & TSL
        const trunkMat = createClayMaterial(0x8B4513);
        const needleMat = createCandyMaterial(0x2E8B57, 0.5);
        registerReactiveMaterial(needleMat);

        // Instance Attribute for Bending (0.0 to 1.0)
        // Default 0.0 (Straight)
        this.bendAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1);
        trunkGeo.setAttribute('instanceBend', this.bendAttribute);
        needleGeo.setAttribute('instanceBend', this.bendAttribute);

        // TSL Logic
        const applyBend = (material) => {
            const instanceBend = attribute('instanceBend', 'float');
            const pos = positionLocal;

            // Bend based on Y height (squared for curve)
            // Normalized height roughly 0 to 4
            const bendFactor = pos.y.mul(0.2);
            const bendCurve = bendFactor.mul(bendFactor);

            // Wobble animation (audio reactive if linked to bend)
            // We use instanceBend as amplitude
            const wobble = sin(uTime.mul(3.0).add(pos.y)).mul(0.1).mul(instanceBend);

            // Directional bend (X axis)
            const bendOffset = bendCurve.mul(instanceBend).add(wobble);

            const newPos = pos.add(vec3(bendOffset, 0, 0));

            const glitched = applyGlitch(uv(), newPos, uGlitchIntensity);
            material.positionNode = glitched.position;
        };

        applyBend(trunkMat);
        applyBend(needleMat);

        // 3. Create InstancedMeshes
        this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_PINES);
        this.needleMesh = new THREE.InstancedMesh(needleGeo, needleMat, MAX_PINES);

        this.trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.needleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        this.trunkMesh.castShadow = true;
        this.trunkMesh.receiveShadow = true;
        this.needleMesh.castShadow = true;
        this.needleMesh.receiveShadow = true;

        // Hide initially until registered
        this.trunkMesh.count = 0;
        this.needleMesh.count = 0;

        foliageGroup.add(this.trunkMesh);
        foliageGroup.add(this.needleMesh);

        this.initialized = true;
        console.log('[PortamentoBatcher] Initialized');
    }

    register(dummy, options = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_PINES) {
            console.warn('[PortamentoBatcher] Max limit reached');
            return;
        }

        const i = this.count;
        this.count++;

        dummy.userData.batchIndex = i;
        dummy.userData.bendFactor = 0;
        this.logicPines.push(dummy);

        // Setup Transform
        // Note: dummy.scale affects height. Our geometry is base height 4.
        // If dummy.scale.y is 1.0, height is 4.0.
        // If createPortamentoPine uses scale to set height, we are good.
        // But createPortamentoPine had a 'height' option.
        // If we want to support variable heights without scaling thickness, we need TSL to stretch Y.
        // For now, we assume uniform scaling (thicker = taller) or just simple scaling.

        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.trunkMesh.setMatrixAt(i, this.dummy.matrix);
        this.needleMesh.setMatrixAt(i, this.dummy.matrix);

        this.bendAttribute.setX(i, 0);

        this.trunkMesh.instanceMatrix.needsUpdate = true;
        this.needleMesh.instanceMatrix.needsUpdate = true;

        this.trunkMesh.count = this.count;
        this.needleMesh.count = this.count;
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.trunkMesh.setMatrixAt(index, this.dummy.matrix);
        this.needleMesh.setMatrixAt(index, this.dummy.matrix);

        this.trunkMesh.instanceMatrix.needsUpdate = true;
        this.needleMesh.instanceMatrix.needsUpdate = true;
    }

    update() {
        if (!this.initialized || this.count === 0) return;

        let needsUpdate = false;

        // Animate Bend based on logic state
        // In this simplified version, we just use a sine wave or listen to something?
        // Ideally we should hook into 'audioData'.
        // But 'update()' here doesn't receive audioData.
        // We can pass it, or read from global 'uAudioLow'.

        // However, 'portamentoBend' implies logic.
        // Let's assume the Logic Object (dummy) has some properties set by animation system?
        // But animation.ts doesn't handle portamentoBend.

        // We will implement a simple ambient sway here for now.
        // And if 'isHovered', we bend more.

        const time = performance.now() * 0.001;

        for (let i = 0; i < this.count; i++) {
            const dummy = this.logicPines[i];

            let targetBend = Math.sin(time + i) * 0.2; // Ambient sway

            if (dummy.userData.isHovered) {
                targetBend += 0.5; // Lean when hovered
            }

            // Sync to attribute
            if (Math.abs(targetBend - dummy.userData._lastBend) > 0.01 || dummy.userData._lastBend === undefined) {
                dummy.userData._lastBend = targetBend;
                this.bendAttribute.setX(i, targetBend);
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.bendAttribute.needsUpdate = true;
        }
    }
}

export const portamentoPineBatcher = new PortamentoPineBatcher();

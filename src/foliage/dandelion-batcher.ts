import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
    createStandardNodeMaterial,
    calculateWindSway,
    applyPlayerInteraction,
    uAudioLow,
    uAudioHigh,
    uTime,
    createSugarSparkle
} from './common.ts';
import {
    float, vec3, positionLocal, attribute, mix, sin,
    instanceIndex, normalLocal, step, length
} from 'three/tsl';

const MAX_DANDELIONS = 500;
const SEEDS_PER_HEAD = 24;

// Scratch variables
const _scratchMat = new THREE.Matrix4();
const _scratchScale = new THREE.Vector3();

// Colors
const COLOR_STEM = new THREE.Color(0x556B2F); // Olive Drab
const COLOR_STALK = new THREE.Color(0xFFFFFF); // White
const COLOR_TIP = new THREE.Color(0xFFD700);   // Gold

export class DandelionBatcher {
    initialized: boolean;
    count: number;

    mesh: THREE.InstancedMesh | null;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.mesh = null;
    }

    init() {
        if (this.initialized) return;

        // --- 1. Geometry Construction (Unified) ---

        const geometries: THREE.BufferGeometry[] = [];

        // A. Stem
        // Cylinder radius 0.02, height 1.5. Pivot at bottom (translate y=0.75)
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 1.5, 6);
        stemGeo.translate(0, 0.75, 0);

        // Add Attributes for Stem
        const stemCount = stemGeo.attributes.position.count;
        const stemColors = new Float32Array(stemCount * 3);
        const stemPuff = new Float32Array(stemCount * 3); // Zeros (no puff)

        for(let i=0; i<stemCount; i++) {
            stemColors[i*3] = COLOR_STEM.r;
            stemColors[i*3+1] = COLOR_STEM.g;
            stemColors[i*3+2] = COLOR_STEM.b;
            // Puff Dir remains 0,0,0
        }
        stemGeo.setAttribute('color', new THREE.BufferAttribute(stemColors, 3));
        stemGeo.setAttribute('aPuffDir', new THREE.BufferAttribute(stemPuff, 3));
        geometries.push(stemGeo);

        // B. Seeds (Stalk + Tip)
        // Reusable Base Geometries for seeds
        const baseStalkGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.4, 3);
        baseStalkGeo.translate(0, 0.2, 0); // Pivot at bottom

        const baseTipGeo = new THREE.SphereGeometry(0.04, 6, 6);
        // Tip is at the end of the stalk (y=0.4)
        baseTipGeo.translate(0, 0.4, 0);

        // Head Center relative to Stem Pivot
        // Stem is 1.5 high. Head center is at y=1.5
        const headCenterY = 1.5;

        for (let s = 0; s < SEEDS_PER_HEAD; s++) {
            // 1. Calculate Seed Direction
            const phi = Math.acos(-1 + (2 * s) / SEEDS_PER_HEAD);
            const theta = Math.sqrt(SEEDS_PER_HEAD * Math.PI) * phi;

            const dir = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ).normalize();

            // 2. Align Seed (Y-up aligns with Dir)
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
            // Translate to Head Center
            m.setPosition(0, headCenterY, 0); // All seeds start from head center

            // 3. Transform & Clone Stalk
            const sGeo = baseStalkGeo.clone();
            sGeo.applyMatrix4(m);

            // Attributes for Stalk
            const sCount = sGeo.attributes.position.count;
            const sColors = new Float32Array(sCount * 3);
            const sPuff = new Float32Array(sCount * 3);

            for(let k=0; k<sCount; k++) {
                sColors[k*3] = COLOR_STALK.r;
                sColors[k*3+1] = COLOR_STALK.g;
                sColors[k*3+2] = COLOR_STALK.b;

                sPuff[k*3] = dir.x;
                sPuff[k*3+1] = dir.y;
                sPuff[k*3+2] = dir.z;
            }
            sGeo.setAttribute('color', new THREE.BufferAttribute(sColors, 3));
            sGeo.setAttribute('aPuffDir', new THREE.BufferAttribute(sPuff, 3));
            geometries.push(sGeo);

            // 4. Transform & Clone Tip
            const tGeo = baseTipGeo.clone();
            tGeo.applyMatrix4(m); // Transforms to head center + rotation

            // Attributes for Tip
            const tCount = tGeo.attributes.position.count;
            const tColors = new Float32Array(tCount * 3);
            const tPuff = new Float32Array(tCount * 3);

            for(let k=0; k<tCount; k++) {
                tColors[k*3] = COLOR_TIP.r;
                tColors[k*3+1] = COLOR_TIP.g;
                tColors[k*3+2] = COLOR_TIP.b;

                tPuff[k*3] = dir.x;
                tPuff[k*3+1] = dir.y;
                tPuff[k*3+2] = dir.z;
            }
            tGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
            tGeo.setAttribute('aPuffDir', new THREE.BufferAttribute(tPuff, 3));
            geometries.push(tGeo);
        }

        // Merge all
        const unifiedGeo = mergeGeometries(geometries);
        // Ensure bounds are correct for culling
        unifiedGeo.computeBoundingSphere();


        // --- 2. Material (TSL Juice) ---

        const mat = createStandardNodeMaterial({
            side: THREE.FrontSide,
            vertexColors: true, // Use attribute('color')
            roughness: 0.8,
            metalness: 0.0
        });

        // Inputs
        const vColor = attribute('color', 'vec3');
        const vPuffDir = attribute('aPuffDir', 'vec3');

        // 1. Base Color logic
        mat.colorNode = vColor;

        // 2. Emission & Roughness Logic
        // Detect Gold Tip: Red > 0.5 (Stalk/Tip) AND Blue < 0.1 (Stem/Tip has low blue? No Stem has 0.18, Stalk has 1.0)
        // Tip: R=1.0, G=0.84, B=0.0
        // Stalk: R=1.0, G=1.0, B=1.0
        // Stem: R=0.33, G=0.42, B=0.18

        // Gold check: High Red, Low Blue.
        const highRed = step(0.5, vColor.r);
        const lowBlue = float(1.0).sub(step(0.1, vColor.b));
        const isGold = highRed.mul(lowBlue);

        // Audio Pulse for Gold
        const pulse = uAudioHigh.mul(3.0);
        // Reduce sugar sparkle density/scale for tips
        const sparkle = createSugarSparkle(normalLocal, float(40.0), float(0.5), float(2.0));

        // Emission: Only on Gold Tips
        const goldEmission = vColor.mul(float(0.2).add(pulse)).add(sparkle);

        // Mix: If Gold, use Emission. Else Black.
        mat.emissiveNode = mix(vec3(0.0), goldEmission, isGold);

        // Roughness: Gold is shiny (0.2), others are matte (0.8)
        mat.roughnessNode = mix(float(0.8), float(0.2), isGold);


        // 3. Animation Logic (Puff + Shake + Sway + Push)

        // A. Puff (Breathing) - Expand along aPuffDir
        const puffOffset = vPuffDir.mul(uAudioLow).mul(0.3);

        // B. Shake (High Freq Vibration) - Only for seeds
        // Use length(vPuffDir) to detect seeds (non-zero puff dir)
        const seedFactor = step(0.1, length(vPuffDir)); // 1.0 if seed, 0.0 if stem

        const shakePhase = instanceIndex.add(uTime.mul(20.0));
        const shakeAmt = sin(shakePhase).mul(0.02).mul(uAudioHigh);
        const shakeOffset = vPuffDir.mul(shakeAmt).mul(seedFactor);

        // Apply Local Deformations
        const posPuffed = positionLocal.add(puffOffset).add(shakeOffset);

        // C. Global Sway & Player Interaction
        // Apply to the *entire* geometry (Stem + Seeds)
        // This makes the stem bend, and seeds (being part of same geo) move with it.
        const posSwayed = posPuffed.add(calculateWindSway(posPuffed));
        const posFinal = applyPlayerInteraction(posSwayed);

        mat.positionNode = posFinal;


        // --- 3. InstancedMesh Setup ---

        this.mesh = new THREE.InstancedMesh(unifiedGeo, mat, MAX_DANDELIONS);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.count = 0;

        if (foliageGroup) {
            foliageGroup.add(this.mesh);
        }

        this.initialized = true;
        console.log(`[DandelionBatcher] Unified Initialized. 1 Draw Call.`);
    }

    register(logicObject: THREE.Object3D, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_DANDELIONS) return;

        const i = this.count;
        this.count++;

        // Scale logic
        const scale = options.scale || 1.0;

        // Copy transform from logic object
        logicObject.updateMatrix();
        _scratchMat.copy(logicObject.matrix);

        // Apply Scale to the matrix
        _scratchScale.setScalar(scale);
        _scratchMat.scale(_scratchScale);

        this.mesh!.setMatrixAt(i, _scratchMat);
        this.mesh!.instanceMatrix.needsUpdate = true;
        this.mesh!.count = this.count;
    }
}

export const dandelionBatcher = new DandelionBatcher();

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
    foliageMaterials,
    sharedGeometries,
    calculateFlowerBloom,
    calculateWindSway,
    applyPlayerInteraction,
    CandyPresets,
    createStandardNodeMaterial,
    createJuicyRimLight,
    uAudioHigh,
    uTime
} from './common.ts';
import { attribute, positionLocal, mix, color, float, sin } from 'three/tsl';

const MAX_FLOWERS = 5000;
const MAX_PETALS = MAX_FLOWERS * 15; // Up to 15 petals per flower

// ⚡ OPTIMIZATION: Scratch variables to prevent GC spikes during registration
const _scratchMatrix = new THREE.Matrix4();
const _scratchMatrix2 = new THREE.Matrix4();
const _scratchMatrix3 = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchEuler = new THREE.Euler();
const _scratchColor = new THREE.Color();
const _scratchHsl = { h: 0, s: 0, l: 0 };

export class FlowerBatcher {
    private static instance: FlowerBatcher;
    private initialized = false;

    // Batches
    private stems: THREE.InstancedMesh;
    private centers: THREE.InstancedMesh;
    private stamens: THREE.InstancedMesh;

    // Petal Batches (by shape)
    private petalsSimple: THREE.InstancedMesh; // Icosahedron
    private petalsMulti: THREE.InstancedMesh;  // Sphere
    private petalsSpiral: THREE.InstancedMesh; // Cone

    // Counts
    private stemCount = 0;
    private centerCount = 0;
    private stamenCount = 0;
    private simpleCount = 0;
    private multiCount = 0;
    private spiralCount = 0;

    private constructor() {
        // Deferred init
    }

    static getInstance(): FlowerBatcher {
        if (!FlowerBatcher.instance) {
            FlowerBatcher.instance = new FlowerBatcher();
        }
        return FlowerBatcher.instance;
    }

    init() {
        if (this.initialized) return;

        // --- Common TSL Logic ---
        // Apply Bloom -> Wind -> Player Interaction
        const posBloom = calculateFlowerBloom(positionLocal);
        const posWind = posBloom.add(calculateWindSway(posBloom));
        const posFinal = applyPlayerInteraction(posWind);

        // --- 1. Stems (Cylinder) ---
        // Use existing flowerStem material logic but ensure it works with instancing
        // flowerStem in common.ts already has positionNode logic.
        // We need to CLONE it to avoid conflict if it's used elsewhere non-instanced?
        // Actually, TSL materials handle instancing automatically if logic uses attributes/uniforms correctly.
        // But flowerStem uses 'calculateWindSway' which uses 'positionWorld'.
        // InstancedMesh updates positionWorld correctly in VertexNode.
        const stemMat = (foliageMaterials.flowerStem as THREE.Material).clone();

        this.stems = new THREE.InstancedMesh(sharedGeometries.unitCylinder, stemMat, MAX_FLOWERS);
        this.stems.castShadow = true;
        this.stems.receiveShadow = true;
        this.stems.frustumCulled = false;
        this.stems.count = 0;
        foliageGroup.add(this.stems);

        // --- 2. Centers (Sphere) ---
        const centerMat = (foliageMaterials.flowerCenter as THREE.Material).clone();
        (centerMat as any).positionNode = posFinal; // Apply full deformation chain

        this.centers = new THREE.InstancedMesh(sharedGeometries.unitSphere, centerMat, MAX_FLOWERS);
        this.centers.castShadow = true;
        this.centers.receiveShadow = true;
        this.centers.frustumCulled = false;
        this.centers.count = 0;
        foliageGroup.add(this.centers);

        // --- 3. Stamens (Cylinder) ---
        const stamenMat = CandyPresets.Clay(0xFFFF00, { deformationNode: posFinal });
        this.stamens = new THREE.InstancedMesh(sharedGeometries.unitCylinder, stamenMat, MAX_FLOWERS * 3);
        this.stamens.castShadow = true;
        this.stamens.receiveShadow = true;
        this.stamens.frustumCulled = false;
        this.stamens.count = 0;
        foliageGroup.add(this.stamens);

        // --- 4. Petals (Shared Material) ---
        // Use Velvet preset for petals, supporting instanceColor
        const instanceColor = attribute('instanceColor', 'vec3');

        // --- PALETTE: Petal Breathing Animation ---
        // Add subtle procedural life to petals, slightly offsetting based on local coordinates
        const phaseOffset = positionLocal.x.add(positionLocal.y).add(positionLocal.z).mul(5.0);
        const petalBreath = sin(uTime.mul(2.0).add(phaseOffset)).mul(0.05).add(1.0);
        const petalDeformation = posFinal.mul(petalBreath);

        const petalMat = CandyPresets.Velvet(0xFFFFFF, {
            colorNode: instanceColor, // Use instance color
            deformationNode: petalDeformation, // Apply deformation with breathing
            side: THREE.DoubleSide,
            audioReactStrength: 1.0,
            rimStrength: 0.5
        });

        // Add Audio-Reactive Rim Light to petals
        // 🎨 PALETTE: Boosted Rim Light for more pop in twilight
        const audioRim = createJuicyRimLight(instanceColor, float(2.0).add(uAudioHigh.mul(4.0)), float(2.0));

        // --- PALETTE: Audio Reactive Inner Glow ---
        // Give petals a deep soft glow when the melody hits (increased intensity)
        const innerGlow = instanceColor.mul(uAudioHigh).mul(1.2);

        petalMat.emissiveNode = audioRim.add(innerGlow);

        // Simple Petals (Icosahedron)
        let simpleGeo = new THREE.IcosahedronGeometry(0.15, 0);
        simpleGeo = mergeVertices(simpleGeo);
        simpleGeo.scale(1, 0.5, 1);

        this.petalsSimple = new THREE.InstancedMesh(simpleGeo, petalMat, MAX_PETALS);
        this.petalsSimple.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsSimple.castShadow = true;
        this.petalsSimple.receiveShadow = true;
        this.petalsSimple.frustumCulled = false;
        this.petalsSimple.count = 0;
        foliageGroup.add(this.petalsSimple);

        // Multi Petals (Sphere)
        this.petalsMulti = new THREE.InstancedMesh(sharedGeometries.unitSphere, petalMat, MAX_PETALS);
        this.petalsMulti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsMulti.castShadow = true;
        this.petalsMulti.receiveShadow = true;
        this.petalsMulti.frustumCulled = false;
        this.petalsMulti.count = 0;
        foliageGroup.add(this.petalsMulti);

        // Spiral Petals (Cone)
        this.petalsSpiral = new THREE.InstancedMesh(sharedGeometries.unitCone, petalMat, MAX_PETALS);
        this.petalsSpiral.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsSpiral.castShadow = true;
        this.petalsSpiral.receiveShadow = true;
        this.petalsSpiral.frustumCulled = false;
        this.petalsSpiral.count = 0;
        foliageGroup.add(this.petalsSpiral);

        this.initialized = true;
        console.log('[FlowerBatcher] Initialized');
    }

    register(group: THREE.Group, type: string, options: any = {}) {
        if (!this.initialized) this.init();

        // ⚡ OPTIMIZATION: Mark as batched
        group.userData.isBatched = true;

        // Ensure world matrix is up to date
        group.updateMatrixWorld(true);
        const rootMatrix = group.matrixWorld;

        // Parse options
        const colorHex = options.color !== undefined ? options.color : null;
        let color = _scratchColor;
        color.set(0xFF69B4); // Default pink
        if (colorHex !== null) {
            if (colorHex.isColor) color.copy(colorHex);
            else color.set(colorHex);
        }

        // --- Logic mirroring createFlower ---
        // ⚡ OPTIMIZATION: Using scratch variables to avoid GC stutter during large generations

        // 1. Stem
        const stemHeight = 0.6 + Math.random() * 0.4;
        _scratchScale.set(0.05, stemHeight, 0.05);
        _scratchPos.set(0, 0, 0); // Local pos 0 (pivot is bottom)
        _scratchQuat.identity();

        _scratchMatrix2.compose(_scratchPos, _scratchQuat, _scratchScale);

        // Transform to world
        _scratchMatrix.multiplyMatrices(rootMatrix, _scratchMatrix2);
        this.addInstance(this.stems, _scratchMatrix, null, 'stemCount');

        // 2. Head Setup
        // Head pivot is at (0, stemHeight, 0)
        // We construct a head root matrix in world space
        _scratchMatrix2.makeTranslation(0, stemHeight, 0);
        // Using _scratchMatrix3 as the new headMatrix
        _scratchMatrix3.multiplyMatrices(rootMatrix, _scratchMatrix2);

        // 3. Center
        _scratchMatrix2.makeScale(0.1, 0.1, 0.1);
        _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
        this.addInstance(this.centers, _scratchMatrix, null, 'centerCount');

        // 4. Stamens
        const stamenCount = 3;
        for (let i = 0; i < stamenCount; i++) {
            const rz = (Math.random() - 0.5) * 1.0;
            const rx = (Math.random() - 0.5) * 1.0;

            // Compose: Translate(0, 0.075, 0) * Rotate * Scale
            _scratchPos.set(0, 0.075, 0);
            _scratchEuler.set(rx, 0, rz);
            _scratchQuat.setFromEuler(_scratchEuler);
            _scratchScale.set(0.01, 0.15, 0.01);

            _scratchMatrix2.compose(_scratchPos, _scratchQuat, _scratchScale);
            _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
            this.addInstance(this.stamens, _scratchMatrix, null, 'stamenCount');
        }

        // 5. Petals
        if (type === 'simple') {
            const petalCount = 5 + Math.floor(Math.random() * 2);
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2;
                _scratchMatrix2.makeRotationZ(Math.PI / 4);
                _scratchMatrix2.setPosition(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);

                _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
                this.addInstance(this.petalsSimple, _scratchMatrix, color, 'simpleCount');
            }
        } else if (type === 'multi') {
            const petalCount = 8 + Math.floor(Math.random() * 4);
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2;
                _scratchPos.set(
                    Math.cos(angle) * 0.2,
                    Math.sin(i * 0.5) * 0.1,
                    Math.sin(angle) * 0.2
                );

                _scratchMatrix2.makeTranslation(_scratchPos.x, _scratchPos.y, _scratchPos.z);
                _scratchMatrix2.scale(_scratchScale.set(0.12, 0.12, 0.12));

                _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
                this.addInstance(this.petalsMulti, _scratchMatrix, color, 'multiCount');
            }
        } else if (type === 'spiral') {
            const petalCount = 10;
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 4;
                const radius = 0.05 + (i / petalCount) * 0.15;

                _scratchPos.set(Math.cos(angle) * radius, (i / petalCount) * 0.1, Math.sin(angle) * radius);
                _scratchEuler.set(0, 0, angle);
                _scratchQuat.setFromEuler(_scratchEuler);
                _scratchScale.set(0.1, 0.2, 0.1);

                _scratchMatrix2.compose(_scratchPos, _scratchQuat, _scratchScale);
                _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
                this.addInstance(this.petalsSpiral, _scratchMatrix, color, 'spiralCount');
            }
        } else if (type === 'layered') {
            for (let layer = 0; layer < 2; layer++) {
                const petalCount = 5;
                // Layer Color Logic
                let layerColor = color;
                if (layer !== 0) {
                    color.getHSL(_scratchHsl);
                    _scratchColor.setHSL(_scratchHsl.h, _scratchHsl.s, _scratchHsl.l + 0.1); // Slightly lighter
                    layerColor = _scratchColor;
                }

                for (let i = 0; i < petalCount; i++) {
                    const angle = (i / petalCount) * Math.PI * 2 + (layer * Math.PI / petalCount);
                    const r = 0.15 + layer * 0.05;

                    _scratchPos.set(Math.cos(angle) * r, layer * 0.05, Math.sin(angle) * r);
                    _scratchEuler.set(0, 0, Math.PI / 4);
                    _scratchQuat.setFromEuler(_scratchEuler);
                    _scratchScale.set(1, 1, 1);

                    _scratchMatrix2.compose(_scratchPos, _scratchQuat, _scratchScale);
                    _scratchMatrix.multiplyMatrices(_scratchMatrix3, _scratchMatrix2);
                    this.addInstance(this.petalsSimple, _scratchMatrix, layerColor, 'simpleCount');
                }
            }
        }
    }

    private addInstance(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: THREE.Color | null, countProp: string) {
        let index = 0;
        let max = 0;

        switch (countProp) {
            case 'stemCount': index = this.stemCount; max = MAX_FLOWERS; break;
            case 'centerCount': index = this.centerCount; max = MAX_FLOWERS; break;
            case 'stamenCount': index = this.stamenCount; max = MAX_FLOWERS * 3; break;
            case 'simpleCount': index = this.simpleCount; max = MAX_PETALS; break;
            case 'multiCount': index = this.multiCount; max = MAX_PETALS; break;
            case 'spiralCount': index = this.spiralCount; max = MAX_PETALS; break;
        }

        if (index >= max) return;

        mesh.setMatrixAt(index, matrix);
        if (color && mesh.instanceColor) {
            mesh.setColorAt(index, color);
        }

        // Update count
        switch (countProp) {
            case 'stemCount': this.stemCount++; mesh.count = this.stemCount; break;
            case 'centerCount': this.centerCount++; mesh.count = this.centerCount; break;
            case 'stamenCount': this.stamenCount++; mesh.count = this.stamenCount; break;
            case 'simpleCount': this.simpleCount++; mesh.count = this.simpleCount; break;
            case 'multiCount': this.multiCount++; mesh.count = this.multiCount; break;
            case 'spiralCount': this.spiralCount++; mesh.count = this.spiralCount; break;
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
}

export const flowerBatcher = FlowerBatcher.getInstance();

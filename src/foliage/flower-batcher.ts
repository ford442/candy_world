import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageGroup } from '../world/state.ts';
import {
    foliageMaterials,
    sharedGeometries,
    calculateFlowerBloom,
    calculateWindSway,
    applyPlayerInteraction
} from './index.ts';
import { attachReactivity } from './foliage-reactivity.ts';
import { CandyPresets, uAudioHigh, uTime, createJuicyRimLight, getCachedProceduralMaterial, createStandardNodeMaterial } from './material-core.ts';
import { CONFIG } from '../core/config.ts';
import { attribute, positionLocal, mix, color, float, sin } from 'three/tsl';
import { PlantPoseMachine } from './plant-pose-machine.ts';

const MAX_FLOWERS = 1000; // Reduced from 5000 for WebGPU uniform buffer limits
const MAX_PETALS = MAX_FLOWERS * 8; // Up to 8 petals per flower (reduced from 15 for WebGPU limits)

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

    private _poseMachine: PlantPoseMachine;

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

        this._poseMachine = new PlantPoseMachine(MAX_PETALS, 'flower');

        // --- Common TSL Logic ---
        // Apply Bloom -> Wind -> Player Interaction
        const posBloom = calculateFlowerBloom(positionLocal);
        const posWind = posBloom.add(calculateWindSway(posBloom));
        const posFinal = applyPlayerInteraction(posWind);

        // --- 1. Stems (Cylinder) ---
        const stemMat = getCachedProceduralMaterial('flower_batch_stem', 0xFFFFFF, () => {
            return (foliageMaterials.flowerStem as THREE.Material).clone();
        });

        const stemGeo = sharedGeometries.unitCylinder.clone();
        this.stems = new THREE.InstancedMesh(stemGeo, stemMat, MAX_FLOWERS);
        this.stems.castShadow = true;
        this.stems.receiveShadow = true;
        this.stems.frustumCulled = false;
        this.stems.count = 0;
        // Provide aPoseState so TSL attribute('aPoseState') resolves during warmup and runtime
        this.stems.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS), 1));
        foliageGroup.add(this.stems);

        // --- 2. Centers (Sphere) ---
        const centerMat = getCachedProceduralMaterial('flower_batch_center', 0xFFFFFF, () => {
            const mat = (foliageMaterials.flowerCenter as THREE.Material).clone();
            (mat as any).positionNode = posFinal; // Apply full deformation chain
            return mat;
        });

        const centerGeo = sharedGeometries.unitSphere.clone();
        this.centers = new THREE.InstancedMesh(centerGeo, centerMat, MAX_FLOWERS);
        this.centers.castShadow = true;
        this.centers.receiveShadow = true;
        this.centers.frustumCulled = false;
        this.centers.count = 0;
        this.centers.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS), 1));
        foliageGroup.add(this.centers);

        // --- 3. Stamens (Cylinder) ---
        const stamenMat = getCachedProceduralMaterial('flower_batch_stamen', 0xFFFF00, () => {
            return CandyPresets.Clay(0xFFFF00, { deformationNode: posFinal });
        });

        const stamenGeo = sharedGeometries.unitCylinder.clone();
        this.stamens = new THREE.InstancedMesh(stamenGeo, stamenMat, MAX_FLOWERS * 3);
        this.stamens.castShadow = true;
        this.stamens.receiveShadow = true;
        this.stamens.frustumCulled = false;
        this.stamens.count = 0;
        this.stamens.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 3), 1));
        foliageGroup.add(this.stamens);

        // --- 4. Petals (Shared Material) ---
        // Use Velvet preset for petals, supporting instanceColor
        const instanceColor = attribute('instanceColor', 'vec3');

        const petalMat = getCachedProceduralMaterial('flower_batch_petal', 0xFFFFFF, () => {
            // --- PALETTE: Petal Breathing Animation ---
            // Add subtle procedural life to petals, slightly offsetting based on local coordinates
            const phaseOffset = positionLocal.x.add(positionLocal.y).add(positionLocal.z).mul(5.0);
            const petalBreath = sin(uTime.mul(2.0).add(phaseOffset)).mul(0.05).add(1.0);
            const petalDeformation = posFinal.mul(petalBreath);

            const mat = CandyPresets.Velvet(0xFFFFFF, {
                colorNode: instanceColor, // Use instance color
                deformationNode: petalDeformation, // Apply deformation with breathing
                side: THREE.DoubleSide,
                audioReactStrength: 1.0,
                rimStrength: 0.5
            });

        // Add Audio-Reactive Rim Light to petals
        // 🎨 PALETTE: Boosted Rim Light for more pop in twilight
        const audioRim = createJuicyRimLight(instanceColor, float(2.0).add(uAudioHigh.mul(4.0)), float(2.0), null);

            // --- PALETTE: Audio Reactive Inner Glow ---
            // Give petals a deep soft glow when the melody hits (increased intensity)
            const innerGlow = instanceColor.mul(uAudioHigh).mul(1.2);

            mat.emissiveNode = audioRim.add(innerGlow);

            return mat;
        });

        // Simple Petals (Icosahedron)
        let simpleGeo = new THREE.IcosahedronGeometry(0.15, 0);
        simpleGeo = mergeVertices(simpleGeo);
        simpleGeo.scale(1, 0.5, 1);

        this.petalsSimple = new THREE.InstancedMesh(simpleGeo, petalMat, MAX_PETALS);
        this.petalsSimple.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsSimple.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS).fill(0), 1));
        this.petalsSimple.castShadow = true;
        this.petalsSimple.receiveShadow = true;
        this.petalsSimple.frustumCulled = false;
        this.petalsSimple.count = 0;
        this.petalsSimple.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1));
        foliageGroup.add(this.petalsSimple);

        // Multi Petals (Sphere)
        const multiGeo = sharedGeometries.unitSphere.clone();
        this.petalsMulti = new THREE.InstancedMesh(multiGeo, petalMat, MAX_PETALS);
        this.petalsMulti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsMulti.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS).fill(0), 1));
        this.petalsMulti.castShadow = true;
        this.petalsMulti.receiveShadow = true;
        this.petalsMulti.frustumCulled = false;
        this.petalsMulti.count = 0;
        this.petalsMulti.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1));
        foliageGroup.add(this.petalsMulti);

        // Spiral Petals (Cone)
        const spiralGeo = sharedGeometries.unitCone.clone();
        this.petalsSpiral = new THREE.InstancedMesh(spiralGeo, petalMat, MAX_PETALS);
        this.petalsSpiral.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS * 3), 3);
        this.petalsSpiral.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS).fill(0), 1));
        this.petalsSpiral.castShadow = true;
        this.petalsSpiral.receiveShadow = true;
        this.petalsSpiral.frustumCulled = false;
        this.petalsSpiral.count = 0;
        this.petalsSpiral.geometry.setAttribute('aPoseState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PETALS), 1));
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

        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        matrix.toArray(mesh.instanceMatrix.array, (index) * 16);
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

    update(time: number, deltaTime: number, audioState: any, dayNightBias: number) {
        if (!this.initialized || !this._poseMachine) return;
        
        const config = CONFIG.plantPose.flower;
        if (!config) return;

        const kick = audioState?.kick || 0;
        
        // Step the state machine
        this._poseMachine.update(MAX_PETALS, deltaTime, kick, dayNightBias, config);

        // Update aPoseState for all active instances across all meshes
        const meshes = [this.stems, this.centers, this.stamens, this.petalsSimple, this.petalsMulti, this.petalsSpiral];
        for (const mesh of meshes) {
            if (!mesh || mesh.count === 0) continue;
            const attr = mesh.geometry.attributes.aPoseState as THREE.InstancedBufferAttribute;
            if (!attr) continue;
            
            for (let i = 0; i < mesh.count; i++) {
                // _poseMachine covers up to MAX_PETALS, which is MAX_FLOWERS * 8
                // Ensure we don't read out of bounds. Stamens can have up to MAX_FLOWERS * 3 instances.
                // Stems and Centers have up to MAX_FLOWERS instances.
                attr.setX(i, this._poseMachine.getPose(i));
            }
            attr.needsUpdate = true;
        }
    }
}

export const flowerBatcher = FlowerBatcher.getInstance();

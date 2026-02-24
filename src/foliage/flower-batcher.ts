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
    createStandardNodeMaterial
} from './common.ts';
import { attribute, positionLocal, mix, color } from 'three/tsl';

const MAX_FLOWERS = 5000;
const MAX_PETALS = MAX_FLOWERS * 15; // Up to 15 petals per flower

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
        const petalMat = CandyPresets.Velvet(0xFFFFFF, {
            colorNode: instanceColor, // Use instance color
            deformationNode: posFinal, // Apply deformation
            side: THREE.DoubleSide,
            audioReactStrength: 1.0,
            rimStrength: 0.5
        });

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

        // Ensure world matrix is up to date
        group.updateMatrixWorld(true);
        const rootMatrix = group.matrixWorld;

        // Parse options
        const colorHex = options.color !== undefined ? options.color : null;
        let color = new THREE.Color(0xFF69B4); // Default pink
        if (colorHex !== null) {
            if (colorHex.isColor) color = colorHex;
            else color.set(colorHex);
        }

        // --- Logic mirroring createFlower ---
        // 1. Stem
        const stemHeight = 0.6 + Math.random() * 0.4;
        const stemScale = new THREE.Vector3(0.05, stemHeight, 0.05);
        const stemMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(0, 0, 0), // Local pos 0 (pivot is bottom)
            new THREE.Quaternion(),
            stemScale
        );
        // Transform to world
        const finalStemMatrix = rootMatrix.clone().multiply(stemMatrix);
        this.addInstance(this.stems, finalStemMatrix, null, 'stemCount');

        // 2. Head Setup
        // Head pivot is at (0, stemHeight, 0)
        // We construct a head root matrix in world space
        const headLocal = new THREE.Matrix4().makeTranslation(0, stemHeight, 0);
        const headMatrix = rootMatrix.clone().multiply(headLocal);

        // 3. Center
        const centerScale = new THREE.Vector3(0.1, 0.1, 0.1);
        const centerLocal = new THREE.Matrix4().makeScale(0.1, 0.1, 0.1);
        const finalCenterMatrix = headMatrix.clone().multiply(centerLocal);
        this.addInstance(this.centers, finalCenterMatrix, null, 'centerCount');

        // 4. Stamens
        const stamenCount = 3;
        for (let i = 0; i < stamenCount; i++) {
            const rz = (Math.random() - 0.5) * 1.0;
            const rx = (Math.random() - 0.5) * 1.0;

            // Compose: Translate(0, 0.075, 0) * Rotate * Scale
            // Note: Original code logic was Head * Local.
            // Local: Translate(0, 0.075, 0) * Rotation * Scale(0.01, 0.15, 0.01)

            const stamenLocal = new THREE.Matrix4().compose(
                new THREE.Vector3(0, 0.075, 0),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
                new THREE.Vector3(0.01, 0.15, 0.01)
            );

            const final = headMatrix.clone().multiply(stamenLocal);
            this.addInstance(this.stamens, final, null, 'stamenCount');
        }

        // 5. Petals
        if (type === 'simple') {
            const petalCount = 5 + Math.floor(Math.random() * 2);
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2;
                const m = new THREE.Matrix4();
                m.makeRotationZ(Math.PI / 4);
                m.setPosition(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);

                const final = headMatrix.clone().multiply(m);
                this.addInstance(this.petalsSimple, final, color, 'simpleCount');
            }
        } else if (type === 'multi') {
            const petalCount = 8 + Math.floor(Math.random() * 4);
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2;
                const pos = new THREE.Vector3(
                    Math.cos(angle) * 0.2,
                    Math.sin(i * 0.5) * 0.1,
                    Math.sin(angle) * 0.2
                );
                const t = new THREE.Matrix4().setPosition(pos);
                const s = new THREE.Matrix4().makeScale(0.12, 0.12, 0.12);
                const m = t.multiply(s);

                const final = headMatrix.clone().multiply(m);
                this.addInstance(this.petalsMulti, final, color, 'multiCount');
            }
        } else if (type === 'spiral') {
            const petalCount = 10;
            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 4;
                const radius = 0.05 + (i / petalCount) * 0.15;
                const m = new THREE.Matrix4().compose(
                    new THREE.Vector3(Math.cos(angle) * radius, (i / petalCount) * 0.1, Math.sin(angle) * radius),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle)),
                    new THREE.Vector3(0.1, 0.2, 0.1)
                );
                const final = headMatrix.clone().multiply(m);
                this.addInstance(this.petalsSpiral, final, color, 'spiralCount');
            }
        } else if (type === 'layered') {
            for (let layer = 0; layer < 2; layer++) {
                const petalCount = 5;
                // Layer Color Logic
                let layerColor = color;
                if (layer !== 0) {
                    const hsl = { h: 0, s: 0, l: 0 };
                    color.getHSL(hsl);
                    layerColor = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l + 0.1); // Slightly lighter
                }

                for (let i = 0; i < petalCount; i++) {
                    const angle = (i / petalCount) * Math.PI * 2 + (layer * Math.PI / petalCount);
                    const r = 0.15 + layer * 0.05;
                    const m = new THREE.Matrix4().compose(
                        new THREE.Vector3(Math.cos(angle) * r, layer * 0.05, Math.sin(angle) * r),
                        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 4)),
                        new THREE.Vector3(1, 1, 1)
                    );
                    const final = headMatrix.clone().multiply(m);
                    this.addInstance(this.petalsSimple, final, layerColor, 'simpleCount');
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

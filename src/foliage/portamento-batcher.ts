import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createClayMaterial,
    createCandyMaterial,
    registerReactiveMaterial
} from './common.ts';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv, attribute, varying, normalize
} from 'three/tsl';
import { uTime } from './common.ts';

const MAX_PINES = 1000;

export class PortamentoPineBatcher {
    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicPines = []; // Logic objects

        this.mesh = null;
        this.bendAttribute = null; // Instance attribute for bending strength

        this.dummy = new THREE.Object3D();
        this._color = new THREE.Color();
    }

    init() {
        if (this.initialized) return;

        // 1. Create Merged Geometry
        const geometry = this.createPineGeometry();

        // 2. Materials (Array: [Trunk, Needles])
        const trunkMat = createClayMaterial(0x8B4513); // Copper
        const needleMat = createCandyMaterial(0x2E8B57, 0.5); // Green

        registerReactiveMaterial(trunkMat);
        registerReactiveMaterial(needleMat);

        // 3. Instance Attributes
        // "instanceBend": float (Strength of bend)
        // "instanceBendDir": vec2? (Direction X/Z) - For now let's just bend in X to keep it simple, or rotate the instance.
        // Actually, rotating the instance rotates the bend direction too! So we just need magnitude.

        this.bendAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINES), 1);
        geometry.setAttribute('instanceBend', this.bendAttribute);

        // 4. TSL Logic (Bending)
        const applyBend = (material) => {
            const pos = positionLocal;
            const instanceBend = attribute('instanceBend', 'float');

            // Height Factor: 0 at bottom, 1 at top (Height is approx 4.0)
            const height = float(4.0);
            const yNorm = pos.y.div(height).clamp(0.0, 1.0);

            // Quadratic bend
            const bendAmount = yNorm.pow(2.0).mul(instanceBend);

            // Apply displacement (Bend along local X axis)
            // Since we can rotate the instance, local X becomes whatever world direction we want.
            const newPos = vec3(
                pos.x.add(bendAmount),
                pos.y,
                pos.z
            );

            material.positionNode = newPos;
        };

        applyBend(trunkMat);
        applyBend(needleMat);

        // 5. Create InstancedMesh
        this.mesh = new THREE.InstancedMesh(geometry, [trunkMat, needleMat], MAX_PINES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        foliageGroup.add(this.mesh);

        this.initialized = true;
        console.log('[PortamentoPineBatcher] Initialized');
    }

    createPineGeometry() {
        // We manually merge geometries to avoid external deps
        const height = 4.0;
        const trunkGeo = new THREE.CylinderGeometry(0.1, 0.4, height, 8);
        trunkGeo.translate(0, height / 2, 0);

        // Arrays to hold merged data
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        const groups = []; // { start, count, materialIndex }

        let vertexOffset = 0;

        // Helper to merge
        const merge = (geo, matIndex, transformMatrix) => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;

            // Apply transform if provided
            if (transformMatrix) {
                geo.applyMatrix4(transformMatrix);
            }

            // Append Vertices
            for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            }

            // Append Indices
            const start = indices.length;
            for (let i = 0; i < indexAttr.count; i++) {
                indices.push(indexAttr.getX(i) + vertexOffset);
            }
            const count = indices.length - start;

            // Add Group
            // If the last group has same material, extend it? No, simpler to just add new group
            // But we should try to keep groups contiguous per material for performance.
            // However, implementing sort is complex here.
            // We'll merge Trunk first (Group 0), then Needles (Group 1).

            vertexOffset += posAttr.count;
        };

        // 1. Trunk (Material 0)
        merge(trunkGeo, 0);
        groups.push({ start: 0, count: indices.length, materialIndex: 0 });

        // 2. Needles (Material 1)
        const needlesStartIndex = indices.length;

        const segments = 6;
        const segHeight = height / segments;
        const needleGeoTemplate = new THREE.ConeGeometry(0.1, 0.6, 4);

        const tempObj = new THREE.Object3D();
        const tempGeo = needleGeoTemplate.clone(); // Reusable container

        for (let i = 2; i < segments; i++) { // Start from segment 2
            const y = (i * segHeight) + (segHeight * 0.5);
            const radiusAtHeight = 0.4 * (1 - i/segments) + 0.1;

            const count = 8;
            for (let n = 0; n < count; n++) {
                tempObj.position.set(0, 0, 0);
                tempObj.rotation.set(0, 0, 0);
                tempObj.scale.set(1,1,1);

                // Setup transformation
                const angle = (n / count) * Math.PI * 2;
                tempObj.position.y = y;

                // Position on ring
                tempObj.position.x = Math.cos(angle) * radiusAtHeight;
                tempObj.position.z = Math.sin(angle) * radiusAtHeight;

                // Rotation: Point outward and slightly up
                tempObj.rotation.y = -angle; // Face outward?
                // Cone points up by default.
                // Rotate Z to point out?
                // Cone top is at +Y.
                // We want tip to point Out.
                // Rotate Z -90 (point X+). Then Rotate Y to angle.
                tempObj.rotation.z = -Math.PI / 2 - 0.2; // Point out and slightly up
                tempObj.rotation.y = angle;

                tempObj.updateMatrix();

                // Clone geometry to apply matrix (safest way without writing custom transform loop)
                const g = needleGeoTemplate.clone();
                g.applyMatrix4(tempObj.matrix);

                // Merge raw arrays
                const pos = g.attributes.position;
                const norm = g.attributes.normal;
                const uv = g.attributes.uv;
                const idx = g.index;

                 for (let k = 0; k < pos.count; k++) {
                    positions.push(pos.getX(k), pos.getY(k), pos.getZ(k));
                    normals.push(norm.getX(k), norm.getY(k), norm.getZ(k));
                    uvs.push(uv.getX(k), uv.getY(k));
                }
                for (let k = 0; k < idx.count; k++) {
                    indices.push(idx.getX(k) + vertexOffset);
                }
                vertexOffset += pos.count;
            }
        }

        groups.push({ start: needlesStartIndex, count: indices.length - needlesStartIndex, materialIndex: 1 });

        // Construct Final Geometry
        const finalGeo = new THREE.BufferGeometry();
        finalGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        finalGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        finalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        finalGeo.setIndex(indices);

        groups.forEach(g => finalGeo.addGroup(g.start, g.count, g.materialIndex));

        return finalGeo;
    }

    register(dummy, options = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_PINES) return;

        const i = this.count;
        this.count++;

        dummy.userData.batchIndex = i;
        this.logicPines.push(dummy);

        // Apply Transform
        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.mesh.setMatrixAt(i, this.dummy.matrix);

        // Init Bend
        this.bendAttribute.setX(i, 0); // Start straight

        this.mesh.instanceMatrix.needsUpdate = true;
        this.bendAttribute.needsUpdate = true;
    }

    updateInstance(index, dummy) {
        if (!this.initialized) return;

        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.copy(dummy.scale);
        this.dummy.updateMatrix();

        this.mesh.setMatrixAt(index, this.dummy.matrix);
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    update(time, audioData) {
        if (!this.initialized || this.count === 0) return;

        let needsUpdate = false;

        // Animate bending based on audio logic or internal springs
        // Since we don't have per-object update loop in the manager efficiently,
        // we can iterate active pines here.

        for (let i = 0; i < this.count; i++) {
            const logic = this.logicPines[i];

            // Logic state updates (e.g. spring physics)
            if (logic.userData.reactivityState) {
                const state = logic.userData.reactivityState;

                // Spring Physics
                const k = 10.0;
                const damp = 0.92;
                const force = -k * state.currentBend;
                state.velocity += force * 0.016; // Approx delta
                state.velocity *= damp;
                state.currentBend += state.velocity * 0.016;

                // Apply to Attribute
                if (Math.abs(state.currentBend) > 0.001) {
                    this.bendAttribute.setX(i, state.currentBend);
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            this.bendAttribute.needsUpdate = true;
        }
    }
}

export const portamentoPineBatcher = new PortamentoPineBatcher();

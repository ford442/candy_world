import * as THREE from 'three';
import { safeRemoveAndDispose } from '../../utils/dispose-utils.ts';
import { getGroundAlignedQuaternion } from '../../world/placement-utils.ts';
import { foliageGroup } from '../../world/state.ts';
import { ANIMATION_TYPES } from '../animation-nodes.ts';
import { copyInstanceLodOnGrow, initInstanceLodAttribute } from '../batcher-lod-utils.ts';
import { refreshFoliageLodMesh } from '../../systems/batcher-lod.ts';
import { batchComposeMatrices_c } from '../../utils/wasm-batch.ts';
import { isEmscriptenReady } from '../../utils/wasm-loader-core.ts';
import {
    BATCH_QUEUE_LIMIT,
    MAX_INSTANCES,
    PendingInstance,
    _batchOutputMatrices,
    _batchPositions,
    _batchQuaternions,
    _batchScales,
    _defaultColorGreen,
    _defaultColorOrange,
    _defaultColorWhite,
    _scratchPosition,
    _scratchScale,
    _scratchTreeFinalQuaternion,
    _scratchTreeMatrix,
    _scratchTreeOriginalQuaternion,
} from './constants.ts';
import type { InstanceCountProp, TreeBatcherState } from './types.ts';

export function disposeInstancedMesh(mesh: THREE.InstancedMesh) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }

        // Ensure custom instance attributes are disposed if supported
        if (mesh.instanceColor && typeof (mesh.instanceColor as any).dispose === 'function') {
            try { (mesh.instanceColor as any).dispose(); } catch (e) {}
        }
    }

export function growTrunkBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.trunkCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.trunks;
        state.trunkCapacity = Math.min(state.trunkCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.trunkCapacity);
        
        // Copy existing matrix data
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.trunkCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        // Copy existing color data
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.trunkCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.trunkCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.trunkCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, state.trunkCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        // Replace in scene
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        state.trunks = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew trunk buffer to ${state.trunkCapacity}`);
    }

export function growSphereBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.sphereCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.spheres;
        state.sphereCapacity = Math.min(state.sphereCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.sphereCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.sphereCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.sphereCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.sphereCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.sphereCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, state.sphereCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        state.spheres = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew sphere buffer to ${state.sphereCapacity}`);
    }

export function growCapsuleBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.capsuleCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.capsules;
        state.capsuleCapacity = Math.min(state.capsuleCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.capsuleCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.capsuleCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.capsuleCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.capsuleCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.capsuleCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, state.capsuleCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        state.capsules = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew capsule buffer to ${state.capsuleCapacity}`);
    }

export function growHelixBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.helixCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.helices;
        state.helixCapacity = Math.min(state.helixCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.helixCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.helixCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.helixCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.helixCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.helixCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, state.helixCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        state.helices = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew helix buffer to ${state.helixCapacity}`);
    }

export function growRoseBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.roseCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.roses;
        state.roseCapacity = Math.min(state.roseCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.roseCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.roseCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.roseCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.roseCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.roseCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, state.roseCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        state.roses = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew rose buffer to ${state.roseCapacity}`);
    }

export function growAccordionLeafBuffer(state: TreeBatcherState) {
        flushRegistrations(state);
        if (state.accordionLeafCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = state.accordionLeaves;
        state.accordionLeafCapacity = Math.min(state.accordionLeafCapacity * 2, MAX_INSTANCES);

        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, state.accordionLeafCapacity);

        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(state.accordionLeafCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);

        if ((oldMesh as any).instanceColor) {
            const oldColorArray = (oldMesh as any).instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(state.accordionLeafCapacity * 3);
            newColorArray.set(oldColorArray);
            (newMesh as any).instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', (newMesh as any).instanceColor);
        }

        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(state.accordionLeafCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(state.accordionLeafCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        // Add LOD attributes
        initInstanceLodAttribute(newMesh, state.accordionLeafCapacity);
        copyInstanceLodOnGrow(oldMesh, newMesh, state.accordionLeafCapacity);

        newMesh.castShadow = true;
        newMesh.receiveShadow = true;

        // ⚡ OPTIMIZATION: Replaced manual removal and disposal with safeRemoveAndDispose to prevent VRAM leaks
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        state.accordionLeaves = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew accordion leaf buffer to ${state.accordionLeafCapacity}`);
    }

export function addInstance(state: TreeBatcherState, mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: THREE.Color, countProp: 'trunkCount' | 'sphereCount' | 'capsuleCount' | 'helixCount' | 'roseCount' | 'accordionLeafCount', animType: number = 0, animOffset: number = 0) {
        let index = 0;

        switch (countProp) {
            case 'trunkCount': index = state.trunkCount; break;
            case 'sphereCount': index = state.sphereCount; break;
            case 'capsuleCount': index = state.capsuleCount; break;
            case 'helixCount': index = state.helixCount; break;
            case 'roseCount': index = state.roseCount; break;
            case 'accordionLeafCount': index = state.accordionLeafCount; break;
        }

        // Check if we need to grow the buffer
        switch (countProp) {
            case 'trunkCount':
                if (index >= state.trunkCapacity) growTrunkBuffer(state);
                if (index >= state.trunkCapacity) return;
                mesh = state.trunks;
                break;
            case 'sphereCount':
                if (index >= state.sphereCapacity) growSphereBuffer(state);
                if (index >= state.sphereCapacity) return;
                mesh = state.spheres;
                break;
            case 'capsuleCount':
                if (index >= state.capsuleCapacity) growCapsuleBuffer(state);
                if (index >= state.capsuleCapacity) return;
                mesh = state.capsules;
                break;
            case 'helixCount':
                if (index >= state.helixCapacity) growHelixBuffer(state);
                if (index >= state.helixCapacity) return;
                mesh = state.helices;
                break;
            case 'roseCount':
                if (index >= state.roseCapacity) growRoseBuffer(state);
                if (index >= state.roseCapacity) return;
                mesh = state.roses;
                break;
            case 'accordionLeafCount':
                if (index >= state.accordionLeafCapacity) growAccordionLeafBuffer(state);
                if (index >= state.accordionLeafCapacity) return;
                mesh = state.accordionLeaves;
                break;
        }

        // ⚡ OPTIMIZATION: Queue TRS properties into SoA buffers for batch WASM processing
        if (state._pendingInstances.length >= BATCH_QUEUE_LIMIT) {
            flushRegistrations(state);
        }

        matrix.decompose(_scratchPosition, _scratchTreeFinalQuaternion, _scratchScale);
        const qIndex = state._pendingInstances.length;

        _batchPositions[qIndex * 3 + 0] = _scratchPosition.x;
        _batchPositions[qIndex * 3 + 1] = _scratchPosition.y;
        _batchPositions[qIndex * 3 + 2] = _scratchPosition.z;

        _batchQuaternions[qIndex * 4 + 0] = _scratchTreeFinalQuaternion.x;
        _batchQuaternions[qIndex * 4 + 1] = _scratchTreeFinalQuaternion.y;
        _batchQuaternions[qIndex * 4 + 2] = _scratchTreeFinalQuaternion.z;
        _batchQuaternions[qIndex * 4 + 3] = _scratchTreeFinalQuaternion.w;

        _batchScales[qIndex * 3 + 0] = _scratchScale.x;
        _batchScales[qIndex * 3 + 1] = _scratchScale.y;
        _batchScales[qIndex * 3 + 2] = _scratchScale.z;

        state._pendingInstances.push({
            mesh,
            index,
            color,
            animType,
            animOffset
        });

        // Update count
        switch (countProp) {
            case 'trunkCount': state.trunkCount++; mesh.count = state.trunkCount; break;
            case 'sphereCount': state.sphereCount++; mesh.count = state.sphereCount; break;
            case 'capsuleCount': state.capsuleCount++; mesh.count = state.capsuleCount; break;
            case 'helixCount': state.helixCount++; mesh.count = state.helixCount; break;
            case 'roseCount': state.roseCount++; mesh.count = state.roseCount; break;
            case 'accordionLeafCount': state.accordionLeafCount++; mesh.count = state.accordionLeafCount; break;
        }
    }

export function flushRegistrations(state: TreeBatcherState) {
        const queueSize = state._pendingInstances.length;
        if (queueSize === 0) return;

        if (isEmscriptenReady()) {
            batchComposeMatrices_c(
                _batchPositions,
                _batchQuaternions,
                _batchScales,
                _batchOutputMatrices,
                queueSize
            );

            // Re-apply to respective mesh buffers
            for (let i = 0; i < queueSize; i++) {
                const req = state._pendingInstances[i];
                const targetArray = req.mesh.instanceMatrix.array as Float32Array;
                const matrixOffset = req.index * 16;
                const outOffset = i * 16;

                // Copy 16 floats
                for (let j = 0; j < 16; j++) {
                    targetArray[matrixOffset + j] = _batchOutputMatrices[outOffset + j];
                }
            }
        } else {
            // TS Fallback
            for (let i = 0; i < queueSize; i++) {
                const req = state._pendingInstances[i];
                const targetArray = req.mesh.instanceMatrix.array as Float32Array;
                const mIdx = req.index * 16;
                const outOffset = i * 16;

                const qx = _batchQuaternions[i * 4 + 0];
                const qy = _batchQuaternions[i * 4 + 1];
                const qz = _batchQuaternions[i * 4 + 2];
                const qw = _batchQuaternions[i * 4 + 3];

                const sx = _batchScales[i * 3 + 0];
                const sy = _batchScales[i * 3 + 1];
                const sz = _batchScales[i * 3 + 2];

                const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
                const xx = qx * x2, xy = qx * y2, xz = qx * z2;
                const yy = qy * y2, yz = qy * z2, zz = qz * z2;
                const wx = qw * x2, wy = qw * y2, wz = qw * z2;

                targetArray[mIdx + 0] = (1 - (yy + zz)) * sx;
                targetArray[mIdx + 1] = (xy + wz) * sx;
                targetArray[mIdx + 2] = (xz - wy) * sx;
                targetArray[mIdx + 3] = 0;

                targetArray[mIdx + 4] = (xy - wz) * sy;
                targetArray[mIdx + 5] = (1 - (xx + zz)) * sy;
                targetArray[mIdx + 6] = (yz + wx) * sy;
                targetArray[mIdx + 7] = 0;

                targetArray[mIdx + 8] = (xz + wy) * sz;
                targetArray[mIdx + 9] = (yz - wx) * sz;
                targetArray[mIdx + 10] = (1 - (xx + yy)) * sz;
                targetArray[mIdx + 11] = 0;

                targetArray[mIdx + 12] = _batchPositions[i * 3 + 0];
                targetArray[mIdx + 13] = _batchPositions[i * 3 + 1];
                targetArray[mIdx + 14] = _batchPositions[i * 3 + 2];
                targetArray[mIdx + 15] = 1;
            }
        }

        // Write standard attributes efficiently
        const updatedMeshes = new Set<THREE.InstancedMesh>();
        for (let i = 0; i < queueSize; i++) {
            const req = state._pendingInstances[i];
            updatedMeshes.add(req.mesh);

            // Color hot path
            const colorArray = req.mesh.instanceColor!.array as Float32Array;
            const colorOffset = req.index * 3;
            colorArray[colorOffset] = req.color.r;
            colorArray[colorOffset + 1] = req.color.g;
            colorArray[colorOffset + 2] = req.color.b;

            // Animation hot path
            const typeAttr = req.mesh.geometry.attributes.instanceAnimType as THREE.InstancedBufferAttribute;
            const offsetAttr = req.mesh.geometry.attributes.instanceAnimOffset as THREE.InstancedBufferAttribute;
            if (typeAttr?.array) {
                (typeAttr.array as Float32Array)[req.index] = req.animType;
            }
            if (offsetAttr?.array) {
                (offsetAttr.array as Float32Array)[req.index] = req.animOffset;
            }
        }

        // Flag updates
        updatedMeshes.forEach(m => {
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            if (m.geometry.attributes.instanceAnimType) (m.geometry.attributes.instanceAnimType as THREE.InstancedBufferAttribute).needsUpdate = true;
            if (m.geometry.attributes.instanceAnimOffset) (m.geometry.attributes.instanceAnimOffset as THREE.InstancedBufferAttribute).needsUpdate = true;
        });

        state._pendingInstances.length = 0;
    }

export function registerBubbleWillow(state: TreeBatcherState, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                // ⚡ OPTIMIZATION: mesh.matrixWorld is already up to date since we rely on it being added
                // but since the mesh might not have updateWorldMatrix called, we use the pre-calculated approach but simplified
                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'CylinderGeometry') {
                     addInstance(state, state.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                     if (mesh) if (mesh) mesh.visible = false;
                } else if (mesh.geometry.type === 'CapsuleGeometry') {
                     addInstance(state, state.capsules, _scratchTreeMatrix, col, 'capsuleCount', animType, animOffset);
                     if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

export function registerBalloonBush(state: TreeBatcherState, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorOrange;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'SphereGeometry') {
                    addInstance(state, state.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

export function registerHelixPlant(state: TreeBatcherState, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorGreen;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'TubeGeometry') {
                    addInstance(state, state.helices, _scratchTreeMatrix, col, 'helixCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    addInstance(state, state.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

export function registerAccordionPalm(state: TreeBatcherState, group: THREE.Group, animType: number, animOffset: number) {
        // Group structure: trunkGroup -> pleats + headGroup -> leaves
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if (child.type === 'Group') {
                const trunkGroup = child as THREE.Group;
                for (let j = 0; j < trunkGroup.children.length; j++) {
                    const trunkChild = trunkGroup.children[j];
                    if ((trunkChild as THREE.Mesh).isMesh) {
                        const mesh = trunkChild as THREE.Mesh;
                        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                        const col = mat.color || _defaultColorOrange;
                        _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);
                        addInstance(state, state.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                    } else if (trunkChild.type === 'Group') {
                        const headGroup = trunkChild as THREE.Group;
                        for (let k = 0; k < headGroup.children.length; k++) {
                            const leafChild = headGroup.children[k];
                            if ((leafChild as THREE.Mesh).isMesh) {
                                const mesh = leafChild as THREE.Mesh;
                                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                                const col = mat.color || _defaultColorGreen;
                                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, headGroup.matrix);
                                _scratchTreeMatrix.multiply(mesh.matrix);
                                addInstance(state, state.accordionLeaves, _scratchTreeMatrix, col, 'accordionLeafCount', animType, animOffset);
                            }
                        }
                    }
                }
            }
        }
    }

export function registerFloweringTree(state: TreeBatcherState, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'CylinderGeometry') {
                    addInstance(state, state.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    addInstance(state, state.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                } else if (mesh.geometry.type === 'TorusKnotGeometry') {
                    addInstance(state, state.roses, _scratchTreeMatrix, col, 'roseCount', animType, animOffset);
                }
                if (mesh) if (mesh) mesh.visible = false;
            }
        }
    }

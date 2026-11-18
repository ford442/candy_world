import type * as THREE from 'three';
import {
    _defaultColorGreen,
    _defaultColorOrange,
    _defaultColorWhite,
    _scratchTreeMatrix,
} from './constants.ts';
import type { TreePart } from './types.ts';

/** Where the register* walks send each sub-mesh they find (TreeBatcher.addPart). */
export interface TreePartSink {
    addPart(
        logicId: number,
        part: TreePart,
        matrix: THREE.Matrix4,
        color: THREE.Color,
        animType: number,
        animOffset: number
    ): void;
}

export function registerBubbleWillow(sink: TreePartSink, group: THREE.Group, animType: number, animOffset: number) {
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
                     sink.addPart(group.id, 'trunks', _scratchTreeMatrix, col, animType, animOffset);
                     mesh.visible = false;
                } else if (mesh.geometry.type === 'CapsuleGeometry') {
                     sink.addPart(group.id, 'capsules', _scratchTreeMatrix, col, animType, animOffset);
                     mesh.visible = false;
                }
            }
        }
    }

export function registerBalloonBush(sink: TreePartSink, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorOrange;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'SphereGeometry') {
                    sink.addPart(group.id, 'spheres', _scratchTreeMatrix, col, animType, animOffset);
                    mesh.visible = false;
                }
            }
        }
    }

export function registerHelixPlant(sink: TreePartSink, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorGreen;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'TubeGeometry') {
                    sink.addPart(group.id, 'helices', _scratchTreeMatrix, col, animType, animOffset);
                    mesh.visible = false;
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    sink.addPart(group.id, 'spheres', _scratchTreeMatrix, col, animType, animOffset);
                    mesh.visible = false;
                }
            }
        }
    }

export function registerAccordionPalm(sink: TreePartSink, group: THREE.Group, animType: number, animOffset: number) {
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
                        sink.addPart(group.id, 'trunks', _scratchTreeMatrix, col, animType, animOffset);
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
                                sink.addPart(group.id, 'accordionLeaves', _scratchTreeMatrix, col, animType, animOffset);
                            }
                        }
                    }
                }
            }
        }
    }

export function registerFloweringTree(sink: TreePartSink, group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'CylinderGeometry') {
                    sink.addPart(group.id, 'trunks', _scratchTreeMatrix, col, animType, animOffset);
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    sink.addPart(group.id, 'spheres', _scratchTreeMatrix, col, animType, animOffset);
                } else if (mesh.geometry.type === 'TorusKnotGeometry') {
                    sink.addPart(group.id, 'roses', _scratchTreeMatrix, col, animType, animOffset);
                }
                mesh.visible = false;
            }
        }
    }

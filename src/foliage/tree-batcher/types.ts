import type * as THREE from 'three';

/** The six instanced meshes a tree is drawn from. */
export type TreePart = 'trunks' | 'spheres' | 'capsules' | 'helices' | 'roses' | 'accordionLeaves';

export const TREE_PARTS: readonly TreePart[] = [
    'trunks',
    'spheres',
    'capsules',
    'helices',
    'roses',
    'accordionLeaves',
];

/** What initializeTreeBatcherMeshes fills in: one mesh per part, each sized to its capacity. */
export interface TreeBatcherState {
    initialized: boolean;
    trunks: THREE.InstancedMesh;
    spheres: THREE.InstancedMesh;
    capsules: THREE.InstancedMesh;
    helices: THREE.InstancedMesh;
    roses: THREE.InstancedMesh;
    accordionLeaves: THREE.InstancedMesh;
    trunkCapacity: number;
    sphereCapacity: number;
    capsuleCapacity: number;
    helixCapacity: number;
    roseCapacity: number;
    accordionLeafCapacity: number;
}

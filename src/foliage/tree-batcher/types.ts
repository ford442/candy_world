import type * as THREE from 'three';
import type { PendingInstance } from './constants.ts';

export type InstanceCountProp =
    | 'trunkCount'
    | 'sphereCount'
    | 'capsuleCount'
    | 'helixCount'
    | 'roseCount'
    | 'accordionLeafCount';

/** Mutable batcher state shared across init / growth / registration modules. */
export interface TreeBatcherState {
    initialized: boolean;
    trunks: THREE.InstancedMesh;
    spheres: THREE.InstancedMesh;
    capsules: THREE.InstancedMesh;
    helices: THREE.InstancedMesh;
    roses: THREE.InstancedMesh;
    accordionLeaves: THREE.InstancedMesh;
    trunkCount: number;
    sphereCount: number;
    capsuleCount: number;
    helixCount: number;
    roseCount: number;
    accordionLeafCount: number;
    trunkCapacity: number;
    sphereCapacity: number;
    capsuleCapacity: number;
    helixCapacity: number;
    roseCapacity: number;
    accordionLeafCapacity: number;
    _pendingInstances: PendingInstance[];
}

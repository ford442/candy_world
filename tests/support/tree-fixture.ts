import * as THREE from 'three';

/** Height of the fixture's leaf ball above the tree origin. */
export const TEST_TREE_LEAF_Y = 2;

/**
 * Turn `obj` into the smallest group TreeBatcher.register('floweringTree')
 * reads: a trunk (CylinderGeometry) at the origin in `trunkHex`, and a leaf
 * ball (SphereGeometry) TEST_TREE_LEAF_Y above it in green.
 */
export function buildTestTree(obj: THREE.Object3D, trunkHex: number): THREE.Group {
    const group = obj as THREE.Group;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(),
        new THREE.MeshStandardMaterial({ color: trunkHex })
    );
    const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(),
        new THREE.MeshStandardMaterial({ color: 0x00ff00 })
    );
    leaves.position.y = TEST_TREE_LEAF_Y;
    leaves.updateMatrix();
    group.add(trunk, leaves);
    return group;
}

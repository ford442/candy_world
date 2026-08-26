const fs = require('fs');
const file = 'src/foliage/gem-fruit-batcher.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`    attachToTree(
        treeGroup: THREE.Object3D,
        options: { height?: number; gemCount?: number } = {}
    ): { placed: number; refs: BatcherInstanceRef[] } {
        treeGroup.updateWorldMatrix(true, true);`,
`    attachToTree(
        treeGroup: THREE.Object3D,
        options: { height?: number; gemCount?: number } = {}
    ): { placed: number; refs: BatcherInstanceRef[] } {
        // ⚡ OPTIMIZATION: Bypassed expensive treeGroup.updateWorldMatrix() recursion.
        // We compose the world matrix directly assuming the parent (if any) is the scene root or has an up-to-date matrix.
        treeGroup.matrixWorld.compose(treeGroup.position, treeGroup.quaternion, treeGroup.scale);
        if (treeGroup.parent) {
            treeGroup.matrixWorld.multiplyMatrices(treeGroup.parent.matrixWorld, treeGroup.matrixWorld);
        }`);

fs.writeFileSync(file, code);

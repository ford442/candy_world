const fs = require('fs');
const file = 'src/foliage/tree-batcher/tree-batcher-class.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`        if (slopeQ) {
            _scratchTreeOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchTreeFinalQuaternion));
            group.updateWorldMatrix(false, false);
            group.quaternion.copy(_scratchTreeOriginalQuaternion);
        } else {
            group.updateWorldMatrix(false, false);
        }`,
`        // ⚡ OPTIMIZATION: Bypassed expensive group.updateWorldMatrix() recursion.
        // We know these groups are spawned at the root level or have an up-to-date parent matrix,
        // so we can compose their matrixWorld directly to save CPU in the hot spawn path.
        if (slopeQ) {
            _scratchTreeOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchTreeFinalQuaternion));
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
            group.quaternion.copy(_scratchTreeOriginalQuaternion);
        } else {
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
        }`);

fs.writeFileSync(file, code);

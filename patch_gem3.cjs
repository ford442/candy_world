const fs = require('fs');
const file = 'src/foliage/gem-fruit-batcher.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`        for (let b = 0; b < branchCount && placed < targetGems; b++) {`,
`        const updatedMeshes = new Set<THREE.InstancedMesh>();
        for (let b = 0; b < branchCount && placed < targetGems; b++) {`);

code = code.replace(
`                const instanceIndex = this._registerInstance(gemType, this._scratchMatrix, drop + 0.2);
                if (instanceIndex >= 0) {
                    placed++;
                    refs.push({ batcher: 'gem_fruit', instanceIndex, gemType });
                }`,
`                const instanceIndex = this._registerInstance(gemType, this._scratchMatrix, drop + 0.2);
                if (instanceIndex >= 0) {
                    placed++;
                    refs.push({ batcher: 'gem_fruit', instanceIndex, gemType });
                    updatedMeshes.add(this.meshes[gemType]);
                }`);

code = code.replace(
`        return { placed, refs };`,
`        // ⚡ OPTIMIZATION: Hoisted buffer needsUpdate flags outside the registration loop to eliminate redundant WebGPU uploads
        updatedMeshes.forEach(mesh => {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.geometry.getAttribute('aPhase')) (mesh.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
            if (mesh.geometry.getAttribute('aArmLen')) (mesh.geometry.getAttribute('aArmLen') as THREE.InstancedBufferAttribute).needsUpdate = true;
        });

        return { placed, refs };`);

fs.writeFileSync(file, code);

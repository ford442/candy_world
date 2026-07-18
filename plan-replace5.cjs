const fs = require('fs');
const path = 'src/systems/batcher-lod.ts';
let code = fs.readFileSync(path, 'utf8');

// Define Map to store caches
const importTarget = `import { FoliageLodConfig, FoliageLodStats } from './foliage-lod-types.ts';`;
const importReplace = `import { FoliageLodConfig, FoliageLodStats } from './foliage-lod-types.ts';\n\nconst _impostorScaleCaches = new Map<THREE.InstancedMesh, Float32Array>();`;

if (code.includes(importTarget)) {
    code = code.replace(importTarget, importReplace);
}

const target1 = `                    // ⚡ OPTIMIZATION: Cache impostor scale to drop per-frame Math.sqrt
                    let size = cfg.impostorScaleMul;
                    if ((this as any)._impostorScaleCache && (this as any)._impostorScaleCache[i] !== undefined) {
                        size = (this as any)._impostorScaleCache[i];
                    } else {
                        const m00 = matrixArray[offset + 0], m01 = matrixArray[offset + 1], m02 = matrixArray[offset + 2];
                        const m10 = matrixArray[offset + 4], m11 = matrixArray[offset + 5], m12 = matrixArray[offset + 6];
                        const m20 = matrixArray[offset + 8], m21 = matrixArray[offset + 9], m22 = matrixArray[offset + 10];

                        const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                        const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                        const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                        const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);

                        const actualSize = Math.sqrt(maxScaleSq) * cfg.impostorScaleMul;
                        size = actualSize;

                        if (!(this as any)._impostorScaleCache) (this as any)._impostorScaleCache = new Float32Array(this.mesh.count);
                        (this as any)._impostorScaleCache[i] = actualSize;
                    }`;

const replace1 = `                    // ⚡ OPTIMIZATION: Cache impostor scale to drop per-frame Math.sqrt
                    let scaleCache = _impostorScaleCaches.get(mesh);
                    if (!scaleCache || scaleCache.length < mesh.instanceMatrix.count) {
                        scaleCache = new Float32Array(mesh.instanceMatrix.count);
                        scaleCache.fill(-1);
                        _impostorScaleCaches.set(mesh, scaleCache);
                    }

                    let size = cfg.impostorScaleMul;
                    if (scaleCache[i] >= 0) {
                        size = scaleCache[i];
                    } else {
                        const m00 = matrixArray[offset + 0], m01 = matrixArray[offset + 1], m02 = matrixArray[offset + 2];
                        const m10 = matrixArray[offset + 4], m11 = matrixArray[offset + 5], m12 = matrixArray[offset + 6];
                        const m20 = matrixArray[offset + 8], m21 = matrixArray[offset + 9], m22 = matrixArray[offset + 10];

                        const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                        const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                        const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                        const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);

                        size = Math.sqrt(maxScaleSq) * cfg.impostorScaleMul;
                        scaleCache[i] = size;
                    }`;

if (code.includes(target1)) {
    code = code.replace(target1, replace1);
    fs.writeFileSync(path, code);
    console.log('Replaced block in ' + path);
} else {
    console.log('Target block not found in ' + path);
}

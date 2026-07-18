const fs = require('fs');
const path = 'src/systems/batcher-lod.ts';
let code = fs.readFileSync(path, 'utf8');

const target1 = `                    const m00 = matrixArray[offset + 0], m01 = matrixArray[offset + 1], m02 = matrixArray[offset + 2];
                    const m10 = matrixArray[offset + 4], m11 = matrixArray[offset + 5], m12 = matrixArray[offset + 6];
                    const m20 = matrixArray[offset + 8], m21 = matrixArray[offset + 9], m22 = matrixArray[offset + 10];

                    const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                    const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                    const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                    const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);
                    const size = Math.sqrt(maxScaleSq) * cfg.impostorScaleMul;`;

const replace1 = `                    // ⚡ OPTIMIZATION: Cache impostor scale to drop per-frame Math.sqrt
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

if (code.includes(target1)) {
    code = code.replace(target1, replace1);
    fs.writeFileSync(path, code);
    console.log('Replaced block in ' + path);
} else {
    console.log('Target block not found in ' + path);
}

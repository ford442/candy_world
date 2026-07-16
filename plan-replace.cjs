const fs = require('fs');

const path = 'src/systems/batcher-lod.ts';
let code = fs.readFileSync(path, 'utf8');

const target1 = `                    const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                    const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                    const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                    const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);
                    const size = Math.sqrt(maxScaleSq) * cfg.impostorScaleMul;`;

const replace1 = `                    // ⚡ OPTIMIZATION: Cache impostor scale to drop per-frame Math.sqrt
                    let size = cfg.impostorScaleMul;
                    if (this._impostorScaleCache && this._impostorScaleCache[i] !== undefined) {
                        size = this._impostorScaleCache[i];
                    } else {
                        const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                        const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                        const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                        const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);

                        const actualSize = Math.sqrt(maxScaleSq) * cfg.impostorScaleMul;
                        size = actualSize;

                        if (!this._impostorScaleCache) this._impostorScaleCache = new Float32Array(this.mesh.count);
                        this._impostorScaleCache[i] = actualSize;
                    }`;

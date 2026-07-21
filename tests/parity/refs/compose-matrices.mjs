/**
 * Pure TS reference: compose TRS → column-major 4×4 instance matrices.
 * Faithful copy of the arpeggio-batcher / tree-batcher flushMatrices fallback
 * (and identical math to emscripten/lod_batch.cpp batchComposeMatrices_c).
 *
 * Allocation-free: writes into caller-provided `matrices` Float32Array.
 */

/**
 * @param {Float32Array} positions   [x,y,z,...] length count*3
 * @param {Float32Array} quaternions [x,y,z,w,...] length count*4
 * @param {Float32Array} scales      [sx,sy,sz,...] length count*3
 * @param {Float32Array} matrices    out [m0..m15,...] length count*16
 * @param {number} count
 */
export function composeMatricesTS(positions, quaternions, scales, matrices, count) {
  for (let i = 0; i < count; i++) {
    const qx = quaternions[i * 4 + 0];
    const qy = quaternions[i * 4 + 1];
    const qz = quaternions[i * 4 + 2];
    const qw = quaternions[i * 4 + 3];

    const sx = scales[i * 3 + 0];
    const sy = scales[i * 3 + 1];
    const sz = scales[i * 3 + 2];

    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    const mIdx = i * 16;
    matrices[mIdx + 0] = (1 - (yy + zz)) * sx;
    matrices[mIdx + 1] = (xy + wz) * sx;
    matrices[mIdx + 2] = (xz - wy) * sx;
    matrices[mIdx + 3] = 0;

    matrices[mIdx + 4] = (xy - wz) * sy;
    matrices[mIdx + 5] = (1 - (xx + zz)) * sy;
    matrices[mIdx + 6] = (yz + wx) * sy;
    matrices[mIdx + 7] = 0;

    matrices[mIdx + 8] = (xz + wy) * sz;
    matrices[mIdx + 9] = (yz - wx) * sz;
    matrices[mIdx + 10] = (1 - (xx + yy)) * sz;
    matrices[mIdx + 11] = 0;

    matrices[mIdx + 12] = positions[i * 3 + 0];
    matrices[mIdx + 13] = positions[i * 3 + 1];
    matrices[mIdx + 14] = positions[i * 3 + 2];
    matrices[mIdx + 15] = 1;
  }
}

/**
 * Pure TS reference: write instance RGB with uniform intensity scale.
 * Mirrors batcher instanceColor array writes (r,g,b per instance).
 *
 * @param {Float32Array} colorsIn  [r,g,b,...]
 * @param {Float32Array} colorsOut [r,g,b,...] (may be same buffer)
 * @param {number} count
 * @param {number} intensity
 */
export function writeInstanceColorsTS(colorsIn, colorsOut, count, intensity) {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    colorsOut[o] = colorsIn[o] * intensity;
    colorsOut[o + 1] = colorsIn[o + 1] * intensity;
    colorsOut[o + 2] = colorsIn[o + 2] * intensity;
  }
}

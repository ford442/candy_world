/**
 * Pure TS reference for combined pose → matrix + color (#1358).
 * Mirrors src/utils/wasm-batcher-instance.ts writeInstancePoseTS and
 * emscripten/batcher_instance.cpp batchWriteInstancePose_c.
 */

import { composeMatricesTS, writeInstanceColorsTS } from './compose-matrices.mjs';

/**
 * @param {Float32Array} positions
 * @param {Float32Array} quaternions
 * @param {Float32Array} scales
 * @param {Float32Array|null} colorsIn
 * @param {Float32Array} matricesOut
 * @param {Float32Array|null} colorsOut
 * @param {number} colorIntensity
 * @param {number} count
 */
export function writeInstancePoseTS(
  positions,
  quaternions,
  scales,
  colorsIn,
  matricesOut,
  colorsOut,
  colorIntensity,
  count
) {
  composeMatricesTS(positions, quaternions, scales, matricesOut, count);
  if (colorsIn && colorsOut) {
    writeInstanceColorsTS(colorsIn, colorsOut, count, colorIntensity);
  }
}

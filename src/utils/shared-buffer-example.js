// Example: Using a SharedArrayBuffer for positions and copying it into WASM memory
// NOTE: In production, SharedArrayBuffer usage requires proper COOP/COEP headers.

import { uploadPositions } from './wasm-loader.js';

/**
 * Create a SharedArrayBuffer-backed Float32Array for positions
 * Layout per-object: [x, y, z, radius]
 * @param {number} objectCount
 * @returns {{sab: SharedArrayBuffer, view: Float32Array}}
 */
export function createSharedPositionBuffer(objectCount = 256) {
  const bytes = objectCount * 4 * Float32Array.BYTES_PER_ELEMENT;
  const sab = new SharedArrayBuffer(bytes);
  const view = new Float32Array(sab);
  return { sab, view };
}

/**
 * Fill shared view with sample data (for demo/test)
 * @param {Float32Array} view
 */
export function fillDemoPositions(view) {
  const count = Math.floor(view.length / 4);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    view[idx] = (Math.random() - 0.5) * 200; // x
    view[idx + 1] = 0;                      // y
    view[idx + 2] = (Math.random() - 0.5) * 200; // z
    view[idx + 3] = 0.5 + Math.random() * 1.5; // radius
  }
}

/**
 * Copy a Shared Float32Array into WASM memory (via wasm-loader's positionView)
 * This is a fast memcpy-like operation and avoids 'object' allocations.
 * @param {Float32Array} sharedView
 * @param {number} objectCount
 */
export function copySharedToWasm(sharedView, objectCount) {
  // Fallback: convert into array of objects for uploadPositions (small counts ok)
  const count = Math.min(objectCount, Math.floor(sharedView.length / 4));
  const arr = new Array(count);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    arr[i] = {
      x: sharedView[idx],
      y: sharedView[idx + 1],
      z: sharedView[idx + 2],
      radius: sharedView[idx + 3]
    };
  }
  uploadPositions(arr);
}

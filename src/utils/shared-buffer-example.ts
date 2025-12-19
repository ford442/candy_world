import { createSharedPositionBuffer as createSharedPositionBufferJS, fillDemoPositions as fillDemoPositionsJS, copySharedToWasm as copySharedToWasmJS } from './shared-buffer-example.js';
import { copySharedPositions } from './wasm-loader.js';

export type SharedPosResult = { sab: SharedArrayBuffer; view: Float32Array };

export function createSharedPositionBuffer(objectCount = 256): SharedPosResult {
  return createSharedPositionBufferJS(objectCount);
}

export function fillDemoPositions(view: Float32Array) {
  return fillDemoPositionsJS(view);
}

/** Fast copy using the WASM loader's direct copy when available, fallback to JS copy */
export function copySharedToWasmFast(sharedView: Float32Array, objectCount: number) {
  if (typeof copySharedPositions === 'function') {
    copySharedPositions(sharedView, objectCount);
    return;
  }
  // Fallback to JS implementation
  return copySharedToWasmJS(sharedView, objectCount);
}

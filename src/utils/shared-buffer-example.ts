/**
 * @file shared-buffer-example.ts
 * @description Demo helpers for SharedArrayBuffer → WASM position upload.
 * NOTE: SharedArrayBuffer requires COOP/COEP headers (configured in vite.config.js).
 */

import { uploadPositions, copySharedPositions } from './wasm-loader.ts';

export type SharedPosResult = { sab: SharedArrayBuffer; view: Float32Array };

/** Layout per object: [x, y, z, radius] */
export function createSharedPositionBuffer(objectCount = 256): SharedPosResult {
    const bytes = objectCount * 4 * Float32Array.BYTES_PER_ELEMENT;
    const sab = new SharedArrayBuffer(bytes);
    const view = new Float32Array(sab);
    return { sab, view };
}

export function fillDemoPositions(view: Float32Array): void {
    const count = Math.floor(view.length / 4);
    for (let i = 0; i < count; i++) {
        const idx = i * 4;
        view[idx] = (Math.random() - 0.5) * 200;
        view[idx + 1] = 0;
        view[idx + 2] = (Math.random() - 0.5) * 200;
        view[idx + 3] = 0.5 + Math.random() * 1.5;
    }
}

export function copySharedToWasm(sharedView: Float32Array, objectCount: number): void {
    const count = Math.min(objectCount, Math.floor(sharedView.length / 4));
    const arr = new Array(count);
    for (let i = 0; i < count; i++) {
        const idx = i * 4;
        arr[i] = {
            x: sharedView[idx],
            y: sharedView[idx + 1],
            z: sharedView[idx + 2],
            radius: sharedView[idx + 3],
        };
    }
    uploadPositions(arr);
}

/** Prefer wasm-loader direct copy when available. */
export function copySharedToWasmFast(sharedView: Float32Array, objectCount: number): void {
    if (typeof copySharedPositions === 'function') {
        copySharedPositions(sharedView, objectCount);
        return;
    }
    copySharedToWasm(sharedView, objectCount);
}

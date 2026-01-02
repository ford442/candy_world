// src/systems/adapters/WasmParticleSystem.js
import { isWasmReady, getWasmInstance } from '../../utils/wasm-loader.js';
import { LegacyParticleSystem } from './LegacyParticleSystem.js';

export class WasmParticleSystem extends LegacyParticleSystem {
    constructor() {
        super();
        this.wasmUpdateRainBatch = null;
        this.wasmUpdateMistBatch = null;
    }

    // Override update to use WASM
    update(time, bassIntensity, melodyVol, weatherState, weatherType, intensity) {
        if (!isWasmReady()) {
            super.update(time, bassIntensity, melodyVol, weatherState, weatherType, intensity);
            return;
        }

        const instance = getWasmInstance();
        if (!this.wasmUpdateRainBatch && instance.exports.updateRainBatch) {
            this.wasmUpdateRainBatch = instance.exports.updateRainBatch;
            this.wasmUpdateMistBatch = instance.exports.updateMelodicMistBatch;
        }

        if (this.wasmUpdateRainBatch) {
            this.updateRainWasm(instance, time, bassIntensity, weatherState, weatherType, intensity);
        } else {
            super.updatePercussionRain(time, bassIntensity, weatherState, weatherType, intensity);
        }

        if (this.wasmUpdateMistBatch) {
            this.updateMistWasm(instance, time, melodyVol, weatherState, weatherType);
        } else {
            super.updateMelodicMist(time, melodyVol, weatherState, weatherType);
        }
    }

    updateRainWasm(instance, time, bassIntensity, weatherState, weatherType, intensity) {
        if (!this.percussionRain) return;

        const shouldShow = bassIntensity > 0.2 || weatherState !== 'clear';
        this.percussionRain.visible = shouldShow;

        if (!shouldShow) return;

        // Visual updates still in JS
        this.percussionRain.material.size = 0.3 + bassIntensity * 0.5;
        this.percussionRain.material.opacity = 0.4 + intensity * 0.6;

        if (weatherType === 'mist') {
            this.percussionRain.material.color.setHex(0xE0F4FF);
        } else if (weatherType === 'drizzle') {
            this.percussionRain.material.color.setHex(0x9AB5C8);
        } else if (weatherType === 'thunderstorm' || weatherState === 'storm') {
            this.percussionRain.material.color.setHex(0x6090B0);
        } else {
            this.percussionRain.material.color.setHex(0x88CCFF);
        }

        // WASM Math
        const positionAttr = this.percussionRain.geometry.attributes.position;
        const velocities = this.percussionRain.geometry.userData.velocities;
        const offsets = this.percussionRain.geometry.userData.offsets;
        const count = positionAttr.count;

        // Ensure we have access to the underlying memory of the TypedArrays
        // If these arrays are not views into WASM memory, we must pin them or copy.
        // For this step, we will use the __pin utility if available or just assume standard arrays and let AS loader handle it?
        // Actually, the ASC loader bindings usually expect us to use `__newArray` or `__retain`.
        // BUT, `updateRainBatch` takes `usize` pointers.
        // We need to pass the memory address.
        // If the arrays are in JS memory, we can't just pass a pointer.
        // We need to copy them to WASM memory, run update, copy back.
        // To avoid per-frame allocation, we should use `wasm-loader.js` scratch memory (positionView etc) OR allocate once.

        // To do this efficiently without re-architecting the entire memory management:
        // 1. We allocate space in WASM memory for these particles ONCE during init (or first update).
        // 2. We keep the JS TypedArray as a view into that WASM memory.

        // However, `THREE.BufferAttribute` expects a TypedArray.
        // If we create a Float32Array on the WASM buffer, Three.js can use it.
        // BUT, WASM memory can grow/detach.

        // Safe Approach for "Tier 3" migration (proven hot loop):
        // Copy-in -> Compute -> Copy-out is safer than detached buffer risks unless we use SharedMemory.
        // For 500 particles, copy is cheap.

        // Let's use `wasm-loader.js` `positionView` (1024 floats) if it fits.
        // 500 particles * 3 floats = 1500 floats. Too big for `positionView` (1024).

        // We need to allocate a buffer in WASM.
        if (!this.rainPtr) {
            // Allocate 3 buffers: Pos (3*count), Vel (1*count), Offsets (1*count)
            // Total floats = 5 * count. 5 * 500 = 2500 floats = 10KB.
            const sizeBytes = count * 5 * 4;
            this.rainPtr = instance.exports.__new(sizeBytes, 0); // 0 = classId info?
            // Layout: [Pos(3N) | Vel(N) | Off(N)]
            this.rainPosPtr = this.rainPtr;
            this.rainVelPtr = this.rainPtr + (count * 3 * 4);
            this.rainOffPtr = this.rainPtr + (count * 4 * 4);

            // Copy initial data
            const wasmF32 = new Float32Array(instance.exports.memory.buffer);
            const posOffset = this.rainPosPtr / 4;
            const velOffset = this.rainVelPtr / 4;
            const offOffset = this.rainOffPtr / 4;

            wasmF32.set(positionAttr.array, posOffset);
            wasmF32.set(velocities, velOffset);
            wasmF32.set(offsets, offOffset);

            this.rainCount = count;
        }

        // Call WASM
        this.wasmUpdateRainBatch(
            this.rainPosPtr,
            this.rainVelPtr,
            this.rainOffPtr,
            count,
            time,
            bassIntensity
        );

        // Copy back positions
        // Note: We only need to copy back if the WASM memory hasn't grown (invalidating the view).
        // Always reconstruct view to be safe.
        const wasmF32 = new Float32Array(instance.exports.memory.buffer);
        const posOffset = this.rainPosPtr / 4;

        // This copy is the overhead.
        positionAttr.array.set(wasmF32.subarray(posOffset, posOffset + count * 3));
        positionAttr.needsUpdate = true;
    }

    updateMistWasm(instance, time, melodyVol, weatherState, weatherType) {
        if (!this.melodicMist) return;

        const shouldShow = melodyVol > 0.2 || (weatherType === 'mist' && weatherState === 'rain');
        this.melodicMist.visible = shouldShow;

        if (!shouldShow) return;

        this.melodicMist.material.opacity = 0.3 + melodyVol * 0.4;
        if (weatherType === 'mist') {
            this.melodicMist.material.color.setHex(0xDDFFDD);
            this.melodicMist.material.opacity = 0.6;
        } else {
            this.melodicMist.material.color.setHex(0xAAFFAA);
        }

        const positionAttr = this.melodicMist.geometry.attributes.position;
        const count = positionAttr.count;

        if (!this.mistPtr) {
            // Mist needs Pos(3N)
            const sizeBytes = count * 3 * 4;
            this.mistPtr = instance.exports.__new(sizeBytes, 0);

            // Copy initial
            const wasmF32 = new Float32Array(instance.exports.memory.buffer);
            wasmF32.set(positionAttr.array, this.mistPtr / 4);
            this.mistCount = count;
        }

        this.wasmUpdateMistBatch(
            this.mistPtr,
            count,
            time,
            melodyVol
        );

        const wasmF32 = new Float32Array(instance.exports.memory.buffer);
        const posOffset = this.mistPtr / 4;
        positionAttr.array.set(wasmF32.subarray(posOffset, posOffset + count * 3));
        positionAttr.needsUpdate = true;
    }
}

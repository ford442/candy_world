import * as THREE from 'three';
import { shouldUseFoliageGpuBatch } from '../compute/foliage-gpu-batch.ts';
import { CYCLE_DURATION } from '../core/config.ts';
import { getDayNightBias } from '../core/cycle.ts';
import { animateFoliage } from '../foliage/animation.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { foliageBatcher } from '../foliage/batcher/index.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher/index.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import type { AudioData, FoliageObject } from '../foliage/types.ts';
import { uploadPositionsFlat, batchDistanceCull, WASM_POSITION_OBJECT_CAPACITY } from '../utils/wasm-batch.ts';
import { MRState, _scratchSphere } from './music-reactivity-core.ts';
import { _frustum, _projScreenMatrix } from './music-reactivity-core.ts';
import { _emptyAudioState } from './music-reactivity.ts';

let _batchPositionsBuffer = new Float32Array(0);
let _batchPositionsCapacity = 0;

function ensureBatchPositionsCapacity(neededCount: number) {
    if (neededCount <= _batchPositionsCapacity) return;
    let next = Math.max(_batchPositionsCapacity * 2, 16);
    while (next < neededCount) next *= 2;
    const nextBuf = new Float32Array(next * 4);
    nextBuf.set(_batchPositionsBuffer.subarray(0, _batchPositionsCapacity * 4));
    _batchPositionsBuffer = nextBuf;
    _batchPositionsCapacity = next;
}

    export function updateFoliageAnimationLoop(
        time: number,
        deltaTime: number,
        audioState: AudioData | null,
        cpuAnimatedFoliage: FoliageObject[],
        camera: THREE.Camera,
        isDay: boolean,
        isDeepNight: boolean
    ) {
        // ⚡ OPTIMIZATION: Short-circuit CPU math if the GPU compute shader is handling instances
        if (shouldUseFoliageGpuBatch(cpuAnimatedFoliage?.length || 0)) {
            return;
        }

        if (typeof isDay !== 'boolean') {
            console.warn('[Music] isDay parameter missing');
            return;
        }

        // 3. Update Foliage Animation Loop
        if (cpuAnimatedFoliage && camera) {
            // Update Frustum for Culling
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);

            const cx = camera.position.x;
            const cy = camera.position.y;
            const cz = camera.position.z;

            // Ensure buffer has enough capacity (zero allocation if it's already large enough)
            const n = cpuAnimatedFoliage.length;
            ensureBatchPositionsCapacity(n);
            const wasmCount = Math.min(n, WASM_POSITION_OBJECT_CAPACITY);

            // Fill float buffer densely in a tight loop
            const buf = _batchPositionsBuffer;
            for (let i = 0; i < n; i++) {
                const obj = cpuAnimatedFoliage[i];
                if (!obj) continue;

                const base = i * 4;
                buf[base] = obj.position.x;
                buf[base + 1] = obj.position.y;
                buf[base + 2] = obj.position.z;
                buf[base + 3] =
                    (obj.userData.radius || 2.0) * (obj.scale.x > 1.0 ? obj.scale.x : 1.0);
            }

            // Upload to WASM via flat float array (capped to AS position buffer capacity)
            uploadPositionsFlat(buf, wasmCount);

            // ⚡ OPTIMIZATION: Bypassed CPU distance math with WASM batchDistanceCull
            const { flags } =
                wasmCount > 0
                    ? batchDistanceCull(cx, cy, cz, 250, wasmCount)
                    : { flags: null as Float32Array | null };

            for (let i = 0; i < n; i++) {
                const obj = cpuAnimatedFoliage[i];
                if (!obj) continue;

                // Base max distance check (from WASM flags) — only for indices uploaded to WASM
                if (flags && i < wasmCount && flags[i] === 0) {
                    continue;
                }

                const ox = obj.position.x;
                const oy = obj.position.y;
                const oz = obj.position.z;

                // Frustum Culling
                let isVisible = false;
                _scratchSphere.center.x = ox;
                _scratchSphere.center.y = oy;
                _scratchSphere.center.z = oz;
                _scratchSphere.radius =
                    (obj.userData.radius || 2.0) * (obj.scale.x > 1.0 ? obj.scale.x : 1.0);
                isVisible = _frustum.intersectsSphere(_scratchSphere);

                if (isVisible) {
                    // Using animateFoliage (assumed typed correctly in animation.ts)
                    // ⚡ OPTIMIZATION: Use static _emptyAudioState instead of allocating {} per frame
                    animateFoliage(obj, time, audioState || _emptyAudioState, isDay);
                }
            }

            // Flush batched updates to GPU
            // Pass audioState for extended animation batching (Phase 1 migration)
            const kick = audioState?.kickTrigger || 0;
            foliageBatcher.flush(time, kick, audioState);

            // Continuous day/night bias for pose state machines (0 = night, 1 = day).
            // Pure arithmetic — no allocations.
            const dayNightBias = getDayNightBias(time % CYCLE_DURATION);

            // Update Arpeggio Batcher
            arpeggioFernBatcher.update(audioState, dayNightBias);

            // Update Portamento Batcher
            portamentoPineBatcher.update(time, audioState, dayNightBias);

            // Update Flower Batchers (aPoseState driven by audio)
            flowerBatcher.update(time, deltaTime, audioState, dayNightBias);
            simpleFlowerBatcher.update(time, deltaTime, audioState, dayNightBias);

            // Update Kick Drum Geysers
            kickDrumGeyserBatcher.update(time, deltaTime, audioState, MRState.activeWave);
            // Note: subwooferLotusBatcher responds via TSL uniforms, no JS update loop required.
        }
    }
import * as THREE from 'three';
import { FoliageObject, AudioData } from './types.js';
import { calcArpeggioStep } from '../utils/wasm-loader.js';

export function updateArpeggio(foliageObject: FoliageObject, time: number, audioData: AudioData | null) {
    // Step-based unfurling logic (Revised for Quantized Steps with Rising Edge)
    let arpeggioActive = false;
    let noteTrigger = false;

    // Scan for arpeggio effect
    if (audioData && audioData.channelData) {
        for (const ch of audioData.channelData) {
            if (ch.activeEffect === 4 || (ch.activeEffect === 0 && ch.effectValue && ch.effectValue > 0)) {
                arpeggioActive = true;
            }
            if (ch.trigger > 0.1) {
                noteTrigger = true;
            }
        }
    }

    // State initialization
    if (foliageObject.userData.unfurlStep === undefined) foliageObject.userData.unfurlStep = 0;
    if (foliageObject.userData.targetStep === undefined) foliageObject.userData.targetStep = 0;
    if (foliageObject.userData.lastTrigger === undefined) foliageObject.userData.lastTrigger = false;

    const maxSteps = 12;

    // --- WASM Acceleration ---
    // Offload the state machine and lerp logic to AssemblyScript
    const result = calcArpeggioStep(
        foliageObject.userData.unfurlStep,
        foliageObject.userData.targetStep,
        foliageObject.userData.lastTrigger,
        arpeggioActive,
        noteTrigger,
        maxSteps
    );

    foliageObject.userData.targetStep = result.targetStep;
    foliageObject.userData.unfurlStep = result.unfurlStep;

    // Update trigger state for next frame
    foliageObject.userData.lastTrigger = noteTrigger;

    const unfurlFactor = (foliageObject.userData.unfurlStep || 0) / maxSteps;

    // Apply to segments (Three.js Object3D operations remain in JS/TS as they touch scene graph)
    const fronds = foliageObject.userData.fronds;
    if (fronds) {
        fronds.forEach((segments, fIdx) => {
            segments.forEach((segData: any, sIdx: number) => {
                const targetRot = THREE.MathUtils.lerp(segData.initialCurl, 0.2, unfurlFactor);
                const wave = Math.sin(time * 5 + sIdx * 0.5) * 0.1 * unfurlFactor;
                segData.pivot.rotation.x = targetRot + wave;
            });
        });
    }

    // Bob base slightly
    if (foliageObject.userData.originalY === undefined) {
        foliageObject.userData.originalY = foliageObject.position.y;
    }
    foliageObject.position.y = foliageObject.userData.originalY + unfurlFactor * 0.2;
}

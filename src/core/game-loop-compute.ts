import { rendererRef } from './game-loop-core.ts';
import { isCIorHeadless } from './config.ts';
import { windComputeSystem } from '../foliage/wind-compute.ts';
import { harmonyOrbSystem } from '../foliage/aurora.ts';
import { animatedFoliage } from '../world/state.ts';

export function updateComputePhase() {
    if (!(window as any).__computeDisabled) {
        try {
            const windComputeNode = windComputeSystem.getComputeNode();
            if (windComputeNode) {
                if (!isCIorHeadless()) { rendererRef.compute(windComputeNode); }
            }

            if (harmonyOrbSystem.computeNode) {
                if (!isCIorHeadless()) { rendererRef.compute(harmonyOrbSystem.computeNode); }
            }

            for (const obj of animatedFoliage) {
                if (obj.userData.computeNode) {
                    if (obj.userData.type === 'waterfall' || obj.userData.isPollen) {
                        if (!isCIorHeadless()) { rendererRef.compute(obj.userData.computeNode); }
                    }
                }
            }
        } catch (err) {
            console.error('[Compute] Runtime dispatch failed:', err);
            console.warn('[Compute] Disabling compute passes for remainder of session');
            (window as any).__computeDisabled = true;
        }
    }
}

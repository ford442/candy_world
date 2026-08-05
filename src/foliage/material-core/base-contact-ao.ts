import * as THREE from 'three';
import { float, vec3, uniform, mix, smoothstep, max } from 'three/tsl';
import { CONFIG } from '../../core/config.ts';

export const uBaseContactAOEnabled = uniform(1.0);
export const uBaseContactAOStrength = uniform(0.32);
export const uBaseContactAONightBoost = uniform(0.25);
export const uBaseContactAONightFactor = uniform(0.0);
const _uBaseContactGroundTint = uniform(new THREE.Color(0x1a1410));

const _scratchGroundTint = new THREE.Color();

export function getBaseContactHeight(entityType: string): number {
    const table = CONFIG.foliage?.baseContactAO?.contactHeight;
    if (!table) return 0.4;
    return (
        (table as Record<string, number>)[entityType] ??
        (table as Record<string, number>)._default ??
        0.4
    );
}

export function applyBaseContactAO(
    baseColor: ReturnType<typeof vec3>,
    localY: ReturnType<typeof float>,
    contactHeight: ReturnType<typeof float> = float(0.4),
    strengthMul: ReturnType<typeof float> = float(1.0)
) {
    const nightBoost = float(1.0).add(uBaseContactAONightBoost.mul(uBaseContactAONightFactor));
    const strength = uBaseContactAOStrength
        .mul(strengthMul)
        .mul(nightBoost)
        .mul(uBaseContactAOEnabled);
    const contactT = float(1.0).sub(smoothstep(float(0.0), contactHeight, max(localY, float(0.0))));
    return mix(baseColor, _uBaseContactGroundTint, contactT.mul(strength).clamp(0.0, 0.85));
}

export function updateBaseContactAOUniforms(dayNightBias: number): void {
    const cfg = CONFIG.foliage?.baseContactAO;
    if (!cfg?.enabled) {
        uBaseContactAOEnabled.value = 0;
        return;
    }
    uBaseContactAOEnabled.value = 1;
    uBaseContactAOStrength.value = cfg.strength;
    uBaseContactAONightBoost.value = cfg.nightBoost;
    _uBaseContactGroundTint.value.copy(_scratchGroundTint.setHex(cfg.groundTint));
    uBaseContactAONightFactor.value = Math.max(0, Math.min(1, 1.0 - dayNightBias));
}

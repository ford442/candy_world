/**
 * Camera-derived atmospheric fog distances.
 * Single source of truth for THREE.Fog + TSL uFogNear/uFogFar (WebGPU/WebGL parity).
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { uFogNear, uFogFar } from '../foliage/sky.ts';

export interface FogDistanceTargets {
    near: number;
    far: number;
}

export interface FogTelemetry {
    targetNear: number;
    targetFar: number;
    currentNear: number;
    currentFar: number;
    tslNear: number;
    tslFar: number;
    cameraFar: number;
    cameraFov: number;
    dayNightBias: number;
    playerY: number;
}

const _telemetry: FogTelemetry = {
    targetNear: 20,
    targetFar: 100,
    currentNear: 20,
    currentFar: 100,
    tslNear: 20,
    tslFar: 100,
    cameraFar: 2000,
    cameraFov: 60,
    dayNightBias: 1,
    playerY: 0,
};

export function getFogTelemetry(): Readonly<FogTelemetry> {
    return _telemetry;
}

/** Boot-time defaults (full day, spawn height). */
export function getInitialFogDistances(): FogDistanceTargets {
    return computeAtmosphereFogTargets(
        { far: 2000, fov: 60 },
        CONFIG.player.spawnEyeHeightY,
        1.0,
    );
}

/**
 * Derive base fog near/far from camera frustum, FOV, player altitude, and day/night.
 * Weather modifiers are applied downstream in AtmosphereManager.updateFog.
 */
export function computeAtmosphereFogTargets(
    camera: Pick<THREE.PerspectiveCamera, 'far' | 'fov'>,
    playerY: number,
    dayNightBias: number,
): FogDistanceTargets {
    const cfg = CONFIG.atmosphere.fog;

    const fovFactor = camera.fov / cfg.referenceFov;
    const fovMul = 1.0 + (fovFactor - 1.0) * cfg.fovScale;

    const nearRatio = THREE.MathUtils.lerp(cfg.nightNearRatio, cfg.nearRatio, dayNightBias);
    const farRatio = THREE.MathUtils.lerp(cfg.nightFarRatio, cfg.farRatio, dayNightBias);

    const altBoost = Math.max(0, playerY - cfg.altitudeBaseline) * cfg.altitudeScale;

    let near = camera.far * nearRatio * fovMul;
    let far = camera.far * farRatio * fovMul + altBoost;

    // Horizon alignment — keep falloff inside the sky gradient silhouette band
    far = Math.min(far, camera.far * cfg.horizonFarCap);

    near = THREE.MathUtils.clamp(near, cfg.minNear, cfg.maxNear);
    far = THREE.MathUtils.clamp(far, cfg.minFar, cfg.maxFar);

    // Foreground clarity — no milky haze at the player's feet
    near = Math.min(near, cfg.maxForegroundNear, far * 0.22);

    if (far - near < cfg.minSpan) {
        far = Math.min(cfg.maxFar, near + cfg.minSpan);
    }

    _telemetry.targetNear = near;
    _telemetry.targetFar = far;
    _telemetry.cameraFar = camera.far;
    _telemetry.cameraFov = camera.fov;
    _telemetry.dayNightBias = dayNightBias;
    _telemetry.playerY = playerY;

    return { near, far };
}

export function syncFogTelemetryFromScene(fog: THREE.Fog | null): void {
    if (!fog) return;
    _telemetry.currentNear = fog.near;
    _telemetry.currentFar = fog.far;
    _telemetry.tslNear = uFogNear.value as number;
    _telemetry.tslFar = uFogFar.value as number;
}

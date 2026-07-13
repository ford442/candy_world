/**
 * Player-following directional shadow camera for the sun light.
 * Tight ortho bounds keep shadow texels dense around the player.
 */
import * as THREE from 'three';
import { CONFIG, resolveShadowSettings } from '../core/config.ts';

/**
 * Configure sun shadow map, ortho frustum, and renderer shadow pass.
 * @returns true when shadows are active
 */
export function configureSunShadows(
    sunLight: THREE.DirectionalLight,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
): boolean {
    const settings = resolveShadowSettings();

    if (!settings.enabled) {
        sunLight.castShadow = false;
        renderer.shadowMap.enabled = false;
        return false;
    }

    const cfg = CONFIG.lighting.shadows;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(settings.mapSize, settings.mapSize);
    sunLight.shadow.bias = cfg.bias;
    sunLight.shadow.normalBias = cfg.normalBias;
    sunLight.shadow.radius = cfg.pcfRadius;

    const cam = sunLight.shadow.camera as THREE.OrthographicCamera;
    const r = cfg.followRadius;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = cfg.cameraNear;
    cam.far = cfg.cameraFar;
    cam.updateProjectionMatrix();

    scene.add(sunLight.target);
    return true;
}

/**
 * Parallel-translate the sun rig so shadow ortho stays centered on the player
 * while preserving celestial light direction.
 */
export function applyPlayerShadowFollow(
    sunLight: THREE.DirectionalLight,
    celestialX: number,
    celestialY: number,
    celestialZ: number,
    playerX: number,
    playerY: number,
    playerZ: number,
): void {
    if (!sunLight.castShadow) return;

    sunLight.position.set(
        celestialX + playerX,
        celestialY + playerY,
        celestialZ + playerZ,
    );
    sunLight.target.position.set(playerX, playerY, playerZ);
}

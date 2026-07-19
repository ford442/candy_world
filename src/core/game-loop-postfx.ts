import * as THREE from 'three';
import { CONFIG, areGodRaysEnabled, isDofEnabled, isDofManual } from './config.ts';
import { uDofFocus, uDofMix, uShaftScatterBoost } from '../foliage/post-processing.ts';
import { AtmosphereShaftState } from '../systems/music-reactivity.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { player } from '../systems/physics/index.ts';
import { isCIorHeadless } from './config.ts';
import {
    _SHAFT_FRUSTUM_DOT,
    _SHAFT_OPACITY_CAP,
    _DOF_FLORA_ZONES,
    cameraRef,
    _scratchCameraForward,
    lightShaftGroupRef,
    _shaftIsGoldenHour,
    _shaftGoldenHourBase,
    _scratchSunVector,
    _shaftIsNightMode,
    uShaftOpacityRef,
    _shadowLightView,
    _shadowSnap,
    _shadowSnapCellX,
    setShadowSnapCellX,
    _shadowSnapCellZ,
    setShadowSnapCellZ,
    postProcessingRef
} from './game-loop-core.ts';

const _godRaysEnabled = areGodRaysEnabled();
const _dofEnabled = isDofEnabled();
const _dofManual = _dofEnabled && isDofManual();

/**
 * Player-following sun shadow rig with light-view texel snapping.
 * Sky visuals use `_scratchSunVector` separately — do not drive corona/shafts from light.position.
 */
export function updateSunShadowFollow(
    sunLight: THREE.DirectionalLight,
    playerPos: THREE.Vector3,
    normalizedSunDir: THREE.Vector3,
): void {
    if (!sunLight.castShadow) return;

    const cfg = CONFIG.lighting.shadows;
    const renderRadius = cfg.followRadius + cfg.snapHeadroom;
    const mapSize = sunLight.shadow.mapSize.width;
    const texelWorld = (renderRadius * 2) / mapSize;

    sunLight.position.copy(playerPos).addScaledVector(normalizedSunDir, cfg.sunDistance);
    sunLight.target.position.copy(playerPos);
    sunLight.target.updateMatrixWorld();

    const cam = sunLight.shadow.camera as THREE.OrthographicCamera;
    cam.position.copy(sunLight.position);
    cam.lookAt(sunLight.target.position);
    cam.updateMatrixWorld();

    _shadowLightView.copy(playerPos);
    cam.worldToLocal(_shadowLightView);

    const snappedX = Math.floor(_shadowLightView.x / texelWorld) * texelWorld;
    const snappedY = Math.floor(_shadowLightView.y / texelWorld) * texelWorld;
    _shadowSnap.set(
        snappedX - _shadowLightView.x,
        snappedY - _shadowLightView.y,
        0,
    );
    _shadowSnap.applyQuaternion(cam.quaternion);
    cam.position.add(_shadowSnap);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    const cellX = Math.floor(playerPos.x / texelWorld);
    const cellZ = Math.floor(playerPos.z / texelWorld);
    if (cellX !== _shadowSnapCellX || cellZ !== _shadowSnapCellZ) {
        setShadowSnapCellX(cellX);
        setShadowSnapCellZ(cellZ);
        if (sunLight.shadow && sunLight.shadow.map) { (sunLight.shadow.map as any).autoUpdate = true; }
    } else {
        if (sunLight.shadow && sunLight.shadow.map) { (sunLight.shadow.map as any).autoUpdate = false; }
    }
}

export function _celestialInView(direction: THREE.Vector3): boolean {
    if (!cameraRef) return false;
    cameraRef.getWorldDirection(_scratchCameraForward);
    return direction.dot(_scratchCameraForward) > _SHAFT_FRUSTUM_DOT;
}

/** Night shaft tint: cool silver by default; purple when crystalline_nebula channels are active. */
export function _applyShaftColor(shaftMat: THREE.MeshBasicMaterial | undefined, isNight: boolean): void {
    if (!shaftMat?.color) return;
    if (!isNight) {
        shaftMat.color.setHex(0xFFE5A0);
        return;
    }
    const nebulaShimmer = BiomeUniforms.crystallineNebula.shimmer.value as number;
    const nebulaAmp = BiomeUniforms.crystallineNebula.amplitudeScale.value as number;
    // Music Impact: purple moonbeams during crystalline_nebula tracker passages
    const nebulaPassage = nebulaShimmer > 0.12 || nebulaAmp > 1.15;
    shaftMat.color.setHex(nebulaPassage ? 0xB388FF : 0xC8E0FF);
}

export function _setShaftOpacity(opacity: number): void {
    if (!uShaftOpacityRef) return;
    uShaftOpacityRef.value = opacity;
    const shaftMat = lightShaftGroupRef?.userData?.shaftMaterial as THREE.MeshBasicMaterial | undefined;
    if (shaftMat && typeof shaftMat.opacity === 'number') {
        shaftMat.opacity = opacity;
    }
}

/** Apply melody/beat-driven shaft opacity after MusicReactivitySystem.update(). */
export function applyMusicReactiveLightShafts(delta: number): void {
    if (!lightShaftGroupRef) return;

    // Respect the post-FX quality tier — ?postfx=off (or CONFIG.postfx.godRays=false)
    // disables god rays entirely, keeping the group hidden with zero per-frame cost.
    if (!_godRaysEnabled) {
        if (lightShaftGroupRef.visible) {
            if (lightShaftGroupRef) lightShaftGroupRef.visible = false;
            _setShaftOpacity(0);
        }
        return;
    }

    let shaftOpacity = 0;
    let shaftVisible = false;

    if (_shaftIsGoldenHour && _shaftGoldenHourBase > 0.001) {
        shaftOpacity = _shaftGoldenHourBase + AtmosphereShaftState.beatShimmer;
        // Performance: frustum-gate golden-hour shafts (sun must be in view)
        shaftVisible = _celestialInView(_scratchSunVector) && shaftOpacity > 0.01;
    } else if (_shaftIsNightMode) {
        // Visual Impact: moonbeam cap — soft silver/purple rays, not blinding
        shaftOpacity = Math.min(_SHAFT_OPACITY_CAP * 0.875, AtmosphereShaftState.musicOpacity + AtmosphereShaftState.beatShimmer);
        const strongMelody = AtmosphereShaftState.musicOpacity > 0.08;
        shaftVisible = (strongMelody || _celestialInView(_scratchSunVector) || AtmosphereShaftState.nightMoonbeam) && shaftOpacity > 0.01;
        const shaftMat = lightShaftGroupRef.userData?.shaftMaterial as THREE.MeshBasicMaterial | undefined;
        _applyShaftColor(shaftMat, true);
    } else if (AtmosphereShaftState.musicOpacity > 0.01) {
        shaftOpacity = Math.min(_SHAFT_OPACITY_CAP * 0.875, AtmosphereShaftState.musicOpacity + AtmosphereShaftState.beatShimmer);
        const strongMelody = AtmosphereShaftState.musicOpacity > 0.08;
        shaftVisible = strongMelody && shaftOpacity > 0.01;
    }

    if (lightShaftGroupRef) lightShaftGroupRef.visible = shaftVisible;
    if (shaftVisible) {
        lightShaftGroupRef.rotation.z += delta * 0.1;
        const capped = Math.min(_SHAFT_OPACITY_CAP, shaftOpacity);
        _setShaftOpacity(capped);
        // Screen-space radial scatter companion (bloom swell, no extra render pass)
        uShaftScatterBoost.value = capped * CONFIG.postfx.shaftScatterBoost;
    } else {
        _setShaftOpacity(0);
        uShaftScatterBoost.value = 0;
    }
}

/**
 * Drive Depth-of-Field focus + blend each frame (zero-alloc scalar math).
 * Engages near luminous / mycelium flora (or always, when manually enabled), with
 * the focal plane following the player's look distance toward that flora.
 * No-op unless DoF was built into the pipeline at boot.
 */
export function _updateDepthOfField(delta: number): void {
    if (!_dofEnabled || !player?.position || !cameraRef) return;

    const px = player.position.x;
    const pz = player.position.z;
    cameraRef.getWorldDirection(_scratchCameraForward);

    // ⚡ OPTIMIZATION: Deferred Math.sqrt() by tracking squared distances in the hot loop
    let nearestSq = Infinity;
    let lookFocusDist = Infinity;
    for (let i = 0; i < _DOF_FLORA_ZONES.length; i++) {
        const dx = px - _DOF_FLORA_ZONES[i][0];
        const dz = pz - _DOF_FLORA_ZONES[i][1];
        const dSq = dx * dx + dz * dz;
        if (dSq < nearestSq) nearestSq = dSq;

        // Focus-follow: distance along the camera look vector toward scenic flora
        const toX = _DOF_FLORA_ZONES[i][0] - px;
        const toZ = _DOF_FLORA_ZONES[i][1] - pz;
        // ⚡ OPTIMIZATION: Bypassed unused horizLen and Math.sqrt overhead.
        const lookAlong = toX * _scratchCameraForward.x + toZ * _scratchCameraForward.z;
        if (lookAlong > 2.0 && lookAlong < lookFocusDist) {
            lookFocusDist = lookAlong;
        }
    }
    const nearest = nearestSq === Infinity ? Infinity : Math.sqrt(nearestSq);

    const prox = CONFIG.postfx.dofProximity;
    // Proximity ramp: full DoF within (prox-2), fading out by (prox+6).
    const proxMix = 1.0 - THREE.MathUtils.smoothstep(nearest, prox - 2.0, prox + 6.0);

    // TSL Volumetric God Rays: boost DoF when shafts are highly visible
    const shaftBoost = uShaftOpacityRef ? (uShaftOpacityRef.value * 2.0) : 0.0;
    const combinedMix = THREE.MathUtils.clamp(proxMix + shaftBoost, 0.0, 1.0);

    const targetMix = _dofManual ? 1.0 : combinedMix;

    // Focal plane follows look-vector distance to flora when in view, else nearest proximity.
    const focusFromLook = lookFocusDist < Infinity ? lookFocusDist : nearest;
    const targetFocus = CONFIG.postfx.dofFocusFollow
        ? THREE.MathUtils.clamp(focusFromLook, 3.0, 40.0)
        : CONFIG.postfx.dofFocusDistance;

    // Frame-rate-independent smoothing toward targets.
    const k = 1.0 - Math.exp(-delta * 4.0);
    uDofMix.value += (targetMix - uDofMix.value) * k;
    uDofFocus.value += (targetFocus - uDofFocus.value) * k;
}


export function updatePostFX(delta: number) {
    applyMusicReactiveLightShafts(delta);
    _updateDepthOfField(delta);
}

export function renderPostProcessing() {
    if (!isCIorHeadless() && postProcessingRef) {
        postProcessingRef.render();
    }
}

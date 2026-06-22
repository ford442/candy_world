// src/core/game-loop.ts
// Main animation loop and game state management

import * as THREE from 'three';
import {
    uWindSpeed,
    uWindDirection,
    uAudioLow,
    uAudioHigh,
    uGlitchIntensity,
    uTime,
    uPlayerPosition,
} from '../foliage/index.ts';
import {
    uSkyTopColor,
    uSkyBottomColor,
    uHorizonColor,
    uAtmosphereIntensity
} from '../foliage/sky.ts';
import { uStarOpacity } from '../foliage/stars.ts';
import { uAuroraIntensity, uAuroraColor } from '../foliage/aurora.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { harmonyOrbSystem } from '../foliage/aurora.ts';
import {
    updateFallingBerries,
    collectFallingBerries
} from '../foliage/berries.ts';
import { updateMelodyRibbons } from '../foliage/ribbons.ts';
import { updateSparkleTrail } from '../foliage/sparkle-trail.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { getGroundHeight } from '../utils/wasm-loader.ts';
import { updateImpacts } from '../foliage/impacts.ts';
import { createShield } from '../foliage/shield.ts';
import { updateFoliageMaterials } from '../foliage/animation.ts';
import { updateFoliageBatcherLOD } from '../systems/batcher-lod.ts';
import { circadianController } from '../systems/circadian-controller.ts';
import { windComputeSystem } from '../foliage/wind-compute.ts';
import { chordStrikeSystem } from '../gameplay/chord-strike.ts';
import { updateFallingClouds } from '../foliage/clouds.ts';
import { updateAllIntegratedSystems, type ParticleAudioData } from '../particles/index.ts';

const _scratchParticleAudioData: ParticleAudioData = {
    low: 0,
    mid: 0,
    high: 0,
    beat: false,
    groove: 0,
    windX: 0,
    windZ: 0,
    windSpeed: 0
};

function safeUpdateBatcher(batcher: any, delta: number, label = 'batcher') {
    if (batcher && typeof batcher.update === 'function') {
        try {
            batcher.update(delta);
        } catch (err) {
            console.warn(`[GameLoop] Skipped update on ${label} (likely empty or incomplete in Core mode)`, err);
        }
    }
}

function safeSystemUpdate(updateFn: any, label: string, ...args: any[]) {
    if (typeof updateFn !== 'function') return;
    try {
        updateFn(...args);
    } catch (err) {
        console.warn(`[GameLoop] Skipped ${label} update in Core mode`, err);
    }
}

import { WeatherState } from '../systems/weather-types.ts';
import { CloudBatcher } from '../foliage/cloud-batcher.ts';
import { fluidSystem } from '../systems/fluid_system.ts';
import { updatePhysics, player } from '../systems/physics/index.ts';
import { fireRainbow, updateBlaster } from '../gameplay/rainbow-blaster.ts';
import { jitterMineSystem } from '../gameplay/jitter-mines.ts';
import { glitchGrenadeSystem } from '../systems/glitch-grenade.ts';
import { updateHarpoonLine } from '../gameplay/harpoon-line.ts';
import { musicReactivitySystem, AtmosphereShaftState } from '../systems/music-reactivity.ts';
import { updateExploreCamera, getExploreCamera, isExploreActive } from './camera-modes.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { profiler } from '../utils/profiler.ts';
import { WeatherSystem } from '../systems/weather.ts';
import { InteractionSystem } from '../systems/interaction.ts';
import { AudioSystem } from '../audio/audio-system.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import { animatedFoliage, cpuAnimatedFoliage, foliageClouds, foliageMushrooms } from '../world/state.ts';
import { getCycleState } from './cycle.ts';
import {
    CYCLE_DURATION,
    DURATION_SUNRISE,
    DURATION_DAY,
    DURATION_SUNSET,
    DURATION_DUSK_NIGHT,
    DURATION_DEEP_NIGHT,
    CONFIG,
    areGodRaysEnabled,
    isDofEnabled,
    isDofManual
} from './config.ts';
import { uDofFocus, uDofMix } from '../foliage/post-processing.ts';
import { keyStates } from './input/index.js';
import {
    updateHUD,
    getLastIsNight,

    setLastIsNight,
    getIsNight,
    setIsNight,
    updateTheme,
    setLastStrikeState,
    getLastStrikeState
} from './hud.ts';
import {
    getMelodyRibbon,
    getSparkleTrail,
    getImpactSystem,
    getFluidFog,
    getDandelionSeedSystem,
    getDiscoveryEffect,
    getHarpoonLine,
    getPlayerShieldMesh,
    setPlayerShieldMesh
} from './deferred-init.ts';

// --- Animation Loop State ---
const clock = new THREE.Clock();
let gameTime = 0;
let audioState: any = null;
let lastBeatPhase = 0;
let beatFlashIntensity = 0;
let cameraZoomPulse = 0;
import { addCameraShake, getCameraShake, setCameraShake } from './camera-shake.ts';
let cameraShake = getCameraShake();
let currentShakeOffsetX = 0;
let currentShakeOffsetY = 0;
const baseFOV = 75;

// Optimization: Hoist reusable objects to module scope
const COLOR_STORM_SKY_TOP = new THREE.Color(0x1A1A2E);
const COLOR_STORM_SKY_BOT = new THREE.Color(0x2E3A59);
const COLOR_STORM_FOG = new THREE.Color(0x4A5568);
const COLOR_RAIN = new THREE.Color(0xA0B5C8);
const COLOR_RAIN_FOG = new THREE.Color(0xC0D0E0);

const _scratchBaseSkyTop = new THREE.Color();
const _scratchBaseSkyBot = new THREE.Color();
const _scratchBaseFog = new THREE.Color();
const _scratchSunVector = new THREE.Vector3();
const _scratchAuroraColor = new THREE.Color();
const _scratchCameraForward = new THREE.Vector3();

// Light shaft cycle state — base golden-hour intensity set before music; opacity finalized after.
let _shaftGoldenHourBase = 0;
let _shaftIsGoldenHour = false;
let _shaftIsNightMode = false;
// Visual Impact: minimum dot(cameraForward, celestialDir) to show god rays (frustum gate)
const _SHAFT_FRUSTUM_DOT = 0.28;

// Post-FX enablement resolved once per session (URL overrides + CONFIG.postfx tier).
const _godRaysEnabled = areGodRaysEnabled();
const _dofEnabled = isDofEnabled();
// Manual DoF: always-on (not proximity-gated) when explicitly enabled via ?dof / config.
const _dofManual = _dofEnabled && isDofManual();

// Scenic flora zone centres (X,Z) that auto-engage Depth of Field when 'high' tier.
// Kept in sync with generation-core luminous placement (~-40,40) and
// generation-utils MYCELIUM_GROVE (-78,78). Hardcoded to avoid a world→core import.
const _DOF_FLORA_ZONES: ReadonlyArray<readonly [number, number]> = [
    [-40, 40], // Melody Lake luminous plants
    [-78, 78], // Luminous Mycelium grove (glass mushrooms)
];

const _interactionLists: (any[] | null)[] = [null, null, null]; // Reusable array for interaction lists

// References to main scene objects (set during initialization)
let sceneRef: THREE.Scene | null = null;
let cameraRef: THREE.PerspectiveCamera | null = null;
let rendererRef: any = null;
let postProcessingRef: any = null;
let weatherSystemRef: WeatherSystem | null = null;
let audioSystemRef: AudioSystem | null = null;
let beatSyncRef: BeatSync | null = null;
let interactionSystemRef: InteractionSystem | null = null;
let moonRef: THREE.Object3D | null = null;
let firefliesRef: THREE.Object3D | null = null;
let controlsRef: any = null;

// Lighting references
let sunLightRef: THREE.DirectionalLight | null = null;
let ambientLightRef: THREE.AmbientLight | THREE.HemisphereLight | null = null;
let sunGlowRef: THREE.Object3D | null = null;
let sunCoronaRef: THREE.Object3D | null = null;
let lightShaftGroupRef: THREE.Object3D | null = null;
let sunGlowMatRef: THREE.Material | null = null;
let coronaMatRef: THREE.Material | null = null;
let uShaftOpacityRef: { value: number } | null = null;

// Time offset reference (shared with main)
let timeOffsetRef: { value: number } = { value: 0 };

// Logging flag
let _loggedWebGPULimits = false;
type WebGPURendererWithDeviceLimits = THREE.Renderer & {
    backend?: {
        device?: {
            limits?: GPUSupportedLimits;
        };
    };
};

export function initGameLoopDependencies(deps: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: any;
    postProcessing: any;
    weatherSystem: WeatherSystem;
    audioSystem: AudioSystem;
    beatSync: BeatSync;
    interactionSystem: InteractionSystem;
    moon: THREE.Object3D;
    fireflies: THREE.Object3D | null;
    controls: any;
    sunLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight | THREE.HemisphereLight;
    sunGlow: THREE.Object3D;
    sunCorona: THREE.Object3D;
    lightShaftGroup: THREE.Object3D;
    sunGlowMat: THREE.Material;
    coronaMat: THREE.Material;
    uShaftOpacity: { value: number };
    timeOffset: { value: number };
}) {
    sceneRef = deps.scene;
    cameraRef = deps.camera;
    rendererRef = deps.renderer;
    postProcessingRef = deps.postProcessing;
    weatherSystemRef = deps.weatherSystem;
    audioSystemRef = deps.audioSystem;
    beatSyncRef = deps.beatSync;
    interactionSystemRef = deps.interactionSystem;
    moonRef = deps.moon;
    firefliesRef = deps.fireflies;
    controlsRef = deps.controls;
    sunLightRef = deps.sunLight;
    ambientLightRef = deps.ambientLight;
    sunGlowRef = deps.sunGlow;
    sunCoronaRef = deps.sunCorona;
    lightShaftGroupRef = deps.lightShaftGroup;
    sunGlowMatRef = deps.sunGlowMat;
    coronaMatRef = deps.coronaMat;
    uShaftOpacityRef = deps.uShaftOpacity;
    timeOffsetRef = deps.timeOffset;

    // Register Beat Effects
    beatSyncRef.onBeat((state) => {
        const kickTrigger = state?.kickTrigger || 0;
        if (kickTrigger > 0.2) {
            beatFlashIntensity = Math.max(beatFlashIntensity, 0.4 + kickTrigger * 0.5);
            cameraZoomPulse = Math.max(cameraZoomPulse, 1 + kickTrigger * 3);
        }
    });
}

function _celestialInView(direction: THREE.Vector3): boolean {
    if (!cameraRef) return false;
    cameraRef.getWorldDirection(_scratchCameraForward);
    return direction.dot(_scratchCameraForward) > _SHAFT_FRUSTUM_DOT;
}

function _setShaftOpacity(opacity: number): void {
    if (!uShaftOpacityRef) return;
    uShaftOpacityRef.value = opacity;
    const shaftMat = lightShaftGroupRef?.userData?.shaftMaterial as THREE.MeshBasicMaterial | undefined;
    if (shaftMat && typeof shaftMat.opacity === 'number') {
        shaftMat.opacity = opacity;
    }
}

/** Apply melody/beat-driven shaft opacity after MusicReactivitySystem.update(). */
function applyMusicReactiveLightShafts(delta: number): void {
    if (!lightShaftGroupRef) return;

    // Respect the post-FX quality tier — ?postfx=off (or CONFIG.postfx.godRays=false)
    // disables god rays entirely, keeping the group hidden with zero per-frame cost.
    if (!_godRaysEnabled) {
        if (lightShaftGroupRef.visible) {
            lightShaftGroupRef.visible = false;
            _setShaftOpacity(0);
        }
        return;
    }

    let shaftOpacity = 0;
    let shaftVisible = false;

    if (_shaftIsGoldenHour && _shaftGoldenHourBase > 0.001) {
        shaftOpacity = _shaftGoldenHourBase + AtmosphereShaftState.beatShimmer;
        // Golden hour: ambient god rays fill the scene — no camera-frustum gate
        shaftVisible = shaftOpacity > 0.01;
    } else if (_shaftIsNightMode) {
        // Visual Impact: moonbeam cap — soft silver rays, not blinding
        shaftOpacity = Math.min(0.35, AtmosphereShaftState.musicOpacity + AtmosphereShaftState.beatShimmer);
        const strongMelody = AtmosphereShaftState.musicOpacity > 0.08;
        // Re-enable night light shafts by using the atmosphere state, avoiding the hardcoded false when beat/melody plays
        shaftVisible = (strongMelody || _celestialInView(_scratchSunVector) || AtmosphereShaftState.nightMoonbeam) && shaftOpacity > 0.01;
    } else if (AtmosphereShaftState.musicOpacity > 0.01) {
        shaftOpacity = Math.min(0.35, AtmosphereShaftState.musicOpacity + AtmosphereShaftState.beatShimmer);
        const strongMelody = AtmosphereShaftState.musicOpacity > 0.08;
        shaftVisible = strongMelody && shaftOpacity > 0.01;
    }

    lightShaftGroupRef.visible = shaftVisible;
    if (shaftVisible) {
        lightShaftGroupRef.rotation.z += delta * 0.1;
        _setShaftOpacity(Math.min(0.4, shaftOpacity));
    } else {
        _setShaftOpacity(0);
    }
}

/**
 * Drive Depth-of-Field focus + blend each frame (zero-alloc scalar math).
 * Engages near luminous / mycelium flora (or always, when manually enabled), with
 * the focal plane following the player's look distance toward that flora.
 * No-op unless DoF was built into the pipeline at boot.
 */
function _updateDepthOfField(delta: number): void {
    if (!_dofEnabled || !player?.position) return;

    const px = player.position.x;
    const pz = player.position.z;
    let nearest = Infinity;
    for (let i = 0; i < _DOF_FLORA_ZONES.length; i++) {
        const dx = px - _DOF_FLORA_ZONES[i][0];
        const dz = pz - _DOF_FLORA_ZONES[i][1];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearest) nearest = d;
    }

    const prox = CONFIG.postfx.dofProximity;
    // Proximity ramp: full DoF within (prox-2), fading out by (prox+6).
    const proxMix = 1.0 - THREE.MathUtils.smoothstep(nearest, prox - 2.0, prox + 6.0);

    // TSL Volumetric God Rays: boost DoF when shafts are highly visible
    const shaftBoost = uShaftOpacityRef ? (uShaftOpacityRef.value * 2.0) : 0.0;
    const combinedMix = THREE.MathUtils.clamp(proxMix + shaftBoost, 0.0, 1.0);

    const targetMix = _dofManual ? 1.0 : combinedMix;

    // Focus-follow: settle the focal plane on the flora we're approaching; otherwise rest.
    const targetFocus = CONFIG.postfx.dofFocusFollow
        ? THREE.MathUtils.clamp(nearest, 3.0, 40.0)
        : CONFIG.postfx.dofFocusDistance;

    // Frame-rate-independent smoothing toward targets.
    const k = 1.0 - Math.exp(-delta * 4.0);
    uDofMix.value += (targetMix - uDofMix.value) * k;
    uDofFocus.value += (targetFocus - uDofFocus.value) * k;
}

// addCameraShake re-exported from ./camera-shake.ts
export { addCameraShake };

export function getGameTime(): number {
    return gameTime;
}

export function getAudioState(): any {
    return audioState;
}

export function getBeatFlashIntensity(): number {
    return beatFlashIntensity;
}

export function animate() {
    if (!sceneRef || !cameraRef || !rendererRef || !postProcessingRef) return;

    profiler.startFrame();

    if (!_loggedWebGPULimits) {
        const limits = (rendererRef as WebGPURendererWithDeviceLimits).backend?.device?.limits;
        if (limits) {
            console.log(
                `[WebGPU] Buffer limits: maxUniformBufferBindingSize=${limits.maxUniformBufferBindingSize}, maxStorageBufferBindingSize=${limits.maxStorageBufferBindingSize}, maxBufferSize=${limits.maxBufferSize}`
            );
            _loggedWebGPULimits = true;
        }
    }

    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);

    audioState = profiler.measure('Audio', () => audioSystemRef!.update());
    profiler.measure('BeatSync', () => beatSyncRef!.update());

    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    gameTime += delta * timeFactor;

    // Update global shader time
    uTime.value = gameTime;

    const t = gameTime;

    const effectiveTime = t + timeOffsetRef.value;
    const cyclePos = effectiveTime % CYCLE_DURATION;

    profiler.measure('Weather', () => {
        weatherSystemRef!.update(t, audioState);
        weatherSystemRef!.updateBerrySeasonalSize(cyclePos);
    });

    profiler.measure('Interaction', () => {
        // Collect all interactive elements safely
        _interactionLists[0] = animatedFoliage || [];
        _interactionLists[1] = foliageMushrooms || [];
        _interactionLists[2] = foliageClouds || [];

        interactionSystemRef!.update(delta, cameraRef!.position, _interactionLists as any);
    });

    const activeBPM = audioState?.bpm || 120;
    const bpmWindFactor = THREE.MathUtils.clamp((activeBPM - 60) / 120, 0, 1.5);
    const baseWind = 1.0 + weatherSystemRef!.windSpeed * 4.0;
    const targetWindSpeed = baseWind * (1.0 + bpmWindFactor * 0.5);
    uWindSpeed.value = THREE.MathUtils.lerp(uWindSpeed.value, targetWindSpeed, 0.05);

    if (uWindDirection.value && weatherSystemRef?.windDirection) {
        uWindDirection.value.copy(weatherSystemRef.windDirection);
    }

    const currentBeatPhase = audioState?.beatPhase || 0;

    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            beatFlashIntensity = 0.5 + kickTrigger * 0.5;
            cameraZoomPulse = 2 + kickTrigger * 3;
        }
    }
    lastBeatPhase = currentBeatPhase;

    if (beatFlashIntensity > 0) {
        beatFlashIntensity *= 0.9;
        if (beatFlashIntensity < 0.01) beatFlashIntensity = 0;
    }
    if (cameraZoomPulse > 0) {
        cameraRef.fov = baseFOV - cameraZoomPulse;
        cameraRef.updateProjectionMatrix();
        cameraZoomPulse *= 0.85;
        if (cameraZoomPulse < 0.1) {
            cameraZoomPulse = 0;
            cameraRef.fov = baseFOV;
            cameraRef.updateProjectionMatrix();
        }
    }

    // Camera Shake Polish
    cameraRef.rotation.x -= currentShakeOffsetX;
    cameraRef.rotation.y -= currentShakeOffsetY;

    cameraShake = getCameraShake();
    if (cameraShake > 0) {
        cameraRef.rotation.z = (Math.random() - 0.5) * cameraShake * 0.1;

        currentShakeOffsetX = (Math.random() - 0.5) * cameraShake * 0.05;
        currentShakeOffsetY = (Math.random() - 0.5) * cameraShake * 0.05;

        cameraRef.rotation.x += currentShakeOffsetX;
        cameraRef.rotation.y += currentShakeOffsetY;

        cameraShake *= 0.85;
        setCameraShake(cameraShake);
        if (cameraShake < 0.01) {
            setCameraShake(0);
            currentShakeOffsetX = 0;
            currentShakeOffsetY = 0;
            cameraRef.rotation.z = 0;
        }
    } else {
        currentShakeOffsetX = 0;
        currentShakeOffsetY = 0;
    }

    const currentState = getCycleState(effectiveTime, weatherSystemRef!.targetPaletteMode || 'standard');

    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET;
    const isNightNow = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    // Reactive Theme Update
    if (isNightNow !== getLastIsNight()) {
        updateTheme(isNightNow);
        setLastIsNight(isNightNow);
    }
    setIsNight(isNightNow);
    circadianController.setDayTarget(!isNightNow);
    circadianController.update(delta);

    const weatherIntensity = weatherSystemRef!.getIntensity();
    const weatherState = weatherSystemRef!.getState();

    const baseSkyTop = _scratchBaseSkyTop.copy(currentState.skyTop);
    const baseSkyBot = _scratchBaseSkyBot.copy(currentState.skyBot);
    const baseFog = _scratchBaseFog.copy(currentState.fog);

    if (weatherState === WeatherState.STORM) {
        baseSkyTop.lerp(COLOR_STORM_SKY_TOP, weatherIntensity * 0.6);
        baseSkyBot.lerp(COLOR_STORM_SKY_BOT, weatherIntensity * 0.5);
        baseFog.lerp(COLOR_STORM_FOG, weatherIntensity * 0.4);
    } else if (weatherState === WeatherState.RAIN) {
        baseSkyTop.lerp(COLOR_RAIN, weatherIntensity * 0.3);
        baseSkyBot.lerp(COLOR_RAIN, weatherIntensity * 0.25);
        baseFog.lerp(COLOR_RAIN_FOG, weatherIntensity * 0.2);
    }

    uSkyTopColor.value.copy(baseSkyTop);
    uSkyBottomColor.value.copy(baseSkyBot);
    uHorizonColor.value.copy(currentState.horizon);
    uAtmosphereIntensity.value = currentState.atmosphereIntensity;
    sceneRef.fog!.color.copy(baseFog);

    const targetNear = isNightNow ? 5 : 20;
    const targetFar = isNightNow ? 40 : 100;
    (sceneRef.fog as any).near += (targetNear - (sceneRef.fog as any).near) * delta * 0.5;
    (sceneRef.fog as any).far += (targetFar - (sceneRef.fog as any).far) * delta * 0.5;

    let sunIntensity = currentState.sunInt;
    let ambIntensity = currentState.ambInt;

    if (weatherState === WeatherState.STORM) {
        sunIntensity *= (1 - weatherIntensity * 0.7);
        ambIntensity *= (1 - weatherIntensity * 0.5);
    } else if (weatherState === WeatherState.RAIN) {
        sunIntensity *= (1 - weatherIntensity * 0.3);
        ambIntensity *= (1 - weatherIntensity * 0.2);
    }

    sunLightRef!.color.copy(currentState.sun);
    sunLightRef!.intensity = sunIntensity;
    ambientLightRef!.color.copy(currentState.amb);
    ambientLightRef!.intensity = ambIntensity + beatFlashIntensity * 0.5;

    if (cyclePos < 540) {
        const sunProgress = cyclePos / 540;
        const angle = sunProgress * Math.PI;
        const r = 100;
        sunLightRef!.position.set(Math.cos(angle) * -r, Math.sin(angle) * r, 20);
        sunLightRef!.visible = true;
        sunGlowRef!.visible = true;
        sunCoronaRef!.visible = true;
        moonRef!.visible = false;

        _scratchSunVector.copy(sunLightRef!.position).normalize();
        _shaftIsNightMode = false;

        sunGlowRef.position.copy(_scratchSunVector).multiplyScalar(400);
        (sunGlowRef as any).lookAt(cameraRef.position);
        sunCoronaRef.position.copy(_scratchSunVector).multiplyScalar(390);
        (sunCoronaRef as any).lookAt(cameraRef.position);
        lightShaftGroupRef!.position.copy(_scratchSunVector).multiplyScalar(380);
        (lightShaftGroupRef as any).lookAt(cameraRef.position);

        let glowIntensity = 0.25;
        let coronaIntensity = 0.15;
        let shaftIntensity = 0.0;
        _shaftIsGoldenHour = false;
        _shaftGoldenHourBase = 0;

        if (sunProgress < 0.15) {
            const factor = 1.0 - (sunProgress / 0.15);
            glowIntensity = 0.25 + factor * 0.35;
            coronaIntensity = 0.15 + factor * 0.25;
            shaftIntensity = factor * 0.12;
            _shaftGoldenHourBase = shaftIntensity;
            _shaftIsGoldenHour = true;
            (sunGlowMatRef as any).color.setHex(0xFFB366);
            (coronaMatRef as any).color.setHex(0xFFD6A3);
        } else if (sunProgress > 0.85) {
            const factor = (sunProgress - 0.85) / 0.15;
            glowIntensity = 0.25 + factor * 0.45;
            coronaIntensity = 0.15 + factor * 0.35;
            shaftIntensity = factor * 0.18;
            _shaftGoldenHourBase = shaftIntensity;
            _shaftIsGoldenHour = true;
            (sunGlowMatRef as any).color.setHex(0xFF9966);
            (coronaMatRef as any).color.setHex(0xFFCC99);
        } else {
            (sunGlowMatRef as any).color.setHex(0xFFE599);
            (coronaMatRef as any).color.setHex(0xFFF4D6);
        }

        const shaftMat = lightShaftGroupRef!.userData?.shaftMaterial as THREE.MeshBasicMaterial | undefined;
        if (shaftMat?.color) shaftMat.color.setHex(0xFFE5A0);

        (sunGlowMatRef as any).opacity = glowIntensity;
        (coronaMatRef as any).opacity = coronaIntensity;
    } else {
        sunLightRef!.visible = false;
        sunGlowRef!.visible = false;
        sunCoronaRef!.visible = false;
        moonRef!.visible = true;

        _shaftIsGoldenHour = false;
        _shaftGoldenHourBase = 0;
        _shaftIsNightMode = true;

        const nightProgress = (cyclePos - 540) / (CYCLE_DURATION - 540);
        const moonAngle = nightProgress * Math.PI;
        const r = 90;
        moonRef.position.set(Math.cos(moonAngle) * -r, Math.sin(moonAngle) * r, -30);
        (moonRef as any).lookAt(0, 0, 0);

        if (lightShaftGroupRef && moonRef && cameraRef) {
            lightShaftGroupRef.position.copy(moonRef.position);
            lightShaftGroupRef.lookAt(cameraRef.position);
            _scratchSunVector.copy(moonRef.position).sub(cameraRef.position).normalize();
            const shaftMat = lightShaftGroupRef.userData?.shaftMaterial as THREE.MeshBasicMaterial | undefined;
            if (shaftMat?.color) shaftMat.color.setHex(0xC8E0FF);
        }
    }

    const progress = cyclePos / CYCLE_DURATION;
    let starOp = 0;
    const starDuskStart = 0.50;
    const starNightStart = 0.60;
    const starNightEnd = 0.90;
    const starDawnEnd = 0.98;

    if (progress >= starNightStart && progress <= starNightEnd) {
        starOp = 1.0;
    } else if (progress > starDuskStart && progress < starNightStart) {
        starOp = (progress - starDuskStart) / (starNightStart - starDuskStart);
    } else if (progress > starNightEnd && progress < starDawnEnd) {
        starOp = 1.0 - ((progress - starNightEnd) / (starDawnEnd - starNightEnd));
    }
    uStarOpacity.value = THREE.MathUtils.lerp(uStarOpacity.value, starOp * 0.95, delta * 2);

    const baseAuroraVis = starOp * 0.8;

    if (audioState) {
        const kick = audioState.kickTrigger || 0;
        uAudioLow.value = THREE.MathUtils.lerp(uAudioLow.value, kick, 0.2);

        let high = 0;
        let glitchTrigger = 0;

        if (audioState.channelData) {
            if (audioState.channelData.length > 5) {
                const ch5 = audioState.channelData[5].trigger || 0;
                const ch6 = audioState.channelData[6] ? (audioState.channelData[6].trigger || 0) : 0;
                high = Math.max(ch5, ch6);
            }

            for (const ch of audioState.channelData) {
                if (ch.activeEffect === 5 && ch.effectValue > 0) {
                    glitchTrigger = Math.max(glitchTrigger, ch.effectValue);
                }
            }
        }
        uAudioHigh.value = THREE.MathUtils.lerp(uAudioHigh.value, high, 0.2);

        if (glitchTrigger > 0) {
            uGlitchIntensity.value = glitchTrigger * 0.5;
        } else {
            uGlitchIntensity.value *= 0.8;
            if (uGlitchIntensity.value < 0.01) uGlitchIntensity.value = 0;
        }

        if (beatFlashIntensity > 0.4) {
            uChromaticIntensity.value = (beatFlashIntensity - 0.4) * 2.0;
        } else {
            uChromaticIntensity.value *= 0.85;
            if (uChromaticIntensity.value < 0.01) uChromaticIntensity.value = 0;
        }
    }

    let auroraAudioBoost = 0.0;
    if (audioState && audioState.channelData && audioState.channelData.length > 4) {
        auroraAudioBoost = audioState.channelData[4].trigger || 0;
    } else if (audioState) {
        auroraAudioBoost = (audioState.energy || 0) * 2.0;
    }

    const targetAuroraInt = baseAuroraVis * (0.3 + auroraAudioBoost * 0.7);
    uAuroraIntensity.value = THREE.MathUtils.lerp(uAuroraIntensity.value, targetAuroraInt, delta * 2);

    const hue = (t * 0.05) % 1.0;
    _scratchAuroraColor.setHSL(hue, 1.0, 0.5);
    if (beatFlashIntensity > 0.2) {
        _scratchAuroraColor.setHSL(0.8 + beatFlashIntensity * 0.1, 1.0, 0.6);
    }
    uAuroraColor.value.copy(_scratchAuroraColor);

    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';
    updateFoliageMaterials(audioState, isNightNow, weatherStateStr, weatherIntensity);
    if (cameraRef) {
        updateFoliageBatcherLOD(cameraRef, delta);
    }

    const deepNightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT;
    const deepNightEnd = deepNightStart + DURATION_DEEP_NIGHT;
    const isDeepNight = (cyclePos >= deepNightStart && cyclePos < deepNightEnd);

    const melodyRibbon = getMelodyRibbon();
    const fluidFog = getFluidFog();

    profiler.measure('MusicReact', () => {
            safeSystemUpdate(
                () => musicReactivitySystem.update(t, delta, audioState, weatherSystemRef!, cpuAnimatedFoliage, cameraRef!, isNightNow, isDeepNight),
                'musicReactivitySystem'
            );
            if (melodyRibbon) updateMelodyRibbons(melodyRibbon, delta, audioState);
            profiler.measure('Particles', () => {
                _scratchParticleAudioData.low = audioState?.kickTrigger || 0;
                _scratchParticleAudioData.mid = 0.3;
                _scratchParticleAudioData.high = audioState?.energy || 0;
                _scratchParticleAudioData.beat = (audioState?.beatPhase || 0) < 0.1;
                _scratchParticleAudioData.groove = audioState?.grooveAmount || 0;
                _scratchParticleAudioData.windX = weatherSystemRef!.windDirection.x;
                _scratchParticleAudioData.windZ = weatherSystemRef!.windDirection.z;
                _scratchParticleAudioData.windSpeed = weatherSystemRef!.state === WeatherState.STORM ? 0.8 : 0.2;

                safeSystemUpdate(
                    () => updateAllIntegratedSystems(rendererRef, delta, player.position, _scratchParticleAudioData),
                    'updateAllIntegratedSystems'
                );
            });

        if (fluidFog && audioState) {
            fluidSystem.update(delta, audioState);

            const gridX = ((player.position.x + 100) / 200) * 128;
            const gridY = ((player.position.z + 100) / 200) * 128;

            if (gridX >= 0 && gridX < 128 && gridY >= 0 && gridY < 128) {
                const speed = player.velocity.lengthSq();
                if (speed > 1.0) {
                    // ⚡ OPTIMIZATION: Linear approximation of velocity response avoids expensive Math.sqrt in hot loop
                    fluidSystem.addDensity(gridX, gridY, (speed * 0.2) * delta);
                    fluidSystem.addVelocity(gridX, gridY, player.velocity.x * delta, player.velocity.z * delta);
                }
            }
        }
    });

    applyMusicReactiveLightShafts(delta);
    _updateDepthOfField(delta);
    updateExploreCamera(delta);

    const exploreActive = isExploreActive();
    if (exploreActive && getExploreCamera()?.isHybrid()) {
        let forward = 0;
        let strafe = 0;
        if (keyStates.forward) forward += 1;
        if (keyStates.backward) forward -= 1;
        if (keyStates.left) strafe -= 1;
        if (keyStates.right) strafe += 1;
        getExploreCamera()?.panTargetXZ(forward, strafe, delta);
    }

    if (firefliesRef) {
        firefliesRef.visible = isDeepNight;
    }

    if (!(window as any).__computeDisabled) {
        try {
            const windComputeNode = windComputeSystem.getComputeNode();
            if (windComputeNode) {
                rendererRef.compute(windComputeNode);
            }

            if (harmonyOrbSystem.computeNode) {
                rendererRef.compute(harmonyOrbSystem.computeNode);
            }

            for (const obj of animatedFoliage) {
                if (obj.userData.computeNode) {
                    if (obj.userData.type === 'waterfall' || obj.userData.isPollen) {
                        rendererRef.compute(obj.userData.computeNode);
                    }
                }
            }
        } catch (err) {
            console.error('[Compute] Runtime dispatch failed:', err);
            console.warn('[Compute] Disabling compute passes for remainder of session');
            (window as any).__computeDisabled = true;
        }
    }
    updateImpacts(rendererRef, t);
    updateDandelionSeeds(rendererRef);

    const sparkleTrail = getSparkleTrail();
    let playerShieldMesh = getPlayerShieldMesh();

    profiler.measure('Physics', () => {
        const devOrbitActive = exploreActive;
        if (!devOrbitActive) {
            updatePhysics(delta, cameraRef!, controlsRef, keyStates, audioState);
        }
        // Safety check: ensure player position is valid before copying
        if (player.position && uPlayerPosition.value) {
            uPlayerPosition.value.copy(devOrbitActive ? cameraRef!.position : player.position);
        }
        if (sparkleTrail && player.position && player.velocity) {
            updateSparkleTrail(sparkleTrail, player.position, player.velocity, gameTime, rendererRef);
        }

        if (unlockSystem.isUnlocked('arpeggio_shield')) {
            if (!playerShieldMesh) {
                playerShieldMesh = createShield();
                sceneRef!.add(playerShieldMesh);
                (player as any).hasShield = true;
                setPlayerShieldMesh(playerShieldMesh);
                console.log('[Shield] Activated Arpeggio Shield');
            }
            if (playerShieldMesh) {
                playerShieldMesh.position.copy(player.position);
                playerShieldMesh.position.y += 1.0;
            }
        }
    });

    const harpoonLine = getHarpoonLine();

    profiler.measure('Gameplay', () => {
        if (exploreActive) {
            updateHUD({
                player: {
                    energy: player.energy,
                    maxEnergy: player.maxEnergy,
                    dashCooldown: (player as any).dashCooldown || 0,
                    isPhasing: (player as any).isPhasing || false,
                    phaseTimer: (player as any).phaseTimer || 0
                },
                audioState,
                delta
            });
            return;
        }

        updateFallingBerries(delta, rendererRef);
        const berriesCollected = collectFallingBerries(cameraRef!.position, 1.5);

        if (harpoonLine) {
            updateHarpoonLine(harpoonLine, player.position, player.harpoon.anchor, player.harpoon.active);
        }
        if (berriesCollected > 0) {
            player.energy = Math.min(player.maxEnergy, player.energy + berriesCollected * 0.5);
        }
        player.energy = Math.max(0, player.energy - delta * 0.1);

        updateBlaster(delta, sceneRef!, weatherSystemRef!, t, rendererRef);

        jitterMineSystem.update(delta, player.position);
        if (keyStates.action) {
            jitterMineSystem.spawnMine(player.position);
        }

        glitchGrenadeSystem.update(delta, sceneRef!, rendererRef);

        const isStrikePressed = keyStates.strike;
        const isStrikeTriggered = isStrikePressed && !getLastStrikeState();

        if (isStrikeTriggered) {
            chordStrikeSystem.fire(player.position);
        }
        setLastStrikeState(isStrikePressed);

        chordStrikeSystem.update(delta, sceneRef!, player);

        harmonyOrbSystem.update(delta, audioState, player.position);

        safeSystemUpdate(
            () => updateFallingClouds(delta, foliageClouds, getGroundHeight),
            'updateFallingClouds'
        );
        safeUpdateBatcher(CloudBatcher.getInstance(), delta, 'CloudBatcher');
        safeUpdateBatcher(CloudBatcher.getWalkableInstance(), delta, 'CloudBatcherWalkable');

        // Update HUD
        updateHUD({
            player: {
                energy: player.energy,
                maxEnergy: player.maxEnergy,
                dashCooldown: (player as any).dashCooldown || 0,
                isPhasing: (player as any).isPhasing || false,
                phaseTimer: (player as any).phaseTimer || 0
            },
            audioState,
            delta
        });
    });

    // uBloomStrength is driven by atmosphere-reactivity.ts (also synced to WebGL bloom in post-processing render).
    profiler.measure('Render', () => postProcessingRef.render());

    profiler.endFrame();
}

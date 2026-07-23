import * as THREE from 'three';
import { WeatherSystem } from '../systems/weather.ts';
import { InteractionSystem } from '../systems/interaction.ts';
import { AudioSystem } from '../audio/audio-system.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import { initGroundDebug } from '../debug/ground-debug.ts';
import { initPlacementDebug } from '../debug/debug-place.ts';
import { initCircadianDebug } from '../debug/circadian-debug.ts';
import { CONFIG } from './config.ts';
import { getCameraShake } from './camera-shake.ts';

export type ParticleAudioData = {
    low: number;
    mid: number;
    high: number;
    beat: boolean;
    groove: number;
    windX: number;
    windZ: number;
    windSpeed: number;
};

export const _scratchParticleAudioData: ParticleAudioData = {
    low: 0,
    mid: 0,
    high: 0,
    beat: false,
    groove: 0,
    windX: 0,
    windZ: 0,
    windSpeed: 0
};

export function safeUpdateBatcher(batcher: any, delta: number, label = 'batcher') {
    if (batcher && typeof batcher.update === 'function') {
        try {
            batcher.update(delta);
        } catch (err) {
            console.warn(`[GameLoop] Skipped update on ${label} (likely empty or incomplete in Core mode)`, err);
        }
    }
}

export function safeSystemUpdate(updateFn: any, label: string, ...args: any[]) {
    if (typeof updateFn !== 'function') return;
    try {
        updateFn(...args);
    } catch (err) {
        console.warn(`[GameLoop] Skipped ${label} update in Core mode`, err);
    }
}

export let gameTime = 0;
export function setGameTime(v: number) { gameTime = v; }

export let audioState: any = null;
export function setAudioState(v: any) { audioState = v; }

export let lastBeatPhase = 0;
export function setLastBeatPhase(v: number) { lastBeatPhase = v; }

export let beatFlashIntensity = 0;
export function setBeatFlashIntensity(v: number) { beatFlashIntensity = v; }

export let cameraZoomPulse = 0;
export function setCameraZoomPulse(v: number) { cameraZoomPulse = v; }

export let cameraShake = getCameraShake();
export function setCameraShakeCore(v: number) { cameraShake = v; }

export let currentShakeOffsetX = 0;
export function setCurrentShakeOffsetX(v: number) { currentShakeOffsetX = v; }

export let currentShakeOffsetY = 0;
export function setCurrentShakeOffsetY(v: number) { currentShakeOffsetY = v; }

export const baseFOV = 75;

export const COLOR_STORM_SKY_TOP = new THREE.Color(0x1A1A2E);
export const COLOR_STORM_SKY_BOT = new THREE.Color(0x2E3A59);
export const COLOR_STORM_FOG = new THREE.Color(0x4A5568);
export const COLOR_RAIN = new THREE.Color(0xA0B5C8);
export const COLOR_RAIN_FOG = new THREE.Color(0xC0D0E0);

// Day/night sky palette endpoints (module-scope — never allocate inside the tick).
export const COLOR_NIGHT_SKY_TOP = new THREE.Color(0x1a2436);
export const COLOR_NIGHT_SKY_BOT = new THREE.Color(0x0a1128);
export const COLOR_NIGHT_FOG = new THREE.Color(0x0a1128);
export const COLOR_DAY_SKY_TOP = new THREE.Color(0x87CEEB);
export const COLOR_DAY_SKY_BOT = new THREE.Color(0xE0F6FF);
export const COLOR_DAY_FOG = new THREE.Color(0xE0F6FF);
export const COLOR_SUNRISE_SKY_BOT = new THREE.Color(0xFFA07A);
export const COLOR_SUNRISE_FOG = new THREE.Color(0xDDA0DD);
export const COLOR_SUNSET_SKY_TOP = new THREE.Color(0x483D8B);
export const COLOR_SUNSET_SKY_BOT = new THREE.Color(0xFF7F50);
export const COLOR_SUNSET_FOG = new THREE.Color(0xFFB6C1);
export const COLOR_DEEP_NIGHT_SKY_TOP = new THREE.Color(0x0f172a);
export const COLOR_DEEP_NIGHT_SKY_BOT = new THREE.Color(0x020617);
export const COLOR_DEEP_NIGHT_FOG = new THREE.Color(0x020617);

export const _scratchBaseSkyTop = new THREE.Color();
export const _scratchBaseSkyBot = new THREE.Color();
export const _scratchBaseFog = new THREE.Color();
export const _scratchSunVector = new THREE.Vector3();
export const _scratchLightDir = new THREE.Vector3();
export const _scratchNormalizedSunDir = new THREE.Vector3();
export const _scratchMoonVector = new THREE.Vector3();
export const _shadowLightView = new THREE.Vector3();
export const _shadowSnap = new THREE.Vector3();

export let _shadowSnapCellX = Number.NaN;
export function setShadowSnapCellX(v: number) { _shadowSnapCellX = v; }

export let _shadowSnapCellZ = Number.NaN;
export function setShadowSnapCellZ(v: number) { _shadowSnapCellZ = v; }

export const _scratchAuroraColor = new THREE.Color();
export const _scratchCameraForward = new THREE.Vector3();

export let _shaftGoldenHourBase = 0;
export function setShaftGoldenHourBase(v: number) { _shaftGoldenHourBase = v; }

export let _shaftIsGoldenHour = false;
export function setShaftIsGoldenHour(v: boolean) { _shaftIsGoldenHour = v; }

export let _shaftIsNightMode = false;
export function setShaftIsNightMode(v: boolean) { _shaftIsNightMode = v; }

export const _SHAFT_FRUSTUM_DOT = CONFIG.postfx.shaftFrustumDot;
export const _SHAFT_OPACITY_CAP = CONFIG.postfx.shaftOpacityCap;

export const _DOF_FLORA_ZONES: ReadonlyArray<readonly [number, number]> = [
    [-40, 40],  // Melody Lake luminous plants
    [-78, 78],  // Luminous Mycelium grove (glass mushrooms)
    [100, -80], // Gem Canopy jewel corridor
];

export const _interactionLists: (any[] | null)[] = [null, null, null];

export let sceneRef: THREE.Scene | null = null;
export let cameraRef: THREE.PerspectiveCamera | null = null;
export let rendererRef: any = null;
export let postProcessingRef: any = null;
export let weatherSystemRef: WeatherSystem | null = null;
export let audioSystemRef: AudioSystem | null = null;
export let beatSyncRef: BeatSync | null = null;
export let interactionSystemRef: InteractionSystem | null = null;
export let moonRef: THREE.Object3D | null = null;
export let firefliesRef: THREE.Object3D | null = null;
export let controlsRef: any = null;
export let sunLightRef: THREE.DirectionalLight | null = null;
export let ambientLightRef: THREE.AmbientLight | THREE.HemisphereLight | null = null;
export let sunGlowRef: THREE.Object3D | null = null;
export let sunCoronaRef: THREE.Object3D | null = null;
export let lightShaftGroupRef: THREE.Object3D | null = null;
export let sunGlowMatRef: THREE.Material | null = null;
export let coronaMatRef: THREE.Material | null = null;
export let uShaftOpacityRef: { value: number } | null = null;
export let timeOffsetRef: { value: number } = { value: 0 };

export let _loggedWebGPULimits = false;
export function setLoggedWebGPULimits(v: boolean) { _loggedWebGPULimits = v; }

export type WebGPURendererWithDeviceLimits = THREE.Renderer & {
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

    initGroundDebug(deps.scene);
    initPlacementDebug(deps.scene, deps.camera);
    initCircadianDebug({
        timeOffset: deps.timeOffset,
        getGameTime: () => gameTime,
    });
}

export function getGameTime(): number {
    return gameTime;
}

export function getAudioState(): any {
    return audioState;
}

export function getBeatFlashIntensity(): number {
    return beatFlashIntensity;
}

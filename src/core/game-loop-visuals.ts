import * as THREE from 'three';
import { WeatherState } from '../systems/weather-types.ts';
import { updateTheme, getLastIsNight, setLastIsNight, setIsNight } from './hud.ts';
import { getDayNightBias } from './cycle.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { DURATION_SUNRISE, DURATION_DAY, DURATION_SUNSET, DURATION_DUSK_NIGHT, DURATION_DEEP_NIGHT } from './config.ts';
import {
    uWindSpeed, uWindDirection, uAudioLow, uAudioHigh, uGlitchIntensity, uTime,
} from '../foliage/index.ts';
import { uSkyTopColor, uSkyBottomColor, uHorizonColor, uAtmosphereIntensity } from '../foliage/sky.ts';
import { uStarOpacity } from '../foliage/stars.ts';
import { uAuroraIntensity, uAuroraColor } from '../foliage/aurora.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { circadianController } from '../systems/circadian-controller.ts';
import { updateCircadianDebug, isCircadianDebugEnabled } from '../debug/circadian-debug.ts';
import {
    _scratchBaseSkyTop, _scratchBaseSkyBot, _scratchBaseFog,
    COLOR_STORM_SKY_TOP, COLOR_STORM_SKY_BOT, COLOR_STORM_FOG, COLOR_RAIN, COLOR_RAIN_FOG,
    COLOR_NIGHT_SKY_TOP, COLOR_NIGHT_SKY_BOT, COLOR_NIGHT_FOG,
    COLOR_DAY_SKY_TOP, COLOR_DAY_SKY_BOT, COLOR_DAY_FOG,
    COLOR_SUNRISE_SKY_BOT, COLOR_SUNRISE_FOG,
    COLOR_SUNSET_SKY_TOP, COLOR_SUNSET_SKY_BOT, COLOR_SUNSET_FOG,
    COLOR_DEEP_NIGHT_SKY_TOP, COLOR_DEEP_NIGHT_SKY_BOT, COLOR_DEEP_NIGHT_FOG,
    _scratchSunVector, _scratchLightDir, _scratchNormalizedSunDir, _scratchMoonVector, _scratchAuroraColor,
    sceneRef, weatherSystemRef, sunLightRef, ambientLightRef,
    sunGlowRef, sunCoronaRef, sunGlowMatRef, coronaMatRef, moonRef, timeOffsetRef,
    setShaftIsGoldenHour, setShaftIsNightMode, setShaftGoldenHourBase
} from './game-loop-core.ts';
import { updateSunShadowFollow } from './game-loop-postfx.ts';

export function updateVisualsPhase(delta: number, t: number, gameTime: number, audioState: any, beatFlashIntensity: number, _exploreActive: boolean, _playerPos: THREE.Vector3) {
    const cyclePos = (gameTime + timeOffsetRef.value) % (DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT + DURATION_DEEP_NIGHT);
    const dayNightBias = getDayNightBias(gameTime + timeOffsetRef.value);

    const isNightNow = cyclePos >= (DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET);
    setIsNight(isNightNow);
    if (isNightNow !== getLastIsNight()) {
        updateTheme(isNightNow);
        setLastIsNight(isNightNow);
    }

    circadianController.setDayTarget(!isNightNow);
    circadianController.update(delta);

    if (isCircadianDebugEnabled()) {
        updateCircadianDebug(dayNightBias);
    }

    let weatherState = WeatherState.CLEAR;
    let weatherIntensity = 0;
    if (weatherSystemRef) {
        weatherSystemRef.update(t, audioState);
        weatherSystemRef.updateBerrySeasonalSize(cyclePos);
        weatherState = weatherSystemRef.state;
        weatherIntensity = weatherSystemRef.intensity;

        const activeBPM = audioState?.bpm || 120;
        const bpmWindFactor = THREE.MathUtils.clamp((activeBPM - 60) / 120, 0, 1.5);
        const baseWind = 1.0 + weatherSystemRef.windSpeed * 4.0;
        const targetWindSpeed = baseWind * (1.0 + bpmWindFactor * 0.5);
        uWindSpeed.value = THREE.MathUtils.lerp(uWindSpeed.value as number, targetWindSpeed, 0.05);

        if (uWindDirection.value && weatherSystemRef.windDirection) {
            (uWindDirection.value as any).copy(weatherSystemRef.windDirection);
        }
    }

    if (sceneRef && sceneRef.fog instanceof THREE.FogExp2) {
        let baseDens = isNightNow ? 0.003 : 0.002;
        if (weatherState === WeatherState.STORM) {
            baseDens = THREE.MathUtils.lerp(baseDens, 0.008, weatherIntensity);
        } else if (weatherState === WeatherState.RAIN) {
            baseDens = THREE.MathUtils.lerp(baseDens, 0.005, weatherIntensity);
        }
        sceneRef.fog.density = THREE.MathUtils.lerp(sceneRef.fog.density, baseDens, delta);
    }

    _scratchBaseSkyTop.copy(COLOR_NIGHT_SKY_TOP);
    _scratchBaseSkyBot.copy(COLOR_NIGHT_SKY_BOT);
    _scratchBaseFog.copy(COLOR_NIGHT_FOG);

    if (cyclePos < DURATION_SUNRISE) {
        const p = cyclePos / DURATION_SUNRISE;
        _scratchBaseSkyTop.lerpColors(COLOR_NIGHT_SKY_TOP, COLOR_DAY_SKY_TOP, p);
        _scratchBaseSkyBot.lerpColors(COLOR_NIGHT_SKY_BOT, COLOR_SUNRISE_SKY_BOT, p);
        _scratchBaseFog.lerpColors(COLOR_NIGHT_FOG, COLOR_SUNRISE_FOG, p);
    } else if (cyclePos < DURATION_SUNRISE + DURATION_DAY) {
        _scratchBaseSkyTop.copy(COLOR_DAY_SKY_TOP);
        _scratchBaseSkyBot.copy(COLOR_DAY_SKY_BOT);
        _scratchBaseFog.copy(COLOR_DAY_FOG);
    } else if (cyclePos < DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET) {
        const p = (cyclePos - (DURATION_SUNRISE + DURATION_DAY)) / DURATION_SUNSET;
        _scratchBaseSkyTop.lerpColors(COLOR_DAY_SKY_TOP, COLOR_SUNSET_SKY_TOP, p);
        _scratchBaseSkyBot.lerpColors(COLOR_DAY_SKY_BOT, COLOR_SUNSET_SKY_BOT, p);
        _scratchBaseFog.lerpColors(COLOR_DAY_FOG, COLOR_SUNSET_FOG, p);
    } else {
        _scratchBaseSkyTop.copy(COLOR_DEEP_NIGHT_SKY_TOP);
        _scratchBaseSkyBot.copy(COLOR_DEEP_NIGHT_SKY_BOT);
        _scratchBaseFog.copy(COLOR_DEEP_NIGHT_FOG);
    }

    if (weatherState === WeatherState.STORM) {
        _scratchBaseSkyTop.lerp(COLOR_STORM_SKY_TOP, weatherIntensity);
        _scratchBaseSkyBot.lerp(COLOR_STORM_SKY_BOT, weatherIntensity);
        _scratchBaseFog.lerp(COLOR_STORM_FOG, weatherIntensity);
    } else if (weatherState === WeatherState.RAIN) {
        _scratchBaseSkyTop.lerp(COLOR_RAIN, weatherIntensity * 0.5);
        _scratchBaseSkyBot.lerp(COLOR_RAIN_FOG, weatherIntensity * 0.5);
        _scratchBaseFog.lerp(COLOR_RAIN_FOG, weatherIntensity);
    }

    const tslSkyTop = (uSkyTopColor.value as unknown) as THREE.Color;
    const tslSkyBot = (uSkyBottomColor.value as unknown) as THREE.Color;
    const tslHorizon = (uHorizonColor.value as unknown) as THREE.Color;
    tslSkyTop.copy(_scratchBaseSkyTop);
    tslSkyBot.copy(_scratchBaseSkyBot);
    tslHorizon.copy(_scratchBaseFog);

    if (sceneRef && sceneRef.fog instanceof THREE.FogExp2) {
        sceneRef.fog.color.copy(_scratchBaseFog);
        if (sceneRef.background instanceof THREE.Color) {
            sceneRef.background.copy(_scratchBaseFog);
        }
    }

    const timeOfDay = Math.PI * 2 * (cyclePos / (DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT + DURATION_DEEP_NIGHT));
    _scratchSunVector.set(Math.cos(timeOfDay - Math.PI / 2), Math.sin(timeOfDay - Math.PI / 2), 0.5).normalize();
    _scratchLightDir.copy(_scratchSunVector).multiplyScalar(-1);

    if (sunLightRef) {
        const isSunUp = _scratchSunVector.y > -0.2;
        sunLightRef.intensity = isSunUp ? THREE.MathUtils.lerp(0, 1.5, (_scratchSunVector.y + 0.2) / 0.4) : 0;
        if (weatherState === WeatherState.STORM) {
            sunLightRef.intensity *= (1.0 - weatherIntensity * 0.8);
        } else if (weatherState === WeatherState.RAIN) {
            sunLightRef.intensity *= (1.0 - weatherIntensity * 0.4);
        }

        _scratchNormalizedSunDir.copy(_scratchSunVector).normalize();
        updateSunShadowFollow(sunLightRef, _playerPos, _scratchNormalizedSunDir);
    }

    if (ambientLightRef) {
        if (ambientLightRef instanceof THREE.HemisphereLight) {
            ambientLightRef.color.copy(_scratchBaseSkyTop);
            ambientLightRef.groundColor.copy(_scratchBaseFog).multiplyScalar(0.5);
            ambientLightRef.intensity = isNightNow ? 0.3 : 0.6;
        } else {
            ambientLightRef.color.copy(_scratchBaseSkyTop);
            ambientLightRef.intensity = isNightNow ? 0.2 : 0.5;
        }
    }

    // Null-safe celestial billboards (sunGlow / moon may be unset before initGameLoopDependencies).
    if (sunGlowRef) {
        sunGlowRef.position.copy(_scratchSunVector).multiplyScalar(400);
        sunGlowRef.lookAt(0, 0, 0);
        sunGlowRef.visible = _scratchSunVector.y > -0.1;
        if (sunGlowMatRef && 'opacity' in sunGlowMatRef) {
            (sunGlowMatRef as THREE.Material & { opacity: number }).opacity =
                THREE.MathUtils.lerp(0, 0.8, (_scratchSunVector.y + 0.1) / 0.2);
        }
    }

    if (sunCoronaRef) {
        sunCoronaRef.position.copy(_scratchSunVector).multiplyScalar(390);
        sunCoronaRef.lookAt(0, 0, 0);
        sunCoronaRef.visible = _scratchSunVector.y > -0.05;
        if (coronaMatRef && 'opacity' in coronaMatRef) {
            (coronaMatRef as THREE.Material & { opacity: number }).opacity =
                THREE.MathUtils.lerp(0, 0.5, (_scratchSunVector.y + 0.05) / 0.15);
        }
    }

    if (moonRef) {
        _scratchMoonVector.set(-_scratchSunVector.x, -_scratchSunVector.y, -_scratchSunVector.z);
        moonRef.position.copy(_scratchMoonVector).multiplyScalar(350);
        moonRef.lookAt(0, 0, 0);
        moonRef.visible = isNightNow;
    }

    setShaftIsGoldenHour(_scratchSunVector.y > 0.0 && _scratchSunVector.y < 0.35);
    setShaftIsNightMode(isNightNow);
    let ghBase = 0;
    if (_scratchSunVector.y > 0.0 && _scratchSunVector.y < 0.35) {
        ghBase = Math.sin((_scratchSunVector.y / 0.35) * Math.PI) * 0.15;
    }
    setShaftGoldenHourBase(ghBase);

    (uTime.value as number) = t;
    (uAudioLow.value as number) = audioState?.kickTrigger || 0;
    (uAudioHigh.value as number) = audioState?.energy || 0;
    uAtmosphereIntensity.value = weatherIntensity;

    const baseStarVis = THREE.MathUtils.clamp(-_scratchSunVector.y * 2.0, 0.0, 1.0);
    uStarOpacity.value = baseStarVis * (1.0 - weatherIntensity * 0.9);

    const baseAuroraVis = isNightNow ? THREE.MathUtils.clamp(-_scratchSunVector.y, 0.0, 1.0) * (1.0 - weatherIntensity) : 0;

    if (BiomeUniforms && (BiomeUniforms as any).glitch_woods && (BiomeUniforms as any).glitch_woods.shimmer && (BiomeUniforms as any).glitch_woods.shimmer.value) {
        let glitchTrigger = audioState?.kickTrigger || 0;
        if (glitchTrigger > 0.5) {
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
    (uAuroraColor.value as any).copy(_scratchAuroraColor);

    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';

    // Foliage materials / batcher LOD run in updateFoliagePhase (game-loop-foliage.ts).
    return {
        cyclePos, isNightNow, weatherStateStr, weatherIntensity, dayNightBias
    };
}

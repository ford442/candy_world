// src/systems/weather/weather-atmosphere.ts
// Atmospheric effects: fog, lighting, wind, twilight, lightning

import * as THREE from 'three';
import { WeatherState } from '../weather-types.ts';
import { CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY, DURATION_SUNSET, DURATION_PRE_DAWN, CONFIG } from '../../core/config.ts';
import { uSkyDarkness, uTwilight, uCrescendoFogDensity, uFogNear, uFogFar } from '../../foliage/sky.ts';
import { chargeBerries, shakeBerriesLoose, updateGlobalBerryScale } from '../../foliage/berries.ts';
import type { VisualState } from '../../audio/audio-system.ts';
import type { WeatherSystem } from './weather.ts';


// Scratch objects
const _scratchBlack = new THREE.Color(0x000000);

export class AtmosphereManager {
    private weatherSystem: WeatherSystem;

    constructor(weatherSystem: WeatherSystem) {
        this.weatherSystem = weatherSystem;
    }

    /**
     * Get global light level based on celestial and seasonal state
     */
    getGlobalLightLevel(celestial: any, seasonal: any): number {
        const sun = celestial.sunIntensity * (seasonal ? seasonal.sunInclination : 1.0);
        const moon = celestial.moonIntensity * (seasonal ? seasonal.moonPhase : 1.0) * 0.25;
        const stars = 0.05;
        const cloudCover = this.weatherSystem.cloudDensity;
        const totalLight = (sun + moon + stars) * (1.0 - (cloudCover * 0.8));
        return Math.min(1.0, totalLight);
    }

    /**
     * Returns 0.0 (Day), ramp to 1.0 (Night), ramp down to 0.0 (Day)
     */
    getTwilightGlowIntensity(cyclePos: number): number {
        const sunsetStart = DURATION_SUNRISE + DURATION_DAY;
        const sunsetEnd = sunsetStart + DURATION_SUNSET;

        const twilightStart = sunsetStart - 30; // Start glowing 30s before sunset starts
        const nightStart = sunsetEnd;

        // Simple logic:
        // 1. If Day (Sunrise -> Sunset-30s): 0
        // 2. If Transition (Sunset-30s -> SunsetEnd): Ramp 0->1
        // 3. If Night (SunsetEnd -> PreDawn): 1
        // 4. If Dawn (PreDawn -> Sunrise): Ramp 1->0

        if (cyclePos < twilightStart && cyclePos > DURATION_SUNRISE) return 0.0; // Day

        if (cyclePos >= twilightStart && cyclePos < nightStart) {
            // Ramp Up
            const duration = nightStart - twilightStart;
            return (cyclePos - twilightStart) / duration;
        }

        if (cyclePos >= nightStart && cyclePos < CYCLE_DURATION - DURATION_SUNRISE) {
            // Night (roughly) - Check for pre-dawn fade
            const dawnStart = CYCLE_DURATION - DURATION_PRE_DAWN;

            if (cyclePos >= dawnStart) {
                // Ramp Down
                const progress = (cyclePos - dawnStart) / DURATION_PRE_DAWN;
                return 1.0 - progress;
            }

            return 1.0; // Full Night Glow
        }

        // Sunrise buffer
        if (cyclePos < DURATION_SUNRISE) {
            return 0.0;
        }

        return 0.0;
    }

    /**
     * Simple helper for other systems
     */
    isNight(lastTwilightProgress: number): boolean {
        return lastTwilightProgress > 0.5;
    }

    /**
     * Apply darkness logic based on celestial state
     */
    applyDarknessLogic(celestial: any, moonPhase: number): void {
        const scene = this.weatherSystem.scene;
        const cloudDensity = this.weatherSystem.cloudDensity;
        
        const nightFactor = celestial.moonIntensity;
        const densityFactor = cloudDensity;
        const moonDarkness = 1.0 - (moonPhase || 0) * 0.5;
        const darkness = nightFactor * densityFactor * moonDarkness * 0.95;

        if (scene.fog && (scene.fog as THREE.Fog).color) {
            (scene.fog as THREE.Fog).color.lerp(_scratchBlack, darkness);
        }
        if (uSkyDarkness) uSkyDarkness.value = darkness;
        this.weatherSystem.darknessFactor = darkness;
    }

    /**
     * Update fog based on weather state and audio
     */
    updateFog(audioData: VisualState, state: WeatherState, intensity: number, darknessFactor: number, baseFogNear: number, baseFogFar: number, weatherType: string, fog: THREE.Fog | THREE.FogExp2 | null): void {
        if (!fog) return;

        let fogMultiplier = 1.0;
        let nearModifier = 1.0;

        switch (state) {
            case WeatherState.RAIN: fogMultiplier = 0.8; break;
            case WeatherState.STORM: fogMultiplier = 0.6; break;
            default: fogMultiplier = 1.0;
        }

        // Special Fog Types (Time-of-Day)
        if (weatherType === 'mist') {
            // Mist is dense but bright. Pull 'near' closer.
            nearModifier = 0.3;
        } else if (weatherType === 'drizzle') {
             // Drizzle slightly closer
             nearModifier = 0.8;
        }

        let crescendoFactor = 0;
        if (audioData && audioData.channelData && audioData.channelData.length > 0) {
            let totalVolume = 0;
            for (let i = 0; i < audioData.channelData.length; i++) {
                totalVolume += audioData.channelData[i].volume;
            }
            const averageVolume = totalVolume / audioData.channelData.length;
            crescendoFactor = Math.min(1.0, averageVolume * 0.5);
        }

        // TSL Crescendo Fog Update
        if (uCrescendoFogDensity) {
            // Smoothly interpolate to new crescendo factor to avoid sudden jumps
            const currentDensity = uCrescendoFogDensity.value as number;
            uCrescendoFogDensity.value = currentDensity + (crescendoFactor - currentDensity) * 0.1;
        }

        const weatherVisibility = (1.0 - intensity * (1.0 - fogMultiplier));
        const darknessVisibility = (1.0 - (darknessFactor || 0) * 0.7);
        const crescendoVisibility = (1.0 - crescendoFactor);

        const totalVisibility = weatherVisibility * darknessVisibility * crescendoVisibility;

        const targetNear = (baseFogNear * nearModifier) * totalVisibility;
        const targetFar = baseFogFar * totalVisibility;

        // Update TSL Fog Global Limits
        if (uFogNear && uFogFar) {
            const curNear = uFogNear.value as number;
            const curFar = uFogFar.value as number;
            uFogNear.value = curNear + (targetNear - curNear) * 0.05;
            uFogFar.value = curFar + (targetFar - curFar) * 0.05;
        }

        // Keep standard THREE.Fog fallback updated
        if (fog instanceof THREE.Fog) {
            fog.near += (targetNear - fog.near) * 0.05;
            fog.far += (targetFar - fog.far) * 0.05;
        }
    }

    /**
     * Update berry seasonal size based on cycle position
     */
    updateBerrySeasonalSize(cyclePos: number): void {
        const SUNRISE = 60, DAY = 420, SUNSET = 60, DUSK = 180, DEEP = 120, PREDAWN = 120;
        let phase = 'day';
        let phaseProgress = 0;

        if (cyclePos < SUNRISE) {
            phase = 'sunrise';
            phaseProgress = cyclePos / SUNRISE;
        } else if (cyclePos < SUNRISE + DAY) {
            phase = 'day';
            phaseProgress = (cyclePos - SUNRISE) / DAY;
        } else if (cyclePos < SUNRISE + DAY + SUNSET) {
            phase = 'sunset';
            phaseProgress = (cyclePos - SUNRISE - DAY) / SUNSET;
        } else if (cyclePos < SUNRISE + DAY + SUNSET + DUSK) {
            phase = 'dusk';
            phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET) / DUSK;
        } else if (cyclePos < SUNRISE + DAY + SUNSET + DUSK + DEEP) {
            phase = 'deepNight';
            phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET - DUSK) / DEEP;
        } else {
            phase = 'preDawn';
            phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET - DUSK - DEEP) / PREDAWN;
        }

        // Update global uniform that all berry shaders read
        updateGlobalBerryScale(phase, phaseProgress);
    }

    /**
     * Update wind physics and direction
     */
    updateWind(
        time: number,
        audioData: VisualState,
        celestial: any,
        windDirection: THREE.Vector3,
        windSpeed: number,
        windTargetSpeed: number,
        trackedMushrooms: any[]
    ): { windDirection: THREE.Vector3; windSpeed: number; windTargetSpeed: number } {
        const channels = audioData.channelData || [];
        const highFreqVol = (channels[3] as any)?.volume || 0;
        const melodyVol = (channels[2] as any)?.volume || 0;

        windTargetSpeed = Math.max(highFreqVol, melodyVol * 0.5);
        windSpeed += (windTargetSpeed - windSpeed) * 0.02;

        const rotSpeed = (audioData.beatPhase || 0) * 0.001;
        
        // Apply rotation around Y axis
        const x = windDirection.x;
        const z = windDirection.z;
        const cos = Math.cos(rotSpeed);
        const sin = Math.sin(rotSpeed);
        windDirection.x = x * cos - z * sin;
        windDirection.z = x * sin + z * cos;

        const dayProgress = (time % CYCLE_DURATION) / CYCLE_DURATION;
        const sunAngle = dayProgress * Math.PI * 2;
        const sunDirX = Math.cos(sunAngle);
        const sunDirY = Math.sin(sunAngle);
        
        // Lerp towards celestial force (opposite sun direction)
        windDirection.x += (sunDirX * -1 - windDirection.x) * 0.1;
        windDirection.y += (sunDirY * -1 - windDirection.y) * 0.1;

        // Calculate giant mushroom attraction
        let giantsX = 0, giantsZ = 0, giantsCount = 0;
        for (let i = 0, len = trackedMushrooms.length; i < len; i++) {
            const m = trackedMushrooms[i];
            if (m.userData.size === 'giant') {
                giantsX += m.position.x;
                giantsZ += m.position.z;
                giantsCount++;
            }
        }

        if (giantsCount > 0) {
            const centerX = giantsX / giantsCount;
            const centerZ = giantsZ / giantsCount;
            const len = Math.sqrt(centerX * centerX + centerZ * centerZ) || 1;
            const attractX = centerX / len;
            const attractZ = centerZ / len;
            
            windDirection.x += (attractX - windDirection.x) * 0.05;
            windDirection.z += (attractZ - windDirection.z) * 0.05;
        }

        // Normalize
        const dirLen = Math.sqrt(windDirection.x * windDirection.x + windDirection.y * windDirection.y + windDirection.z * windDirection.z) || 1;
        windDirection.x /= dirLen;
        windDirection.y /= dirLen;
        windDirection.z /= dirLen;

        return { windDirection, windSpeed, windTargetSpeed };
    }

    /**
     * Update lightning effects
     */
    updateLightning(
        time: number,
        bassIntensity: number,
        lightningTimer: number,
        lightningActive: boolean,
        lightningLight: THREE.PointLight
    ): { lightningTimer: number; lightningActive: boolean } {
        lightningTimer -= 0.016;

        if (bassIntensity > 0.8 && lightningTimer <= 0 && Math.random() > 0.7) {
            lightningActive = true;
            lightningTimer = 0.5 + Math.random() * 1.0;
            lightningLight.intensity = 5 + Math.random() * 5;
            lightningLight.position.set(
                (Math.random() - 0.5) * 60,
                40 + Math.random() * 20,
                (Math.random() - 0.5) * 60
            );
        }

        if (lightningActive) {
            lightningLight.intensity *= 0.85;
            if (lightningLight.intensity < 0.1) {
                lightningActive = false;
                lightningLight.intensity = 0;
            }
        }

        return { lightningTimer, lightningActive };
    }

    /**
     * Charge berry glow during storms
     */
    chargeBerryGlow(bassIntensity: number, trackedTrees: any[], trackedShrubs: any[]): void {
        const chargeAmount = bassIntensity * 0.05;

        for (let i = 0, len = trackedTrees.length; i < len; i++) {
            const tree = trackedTrees[i];
            if (tree.userData.berries) chargeBerries(tree.userData.berries, chargeAmount);
        }
        for (let i = 0, len = trackedShrubs.length; i < len; i++) {
            const shrub = trackedShrubs[i];
            if (shrub.userData.berries) chargeBerries(shrub.userData.berries, chargeAmount);
        }

        if (bassIntensity > 0.6) {
            for (let i = 0, len = trackedTrees.length; i < len; i++) {
                const tree = trackedTrees[i];
                if (tree.userData.berries) shakeBerriesLoose(tree.userData.berries, bassIntensity);
            }
            for (let i = 0, len = trackedShrubs.length; i < len; i++) {
                const shrub = trackedShrubs[i];
                if (shrub.userData.berries) shakeBerriesLoose(shrub.userData.berries, bassIntensity);
            }
        }
    }
}

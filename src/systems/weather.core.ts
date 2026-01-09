// src/systems/weather.core.ts
// Core weather calculation functions (Phase 1: JS -> TS Migration)
// Following PERFORMANCE_MIGRATION_STRATEGY.md - Extract only hot functions (~15%)

import * as THREE from 'three';

// --- Constants ---
const DEFAULT_FRAME_TIME = 0.016; // 60 FPS (1/60 second)

// --- Type Definitions ---

export interface WeatherState {
    state: 'clear' | 'rain' | 'storm';
    intensity: number;
    stormCharge: number;
}

export interface CelestialState {
    sunIntensity: number;
    moonIntensity: number;
    sunAngle: number;
    isDaytime: boolean;
    isNight: boolean;
}

export interface SeasonalState {
    season: string;
    seasonProgress: number;
    moonPhase: number;
}

export interface LightLevelData {
    sunPower: number;
    moonPower: number;
    globalLight: number;
}

export interface FavorabilityData {
    floraFavorability: number;
    fungiFavorability: number;
    lanternFavorability: number;
}

export interface WeatherBias {
    biasState: 'clear' | 'rain' | 'storm';
    biasIntensity: number;
    type: string;
}

// --- Core Weather Functions ---

/**
 * Calculate global light level based on celestial and weather state
 * Hot path - called every frame
 */
export function calculateGlobalLightLevel(
    celestial: CelestialState,
    seasonal: SeasonalState,
    cloudDensity: number
): LightLevelData {
    const sunPower = celestial.sunIntensity * (1.0 - cloudDensity * 0.7);
    const moonPower = celestial.moonIntensity * 0.3;
    const globalLight = Math.max(0, sunPower + moonPower);

    return {
        sunPower,
        moonPower,
        globalLight
    };
}

/**
 * Calculate flora/fungi favorability based on conditions
 * Used for growth rate calculations
 */
export function calculateFavorability(
    globalLight: number,
    intensity: number,
    stormCharge: number,
    weatherState: 'clear' | 'rain' | 'storm'
): FavorabilityData {
    const moisture = intensity + (stormCharge * 0.5);

    let floraFavorability = globalLight * (0.5 + moisture);
    if (moisture > 0.9) {
        floraFavorability *= 0.5;
    }

    const fungiFavorability = (1.0 - globalLight) * (0.2 + moisture * 1.5);
    const lanternFavorability = (weatherState === 'storm' ? 1.0 : 0.0) + 
                                (1.0 - globalLight) * 0.2;

    return {
        floraFavorability,
        fungiFavorability,
        lanternFavorability
    };
}

/**
 * Calculate mushroom growth rate based on weather
 * Hot path - affects all mushrooms every frame
 */
export function calculateMushroomGrowthRate(
    weatherState: 'clear' | 'rain' | 'storm',
    bassIntensity: number,
    sunPower: number,
    fungiFavorability: number
): number {
    const isRaining = weatherState === 'rain' || weatherState === 'storm';
    
    if (isRaining) {
        // Grow: Base rate + bass boost
        const baseRate = 0.01;
        const bassBoost = bassIntensity * 0.02;
        return baseRate + bassBoost;
    } else {
        // Shrink if sunny
        if (sunPower > 0.3) {
            return -0.005; // Slow shrink
        }
    }
    
    return 0;
}

/**
 * Update weather state based on audio and bias
 * State machine logic for weather transitions
 */
export function calculateWeatherStateTransition(
    currentState: 'clear' | 'rain' | 'storm',
    currentIntensity: number,
    currentStormCharge: number,
    bassIntensity: number,
    melodyVol: number,
    groove: number,
    weatherBias: WeatherBias | null,
    transitionSpeed: number
): WeatherState {
    let targetIntensity = 0;
    let newState = currentState;
    let newStormCharge = currentStormCharge;

    // Apply Cycle Bias if provided
    if (weatherBias && weatherBias.biasIntensity > 0.1) {
        if (weatherBias.biasState === 'storm') {
            targetIntensity = 0.8 * weatherBias.biasIntensity;
            newStormCharge += 0.01 * weatherBias.biasIntensity;
        } else if (weatherBias.biasState === 'rain') {
            targetIntensity = 0.5 * weatherBias.biasIntensity;
        } else {
            targetIntensity = 0.0;
        }
    } else {
        // Audio-Driven Logic
        if (bassIntensity > 0.6 && groove > 0.5) {
            targetIntensity = 0.5 + (bassIntensity * 0.5);
            newStormCharge += 0.02;
        } else if (melodyVol > 0.4) {
            targetIntensity = 0.3;
        } else {
            targetIntensity = 0.0;
        }
    }

    // Storm Charge Decay
    newStormCharge = Math.max(0, newStormCharge - 0.005);
    newStormCharge = Math.min(1.0, newStormCharge);

    // State Transitions
    if (newStormCharge > 0.8) {
        newState = 'storm';
        targetIntensity = Math.max(targetIntensity, 0.8);
    } else if (targetIntensity > 0.3) {
        newState = 'rain';
    } else {
        newState = 'clear';
    }

    // Smooth intensity transition
    const newIntensity = currentIntensity + 
        (targetIntensity - currentIntensity) * transitionSpeed;

    return {
        state: newState,
        intensity: newIntensity,
        stormCharge: newStormCharge
    };
}

/**
 * Calculate fog density based on weather and audio
 * Used for crescendo fog effect
 */
export function calculateFogDensity(
    baseFogNear: number,
    baseFogFar: number,
    weatherIntensity: number,
    audioVolume: number,
    cloudDensity: number
): { near: number; far: number } {
    // Crescendo Fog Logic
    const fogFactor = audioVolume * 0.4 * cloudDensity;
    const weatherFogFactor = weatherIntensity * 0.3;
    
    const totalFogFactor = fogFactor + weatherFogFactor;
    
    const near = baseFogNear * (1.0 - totalFogFactor * 0.5);
    const far = baseFogFar * (1.0 - totalFogFactor * 0.4);
    
    return { near, far };
}

/**
 * Calculate wind speed and direction
 * Used for environmental effects
 */
export function calculateWindParameters(
    currentWindSpeed: number,
    targetWindSpeed: number,
    weatherState: 'clear' | 'rain' | 'storm',
    weatherIntensity: number,
    delta: number
): { windSpeed: number; windTargetSpeed: number } {
    let newTargetWindSpeed = targetWindSpeed;
    
    if (weatherState === 'storm') {
        newTargetWindSpeed = 2.0 + weatherIntensity;
    } else if (weatherState === 'rain') {
        newTargetWindSpeed = 0.5 + weatherIntensity * 0.5;
    } else {
        newTargetWindSpeed = 0.1;
    }
    
    const newWindSpeed = currentWindSpeed + 
        (newTargetWindSpeed - currentWindSpeed) * delta * 2.0;
    
    return {
        windSpeed: newWindSpeed,
        windTargetSpeed: newTargetWindSpeed
    };
}

/**
 * Calculate ground water level changes
 * Affects cave flooding
 */
export function calculateGroundWaterLevel(
    currentLevel: number,
    weatherState: 'clear' | 'rain' | 'storm',
    delta: number = DEFAULT_FRAME_TIME
): number {
    let newLevel = currentLevel;
    
    if (weatherState === 'rain') {
        newLevel = Math.min(1.0, newLevel + 0.0005);
    } else if (weatherState === 'storm') {
        newLevel = Math.min(1.0, newLevel + 0.0015);
    } else {
        newLevel = Math.max(0.0, newLevel - 0.0003);
    }
    
    return newLevel;
}

/**
 * Calculate rainbow timer and opacity
 * Appears after storm clears
 */
export function calculateRainbowOpacity(
    rainbowTimer: number,
    delta: number = DEFAULT_FRAME_TIME
): { timer: number; opacity: number } {
    let newTimer = rainbowTimer;
    let opacity = 0.0;
    
    if (rainbowTimer > 0) {
        newTimer -= delta;
        opacity = 1.0;
        
        // Fade in
        if (rainbowTimer > 40.0) {
            opacity = (45.0 - rainbowTimer) / 5.0;
        }
        // Fade out
        else if (rainbowTimer < 5.0) {
            opacity = rainbowTimer / 5.0;
        }
        
        opacity *= 0.6;
    }
    
    return { timer: Math.max(0, newTimer), opacity };
}

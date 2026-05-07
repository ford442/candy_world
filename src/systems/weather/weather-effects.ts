// src/systems/weather/weather-effects.ts
// Visual effects management: rainbow, aurora, lightning, plant growth

import * as THREE from 'three';
import { createRainbow, uRainbowOpacity } from '../../foliage/rainbow.ts';
import { createAurora, uAuroraIntensity } from '../../foliage/aurora.ts';
import { uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor } from '../../foliage/clouds.ts';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { triggerGrowth, triggerBloom } from '../../foliage/animation.ts';
import { ComputeParticleSystem } from '../../compute/particle_compute.ts';
import { createIntegratedRain } from '../../particles/index.ts';
import { ComputeParticleSystem as Phase4ComputeSystem } from '../../particles/compute-particles.ts';
import { WeatherState } from '../weather-types.ts';
import { CONFIG } from '../../core/config.ts';

// Cache palette keys outside the render loop to prevent GC spikes during storms
const _cloudPaletteKeys = Object.keys((CONFIG.noteColorMap && CONFIG.noteColorMap.cloud) || {});

export interface EffectsState {
    rainbow: any; // Mesh
    aurora: any; // Mesh
    rainbowTimer: number;
    lightningLight: THREE.PointLight;
    lightningActive: boolean;
    lightningTimer: number;
    rainMesh: THREE.Points | null;
    mistMesh: THREE.Points | null;
    percussionRain: Phase4ComputeSystem | null;
    melodicMist: ComputeParticleSystem | null;
}

export class EffectsManager {
    private scene: THREE.Scene;
    private state: EffectsState;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.state = {
            rainbow: null,
            aurora: null,
            rainbowTimer: 0,
            lightningLight: new THREE.PointLight(0xFFFFFF, 0, 200),
            lightningActive: false,
            lightningTimer: 0,
            rainMesh: null,
            mistMesh: null,
            percussionRain: null,
            melodicMist: null
        };
    }

    /**
     * Get the current effects state
     */
    getState(): EffectsState {
        return this.state;
    }

    /**
     * Initialize rainbow effect
     */
    initRainbow(): void {
        this.state.rainbow = createRainbow();
        this.state.rainbow.position.set(0, -20, -100);
        this.state.rainbow.scale.setScalar(2.0);
        this.scene.add(this.state.rainbow);
    }

    /**
     * Initialize aurora effect
     */
    initAurora(): void {
        this.state.aurora = createAurora();
        this.scene.add(this.state.aurora);
    }

    /**
     * Initialize lightning light
     */
    initLightning(): void {
        this.state.lightningLight.position.set(0, 50, 0);
        this.scene.add(this.state.lightningLight);
    }

    /**
     * Set renderer for particle systems
     */
    setRenderer(renderer: any): void {
        if (!this.state.percussionRain) {
            this.state.rainMesh = createIntegratedRain({ count: 2000, areaSize: 50, center: new THREE.Vector3(0, 40, 0) }) as THREE.Points;
            this.state.percussionRain = this.state.rainMesh.userData?.computeParticleSystem as Phase4ComputeSystem || null;
            this.state.rainMesh.visible = false;
            this.scene.add(this.state.rainMesh);
        }

        if (!this.state.melodicMist) {
            this.state.melodicMist = new ComputeParticleSystem(1000, renderer, {
                type: 'mist',
                spawnCenter: new THREE.Vector3(0, 5, 0),
                gravity: new THREE.Vector3(0, 0, 0)
            });
            this.state.mistMesh = this.state.melodicMist.createMesh();
            this.state.mistMesh.visible = false;
            this.scene.add(this.state.mistMesh);
        }
    }

    /**
     * Update rainbow fade in/out
     */
    updateRainbow(dt: number, lastState: WeatherState, currentState: WeatherState, rainbowTimer: number): number {
        // Start rainbow timer when transitioning from STORM to non-STORM
        if (lastState === WeatherState.STORM && currentState !== WeatherState.STORM) {
            rainbowTimer = 45.0;
        }

        if (rainbowTimer > 0) {
            rainbowTimer -= dt;
            let opacity = 1.0;
            if (rainbowTimer > 40.0) opacity = (45.0 - rainbowTimer) / 5.0;
            else if (rainbowTimer < 5.0) opacity = rainbowTimer / 5.0;
            if (uRainbowOpacity) uRainbowOpacity.value = opacity * 0.6;
        } else {
            if (uRainbowOpacity) uRainbowOpacity.value = 0.0;
        }

        return rainbowTimer;
    }

    /**
     * Update aurora intensity based on weather/night
     */
    updateAurora(twilightIntensity: number, state: WeatherState): void {
        // Aurora appears at Night (twilightIntensity > 0.8) and when Clear or Storm
        let targetAurora = 0.0;
        if (twilightIntensity > 0.8) {
            if (state === WeatherState.CLEAR) targetAurora = 0.8;
            else if (state === WeatherState.STORM) targetAurora = 1.0; // Magic Storm
            else targetAurora = 0.0; // Rain hides it
        }

        // Lerp Intensity
        if (uAuroraIntensity) {
             const current = uAuroraIntensity.value as number;
             uAuroraIntensity.value = current + (targetAurora - current) * 0.02; // Smooth fade
        }
    }

    /**
     * Update cloud lightning effects
     */
    updateCloudLightning(
        state: WeatherState,
        intensity: number,
        bassIntensity: number,
        cloudDensity: number,
        lightningLight: THREE.PointLight
    ): boolean {
        let lightningActive = false;

        if (state === WeatherState.STORM && (bassIntensity > 0.8 || Math.random() < 0.01)) {
            try { if (uCloudLightningStrength) uCloudLightningStrength.value = 1.0; } catch (e) {}

            if (_cloudPaletteKeys.length > 0) {
                const randomKey = _cloudPaletteKeys[Math.floor(Math.random() * _cloudPaletteKeys.length)];
                const colorHex = CONFIG.noteColorMap.cloud[randomKey];
                try { 
                    if (uCloudLightningColor && uCloudLightningColor.value && uCloudLightningColor.value.setHex) {
                        uCloudLightningColor.value.setHex(colorHex);
                    }
                } catch (e) {}
                lightningLight.color.setHex(colorHex);
                lightningLight.intensity = 10 * cloudDensity;
                lightningLight.position.set((Math.random() - 0.5) * 100, 50, (Math.random() - 0.5) * 100);
                lightningActive = true;
            }
        } else {
            try { 
                if (uCloudLightningStrength) {
                    uCloudLightningStrength.value *= 0.85;
                }
            } catch (e) {}
        }

        return lightningActive;
    }

    /**
     * Update cloud rainbow intensity
     */
    updateCloudRainbow(melodyVol: number, highVol: number, cloudDensity: number): void {
        const rainbowTarget = (melodyVol * 0.5 + highVol * 0.5) * cloudDensity;
        try { 
            if (uCloudRainbowIntensity) {
                uCloudRainbowIntensity.value += (rainbowTarget - uCloudRainbowIntensity.value) * 0.05;
            }
        } catch (e) {}
    }

    /**
     * Trigger chromatic pulse on palette mode change
     */
    triggerPalettePulse(): void {
        if (uChromaticIntensity) {
            uChromaticIntensity.value = 1.0; // Sharp pulse
        }
    }

    /**
     * Grow plants with given intensity
     */
    growPlants(trackedTrees: any[], trackedMushrooms: any[], intensity: number): void {
        triggerGrowth(trackedTrees, intensity);
        triggerGrowth(trackedMushrooms, intensity);
    }

    /**
     * Bloom flora with given intensity
     */
    bloomFlora(trackedFlowers: any[], intensity: number): void {
        triggerBloom(trackedFlowers, intensity);
    }

    /**
     * Update rain and mist particle systems
     */
    updateParticleSystems(
        renderer: any,
        dt: number,
        bassIntensity: number,
        melodyVol: number,
        weatherType: string,
        state: WeatherState
    ): void {
        const { percussionRain, melodicMist, rainMesh, mistMesh } = this.state;
        
        // Update separately to support missing systems in fallback mode

        const shouldShowRain = bassIntensity > 0.2 || state !== WeatherState.CLEAR;
        const shouldShowMist = melodyVol > 0.2 || (weatherType === 'mist' && state === WeatherState.RAIN);

        if (rainMesh) {
            rainMesh.visible = shouldShowRain;
        }
        if (mistMesh) {
            mistMesh.visible = shouldShowMist;
        }

        if (shouldShowRain && percussionRain) {
            percussionRain.update(renderer, dt, new THREE.Vector3(0,0,0), { low: bassIntensity, mid: melodyVol, high: 0, beat: false, groove: 0, windX: 0, windZ: 0, windSpeed: 0 });
        }
        
        if (shouldShowMist && melodicMist) {
            // old CPU update for mist
            melodicMist.update(dt, { kick: bassIntensity, low: bassIntensity, mid: melodyVol }, 0);

            // Dynamic color behavior
            if (weatherType === 'mist') {
                melodicMist.setBaseColor(0xDDFFDD);
            } else {
                melodicMist.setBaseColor(0xAAFFAA);
            }
        }
    }

    /**
     * Get rain mesh for visibility control
     */
    getRainMesh(): THREE.Points | null {
        return this.state.rainMesh;
    }

    /**
     * Get mist mesh for visibility control
     */
    getMistMesh(): THREE.Points | null {
        return this.state.mistMesh;
    }

    /**
     * Dispose of all effects
     */
    dispose(): void {
        const { percussionRain, melodicMist, rainMesh, mistMesh, lightningLight, rainbow } = this.state;
        
        if (percussionRain) {
            percussionRain.dispose();
            if (rainMesh) {
                if (rainMesh.geometry) rainMesh.geometry.dispose();
                if (rainMesh.material) {
                    if (Array.isArray(rainMesh.material)) {
                        rainMesh.material.forEach((m: any) => m.dispose());
                    } else {
                        (rainMesh.material as any).dispose();
                    }
                }
                this.scene.remove(rainMesh);
            }
        }
        if (melodicMist) {
            melodicMist.dispose();
            if (mistMesh) {
                if (mistMesh.geometry) mistMesh.geometry.dispose();
                if (mistMesh.material) {
                    if (Array.isArray(mistMesh.material)) {
                        mistMesh.material.forEach((m: any) => m.dispose());
                    } else {
                        (mistMesh.material as any).dispose();
                    }
                }
                this.scene.remove(mistMesh);
            }
        }
        if (lightningLight) {
            this.scene.remove(lightningLight);
        }
        if (rainbow) {
            if (rainbow.geometry) rainbow.geometry.dispose();
            if (rainbow.material) {
                if (Array.isArray(rainbow.material)) {
                    rainbow.material.forEach((m: any) => m.dispose());
                } else {
                    (rainbow.material as any).dispose();
                }
            }
            this.scene.remove(rainbow);
        }
    }
}

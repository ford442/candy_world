// Weather System for Candy World
// Manages audio-reactive weather states: Clear, Rain, Storm
// Triggers berry charging and plant growth

import * as THREE from 'three';
import { calcRainDropY } from './wasm-loader.js';
import { chargeBerries, triggerGrowth, triggerBloom, shakeBerriesLoose, updateBerrySeasons } from './foliage.js';

// Weather states
export const WeatherState = {
    CLEAR: 'clear',
    RAIN: 'rain',
    STORM: 'storm'
};

/**
 * Weather System - Audio-reactive weather effects
 */
export class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.state = WeatherState.CLEAR;
        this.intensity = 0;
        this.stormCharge = 0; // Accumulated storm energy

        // Particle systems
        this.percussionRain = null;  // Fat droplets (bass triggered)
        this.melodicMist = null;     // Fine spray (melody triggered)

        // Lightning
        this.lightningLight = null;
        this.lightningTimer = 0;
        this.lightningActive = false;

        // Tracked objects for growth/charging
        this.trackedTrees = [];
        this.trackedShrubs = [];
        this.trackedFlowers = [];

        // State transition
        this.targetIntensity = 0;
        this.transitionSpeed = 0.02;

        this.initParticles();
        this.initLightning();
    }

    /**
     * Initialize percussion rain particles (fat droplets)
     */
    initParticles() {
        // Percussion Rain - Large droplets for bass hits
        const rainCount = 500;
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);
        const rainOffsets = new Float32Array(rainCount);

        for (let i = 0; i < rainCount; i++) {
            // Spread across world
            rainPositions[i * 3] = (Math.random() - 0.5) * 100;
            rainPositions[i * 3 + 1] = 20 + Math.random() * 30;
            rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            rainVelocities[i] = 5 + Math.random() * 5; // Drop speed
            rainOffsets[i] = Math.random() * 50; // Start height variation
        }

        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        rainGeo.userData = { velocities: rainVelocities, offsets: rainOffsets };

        const rainMat = new THREE.PointsMaterial({
            color: 0x88CCFF,
            size: 0.3,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.percussionRain = new THREE.Points(rainGeo, rainMat);
        this.percussionRain.visible = false;
        this.scene.add(this.percussionRain);

        // Melodic Mist - Fine particles for melody
        const mistCount = 300;
        const mistGeo = new THREE.BufferGeometry();
        const mistPositions = new Float32Array(mistCount * 3);

        for (let i = 0; i < mistCount; i++) {
            mistPositions[i * 3] = (Math.random() - 0.5) * 80;
            mistPositions[i * 3 + 1] = Math.random() * 5;
            mistPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
        }

        mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));

        const mistMat = new THREE.PointsMaterial({
            color: 0xAAFFAA,
            size: 0.15,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });

        this.melodicMist = new THREE.Points(mistGeo, mistMat);
        this.melodicMist.visible = false;
        this.scene.add(this.melodicMist);
    }

    /**
     * Initialize lightning effect
     */
    initLightning() {
        this.lightningLight = new THREE.PointLight(0xFFFFFF, 0, 200);
        this.lightningLight.position.set(0, 50, 0);
        this.scene.add(this.lightningLight);
    }

    /**
     * Register objects for weather effects
     */
    registerTree(tree) {
        this.trackedTrees.push(tree);
    }

    registerShrub(shrub) {
        this.trackedShrubs.push(shrub);
    }

    registerFlower(flower) {
        this.trackedFlowers.push(flower);
    }

    /**
     * Main update loop - call every frame
     * @param {number} time - Current time
     * @param {object} audioData - Audio analysis data
     */
    update(time, audioData) {
        if (!audioData) return;

        // Extract audio features
        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = channels[2]?.volume || 0;

        // Determine weather state based on audio
        this.updateWeatherState(bassIntensity, melodyVol, groove);

        // Trigger Growth/Bloom based on weather active state
        if (this.state === WeatherState.RAIN) {
            // Percussion rain triggers growth
            if (this.percussionRain.visible) {
                this.growPlants(bassIntensity * 0.1);
            }
            // Melodic mist triggers bloom
            if (this.melodicMist.visible) {
                this.bloomFlora(melodyVol * 0.1);
            }
        } else if (this.state === WeatherState.STORM) {
            // Storm grows everything faster
            this.growPlants(bassIntensity * 0.2);
            this.bloomFlora(melodyVol * 0.2);
        }

        // Smooth intensity transition
        this.intensity += (this.targetIntensity - this.intensity) * this.transitionSpeed;

        // Update particle systems
        this.updatePercussionRain(time, bassIntensity);
        this.updateMelodicMist(time, melodyVol);

        // Handle lightning during storms
        if (this.state === WeatherState.STORM) {
            this.updateLightning(time, bassIntensity);
            this.chargeBerryGlow(bassIntensity);
        }

        // Accumulate storm charge
        if (this.state !== WeatherState.CLEAR) {
            this.stormCharge = Math.min(2.0, this.stormCharge + 0.001);
        } else {
            this.stormCharge = Math.max(0, this.stormCharge - 0.0005);
        }
    }

    /**
     * Update berry sizes based on day/night cycle phase
     * @param {number} cyclePos - Current position in cycle (0 to CYCLE_DURATION)
     * @param {number} CYCLE_DURATION - Total cycle duration
     */
    updateBerrySeasonalSize(cyclePos, CYCLE_DURATION) {
        // Define phase boundaries (matching main.js)
        const SUNRISE = 60, DAY = 420, SUNSET = 60, DUSK = 180, DEEP = 120, PREDAWN = 120;
        let elapsed = SUNRISE + DAY;

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

        // Update all tracked plants with berries
        this.trackedTrees.forEach(tree => {
            if (tree.userData.berries) {
                updateBerrySeasons(tree.userData.berries, phase, phaseProgress);
            }
        });
        this.trackedShrubs.forEach(shrub => {
            if (shrub.userData.berries) {
                updateBerrySeasons(shrub.userData.berries, phase, phaseProgress);
            }
        });
    }

    /**
     * Determine weather state from audio
     */
    updateWeatherState(bass, melody, groove) {
        // Storm: High bass + high groove (intense music)
        if (bass > 0.7 && groove > 0.5) {
            this.state = WeatherState.STORM;
            this.targetIntensity = 1.0;
        }
        // Rain: Moderate bass OR melody presence
        else if (bass > 0.3 || melody > 0.4) {
            this.state = WeatherState.RAIN;
            this.targetIntensity = 0.5;
        }
        // Clear: Low activity
        else {
            this.state = WeatherState.CLEAR;
            this.targetIntensity = 0;
        }
    }

    /**
     * Update percussion rain (bass-triggered fat droplets)
     */
    updatePercussionRain(time, bassIntensity) {
        const shouldShow = bassIntensity > 0.2 || this.state !== WeatherState.CLEAR;
        this.percussionRain.visible = shouldShow;

        if (!shouldShow) return;

        const positions = this.percussionRain.geometry.attributes.position.array;
        const velocities = this.percussionRain.geometry.userData.velocities;
        const offsets = this.percussionRain.geometry.userData.offsets;

        // Size responds to bass
        this.percussionRain.material.size = 0.3 + bassIntensity * 0.5;
        this.percussionRain.material.opacity = 0.4 + this.intensity * 0.6;

        // Update particle positions using WASM
        for (let i = 0; i < positions.length / 3; i++) {
            const startY = 50 + offsets[i];
            const speed = velocities[i] * (1 + bassIntensity);

            // Use WASM for rain calculation
            const newY = calcRainDropY(startY, time, speed, 50);
            positions[i * 3 + 1] = newY;

            // Reset when hitting ground
            if (newY < 0) {
                positions[i * 3] = (Math.random() - 0.5) * 100;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            }
        }

        this.percussionRain.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Update melodic mist (melody-triggered fine spray)
     */
    updateMelodicMist(time, melodyVol) {
        const shouldShow = melodyVol > 0.2;
        this.melodicMist.visible = shouldShow;

        if (!shouldShow) return;

        const positions = this.melodicMist.geometry.attributes.position.array;

        // Mist drifts slowly
        for (let i = 0; i < positions.length / 3; i++) {
            const offset = i * 0.1;
            positions[i * 3 + 1] = 1 + Math.sin(time + offset) * 2 * melodyVol;
            positions[i * 3] += Math.sin(time * 0.5 + offset) * 0.01;
            positions[i * 3 + 2] += Math.cos(time * 0.4 + offset) * 0.01;
        }

        this.melodicMist.material.opacity = 0.3 + melodyVol * 0.4;
        this.melodicMist.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Lightning effect during storms
     */
    updateLightning(time, bassIntensity) {
        this.lightningTimer -= 0.016; // Approx 60fps

        // Trigger lightning on strong bass hits
        if (bassIntensity > 0.8 && this.lightningTimer <= 0 && Math.random() > 0.7) {
            this.lightningActive = true;
            this.lightningTimer = 0.5 + Math.random() * 1.0; // Cooldown
            this.lightningLight.intensity = 5 + Math.random() * 5;

            // Random position
            this.lightningLight.position.set(
                (Math.random() - 0.5) * 60,
                40 + Math.random() * 20,
                (Math.random() - 0.5) * 60
            );
        }

        // Fade lightning
        if (this.lightningActive) {
            this.lightningLight.intensity *= 0.85;
            if (this.lightningLight.intensity < 0.1) {
                this.lightningActive = false;
                this.lightningLight.intensity = 0;
            }
        }
    }

    /**
     * Charge berries during storms
     */
    chargeBerryGlow(bassIntensity) {
        const chargeAmount = bassIntensity * 0.05;

        // Charge tree berries
        this.trackedTrees.forEach(tree => {
            if (tree.userData.berries) {
                chargeBerries(tree.userData.berries, chargeAmount);
            }
        });

        // Charge shrub berries
        this.trackedShrubs.forEach(shrub => {
            if (shrub.userData.berries) {
                chargeBerries(shrub.userData.berries, chargeAmount);
            }
        });

        // Shake berries loose during intense storms
        if (bassIntensity > 0.6) {
            this.trackedTrees.forEach(tree => {
                if (tree.userData.berries) {
                    shakeBerriesLoose(tree.userData.berries, bassIntensity);
                }
            });
            this.trackedShrubs.forEach(shrub => {
                if (shrub.userData.berries) {
                    shakeBerriesLoose(shrub.userData.berries, bassIntensity);
                }
            });
        }
    }

    /**
     * Trigger growth for structural plants (Trees, Mushrooms)
     */
    growPlants(intensity) {
        // Find trees and mushrooms in tracked objects
        // We'll emit a custom event or call a global function, 
        // but since we have direct access to tracked objects, let's use that.
        // However, foliage.js handles the actual scaling logic usually.
        // Let's assume we import a handler from foliage.js or handle it here.
        // For now, let's just use the tracked objects directly if they have a 'grow' method 
        // or we can manipulate them. But wait, existing trees don't have a 'grow' method on the Group.
        // Better approach: Import 'triggerGrowth' from foliage.js

        // Actually, let's call the imported function just like chargeBerries.
        // I will add the import at the top of the file in a separate edit.
        // For now, let's stub this or use what we have. 
        // I will rely on `triggerGrowth` and `triggerBloom` being imported.

        // See top of file for imports. I will add them there.
        // Here is the logic:


        triggerGrowth(this.trackedTrees, intensity);
        // Also grow mushrooms if we track them. 
        // Currently we track trees, shrubs, flowers.
        // I should also track mushrooms.
    }

    /**
     * Trigger bloom for flowers
     */
    bloomFlora(intensity) {

        // I will fix imports in a wrap-up step.
        // For this MultiReplace, I will just add the calls and assume imports exist?
        // No, I should do it properly. 
        // I will add the methods here, and update imports in the same tool call if possible?
        // No, MultiReplace allows multiple chunks.

        triggerBloom(this.trackedFlowers, intensity);
    }

    /**
     * Get current weather state
     */
    getState() {
        return this.state;
    }

    /**
     * Get storm charge for berry glow
     */
    getStormCharge() {
        return this.stormCharge;
    }

    /**
     * Get weather intensity (0-1)
     */
    getIntensity() {
        return this.intensity;
    }

    /**
     * Force weather state (for testing/debugging)
     */
    forceState(state) {
        this.state = state;
        switch (state) {
            case WeatherState.STORM:
                this.targetIntensity = 1.0;
                break;
            case WeatherState.RAIN:
                this.targetIntensity = 0.5;
                break;
            default:
                this.targetIntensity = 0;
        }
    }

    /**
     * Cleanup
     */
    dispose() {
        if (this.percussionRain) {
            this.scene.remove(this.percussionRain);
            this.percussionRain.geometry.dispose();
            this.percussionRain.material.dispose();
        }
        if (this.melodicMist) {
            this.scene.remove(this.melodicMist);
            this.melodicMist.geometry.dispose();
            this.melodicMist.material.dispose();
        }
        if (this.lightningLight) {
            this.scene.remove(this.lightningLight);
        }
    }
}

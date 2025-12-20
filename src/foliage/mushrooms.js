// src/systems/weather.js

import * as THREE from 'three';
import { calcRainDropY, getGroundHeight, uploadPositions, uploadAnimationData, batchMushroomSpawnCandidates, readSpawnCandidates, isWasmReady } from '../utils/wasm-loader.js';
import { chargeBerries, triggerGrowth, triggerBloom, shakeBerriesLoose, updateBerrySeasons, createMushroom } from '../foliage/index.js';
import { createWaterfall } from '../foliage/waterfalls.js';
import { getCelestialState } from '../core/cycle.js';
import { CYCLE_DURATION, CONFIG } from '../core/config.js';
import { uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor } from '../foliage/clouds.js';

export const WeatherState = {
    CLEAR: 'clear',
    RAIN: 'rain',
    STORM: 'storm'
};

export class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.state = WeatherState.CLEAR;
        this.intensity = 0;
        this.stormCharge = 0; 
        
        // Player Control Factor
        this.cloudDensity = 1.0; 
        this.cloudRegenRate = 0.0005;

        // Particle systems
        this.percussionRain = null;
        this.melodicMist = null;

        // Lightning
        this.lightningLight = null;
        this.lightningTimer = 0;
        this.lightningActive = false;

        // Tracked objects
        this.trackedTrees = [];
        this.trackedShrubs = [];
        this.trackedFlowers = [];
        this.trackedMushrooms = [];
        this.mushroomWaterfalls = new Map();

        // State transition
        this.targetIntensity = 0;
        this.transitionSpeed = 0.02;

        // Wind System
        this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();
        this.windSpeed = 0;
        this.windTargetSpeed = 0;
        this.onSpawnFoliage = null;

        // Fog reference
        this.fog = scene.fog;
        this.baseFogNear = scene.fog ? scene.fog.near : 20;
        this.baseFogFar = scene.fog ? scene.fog.far : 100;

        this.initParticles();
        this.initLightning();
    }

    initParticles() {
        const rainCount = 500;
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);
        const rainOffsets = new Float32Array(rainCount);

        for (let i = 0; i < rainCount; i++) {
            rainPositions[i * 3] = (Math.random() - 0.5) * 100;
            rainPositions[i * 3 + 1] = 20 + Math.random() * 30;
            rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            rainVelocities[i] = 5 + Math.random() * 5; 
            rainOffsets[i] = Math.random() * 50; 
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
    
    registerMushroom(mushroom) { if (!mushroom) return; if (!this.trackedMushrooms.includes(mushroom)) this.trackedMushrooms.push(mushroom); }
    initLightning() {
        this.lightningLight = new THREE.PointLight(0xFFFFFF, 0, 200);
        this.lightningLight.position.set(0, 50, 0);
        this.scene.add(this.lightningLight);
    }
    registerTree(tree) { this.trackedTrees.push(tree); }
    registerShrub(shrub) { this.trackedShrubs.push(shrub); }
    registerFlower(flower) { this.trackedFlowers.push(flower); }

    notifyCloudShot(isDaytime) {
        this.cloudDensity = Math.max(0.2, this.cloudDensity - 0.05);
    }

    update(time, audioData, cycleWeatherBias = null) {
        if (!audioData) return;

        this.cloudDensity = Math.min(1.0, this.cloudDensity + this.cloudRegenRate);

        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = channels[2]?.volume || 0; // Melody
        const highVol = channels[3]?.volume || 0;   // High Hats

        const celestial = getCelestialState(time); 
        
        this.updateWeatherState(bassIntensity, melodyVol, groove, cycleWeatherBias);
        this.targetIntensity *= this.cloudDensity;

        // --- NEW: Drive Cloud Visuals ---
        // 1. Rainbows: Driven by Melody & Highs
        const rainbowTarget = (melodyVol * 0.5 + highVol * 0.5) * this.cloudDensity;
        uCloudRainbowIntensity.value += (rainbowTarget - uCloudRainbowIntensity.value) * 0.05;

        // 2. Lightning: Driven by Bass
        if (this.state === WeatherState.STORM && (bassIntensity > 0.8 || Math.random() < 0.01)) {
            uCloudLightningStrength.value = 1.0;
            const paletteKeys = Object.keys(CONFIG.noteColorMap.cloud);
            const randomKey = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
            const colorHex = CONFIG.noteColorMap.cloud[randomKey];
            uCloudLightningColor.value.setHex(colorHex);
            
            this.lightningLight.color.setHex(colorHex);
            this.lightningLight.intensity = 10 * this.cloudDensity;
            this.lightningLight.position.set((Math.random()-0.5)*100, 50, (Math.random()-0.5)*100);
            this.lightningActive = true;
        } else {
            uCloudLightningStrength.value *= 0.85; 
            if (this.lightningActive) {
                this.lightningLight.intensity *= 0.85;
                if (this.lightningLight.intensity < 0.1) this.lightningActive = false;
            }
        }

        // --- NEW: Apply Darkness ---
        this.applyDarknessLogic(celestial);

        // [Growth Logic]
        if (this.state === WeatherState.RAIN || this.state === WeatherState.STORM) {
            const growthBase = (this.state === WeatherState.STORM ? 0.2 : 0.1) * bassIntensity;
            const bloomBase = (this.state === WeatherState.STORM ? 0.2 : 0.1) * melodyVol;
            const solarGrowth = growthBase * (0.5 + celestial.sunIntensity);
            const lunarGrowth = growthBase * (0.5 + celestial.moonIntensity);

            if (this.percussionRain.visible) {
                triggerGrowth(this.trackedTrees, solarGrowth);
                triggerGrowth(this.trackedFlowers, solarGrowth); 
                triggerGrowth(this.trackedMushrooms, lunarGrowth);
            }
            if (this.melodicMist.visible) {
                triggerBloom(this.trackedFlowers, bloomBase * (0.8 + celestial.sunIntensity * 0.4));
            }
        }

        this.updateMushroomWaterfalls(time, bassIntensity);
        this.intensity += (this.targetIntensity - this.intensity) * this.transitionSpeed;

        this.updatePercussionRain(time, bassIntensity);
        this.updateMelodicMist(time, melodyVol);
        this.chargeBerryGlow(bassIntensity);

        if (this.state !== WeatherState.CLEAR) {
            this.stormCharge = Math.min(2.0, this.stormCharge + 0.001);
        } else {
            this.stormCharge = Math.max(0, this.stormCharge - 0.0005);
        }

        this.updateWind(time, audioData, celestial);
        this.updateFog();
    }

    applyDarknessLogic(celestial) {
        // Darkness = Moon Intensity * Cloud Density
        // Only darkens when it's night and clouds are present
        const nightFactor = celestial.moonIntensity; 
        const densityFactor = this.cloudDensity;     
        
        const darkness = nightFactor * densityFactor * 0.9; // Max 90% darker

        // Darken Fog
        if (this.scene.fog && this.scene.fog.color) {
            this.scene.fog.color.lerp(new THREE.Color(0x000000), darkness);
        }

        this.darknessFactor = darkness; 
    }

    updateFog() {
        if (!this.fog) return;
        let fogMultiplier = 1.0;
        switch (this.state) {
            case WeatherState.RAIN: fogMultiplier = 0.8; break;
            case WeatherState.STORM: fogMultiplier = 0.6; break;
            default: fogMultiplier = 1.0;
        }
        
        // Visibility drops significantly when darkness is high
        const visibility = (1.0 - this.intensity * (1.0 - fogMultiplier)) * (1.0 - (this.darknessFactor || 0) * 0.8);

        this.fog.near = this.baseFogNear * visibility;
        this.fog.far = this.baseFogFar * visibility;
    }

    // ... [Methods for waterfalls, wind, etc. remain the same as previous steps] ...
    updateMushroomWaterfalls(time, bassIntensity) {
        const isRaining = this.state !== WeatherState.CLEAR && this.intensity > 0.4;
        this.trackedMushrooms.forEach(mushroom => {
            if (mushroom.userData.size === 'giant') {
                const uuid = mushroom.uuid;
                if (isRaining) {
                    if (!this.mushroomWaterfalls.has(uuid)) {
                        const radius = mushroom.userData.capRadius || 5.0;
                        const height = mushroom.userData.capHeight || 8.0;
                        const wf = createWaterfall(
                            new THREE.Vector3(mushroom.position.x + radius * 0.8, height * 0.8, mushroom.position.z),
                            new THREE.Vector3(mushroom.position.x + radius * 1.1, 0, mushroom.position.z),
                            2.0
                        );
                        this.scene.add(wf);
                        this.mushroomWaterfalls.set(uuid, wf);
                    }
                    const wf = this.mushroomWaterfalls.get(uuid);
                    if (wf.onAnimate) wf.onAnimate(0.016, time); 
                    if (bassIntensity > 0.5) wf.scale.setScalar(1.0 + bassIntensity * 0.1);
                } else {
                    if (this.mushroomWaterfalls.has(uuid)) {
                        const wf = this.mushroomWaterfalls.get(uuid);
                        this.scene.remove(wf);
                        this.mushroomWaterfalls.delete(uuid);
                    }
                }
            }
        });
    }

    updateWind(time, audioData, celestial) {
        const channels = audioData.channelData || [];
        const highFreqVol = channels[3]?.volume || 0;
        const melodyVol = channels[2]?.volume || 0;
        this.windTargetSpeed = Math.max(highFreqVol, melodyVol * 0.5);
        this.windSpeed += (this.windTargetSpeed - this.windSpeed) * 0.02;
        const rotSpeed = (audioData.beatPhase || 0) * 0.001;
        this.windDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotSpeed);

        const dayProgress = (time % CYCLE_DURATION) / CYCLE_DURATION;
        const sunAngle = dayProgress * Math.PI * 2;
        const sunDir = new THREE.Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0);
        
        let celestialForce = new THREE.Vector3();
        if (celestial.sunIntensity > 0.5) {
            celestialForce.copy(sunDir).negate(); 
        } else {
            const moonDir = sunDir.clone().negate();
            celestialForce.copy(moonDir);
        }
        this.windDirection.lerp(celestialForce, 0.1);
        this.windDirection.normalize();

        let giantsX = 0, giantsZ = 0, giantsCount = 0;
        this.trackedMushrooms.forEach(m => {
            if (m.userData.size === 'giant') {
                giantsX += m.position.x;
                giantsZ += m.position.z;
                giantsCount++;
            }
        });
        if (giantsCount > 0) {
            const centerX = giantsX / giantsCount;
            const centerZ = giantsZ / giantsCount;
            const attraction = new THREE.Vector3(centerX, 0, centerZ).normalize();
            this.windDirection.lerp(attraction, 0.05);
            this.windDirection.normalize();
        }

        const count = this.trackedMushrooms.length;
        if (this.windSpeed > 0.4 && count > 0) {
             if (!isWasmReady() || typeof batchMushroomSpawnCandidates !== 'function') {
                this.trackedMushrooms.forEach(m => {
                    const colorIndex = m.userData?.colorIndex ?? -1;
                    const colorWeight = (colorIndex >= 0 && colorIndex <= 3) ? 0.02 : 0.005;
                    const spawnChance = colorWeight * this.windSpeed;
                    if (Math.random() < spawnChance) {
                        const distance = 3 + Math.random() * 8;
                        const jitter = 2 + Math.random() * 3;
                        const nx = m.position.x + this.windDirection.x * distance + (Math.random() - 0.5) * jitter;
                        const nz = m.position.z + this.windDirection.z * distance + (Math.random() - 0.5) * jitter;
                        const ny = getGroundHeight(nx, nz);
                        const newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: colorIndex });
                        newM.position.set(nx, ny, nz);
                        newM.rotation.y = Math.random() * Math.PI * 2;
                        if (this.onSpawnFoliage) {
                            try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) { console.warn('onSpawnFoliage failed', e); }
                        } else {
                            this.scene.add(newM);
                            this.registerMushroom(newM);
                        }
                    }
                });
            } else {
                try {
                    const objects = this.trackedMushrooms.map(m => ({ x: m.position.x, y: m.position.y, z: m.position.z, radius: m.userData?.radius || 0.5 }));
                    const animData = this.trackedMushrooms.map(m => ({ offset: 0, type: 0, originalY: m.position.y, colorIndex: m.userData?.colorIndex || 0 }));
                    uploadPositions(objects);
                    uploadAnimationData(animData);
                    const spawnThreshold = 1.0;
                    const minDistance = 3.0;
                    const maxDistance = 8.0;
                    const candidateCount = batchMushroomSpawnCandidates(time, this.windDirection.x, this.windDirection.z, this.windSpeed, count, spawnThreshold, minDistance, maxDistance);
                    if (candidateCount > 0) {
                        const candidates = readSpawnCandidates(candidateCount);
                        for (const c of candidates) {
                            const newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: c.colorIndex });
                            newM.position.set(c.x, c.y, c.z);
                            newM.rotation.y = Math.random() * Math.PI * 2;
                            if (this.onSpawnFoliage) {
                                try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) { console.warn('onSpawnFoliage failed', e); }
                            } else {
                                this.scene.add(newM);
                                this.registerMushroom(newM);
                            }
                        }
                    }
                } catch (e) {
                    console.warn('WASM spawn path failed, falling back to JS:', e);
                }
            }
        }
    }
    
    updateBerrySeasonalSize(cyclePos, CYCLE_DURATION) {
        const SUNRISE = 60, DAY = 420, SUNSET = 60, DUSK = 180, DEEP = 120, PREDAWN = 120;
        let elapsed = SUNRISE + DAY;
        let phase = 'day';
        let phaseProgress = 0;
        if (cyclePos < SUNRISE) { phase = 'sunrise'; phaseProgress = cyclePos / SUNRISE; }
        else if (cyclePos < SUNRISE + DAY) { phase = 'day'; phaseProgress = (cyclePos - SUNRISE) / DAY; }
        else if (cyclePos < SUNRISE + DAY + SUNSET) { phase = 'sunset'; phaseProgress = (cyclePos - SUNRISE - DAY) / SUNSET; }
        else if (cyclePos < SUNRISE + DAY + SUNSET + DUSK) { phase = 'dusk'; phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET) / DUSK; }
        else if (cyclePos < SUNRISE + DAY + SUNSET + DUSK + DEEP) { phase = 'deepNight'; phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET - DUSK) / DEEP; }
        else { phase = 'preDawn'; phaseProgress = (cyclePos - SUNRISE - DAY - SUNSET - DUSK - DEEP) / PREDAWN; }
        this.trackedTrees.forEach(tree => { if (tree.userData.berries) updateBerrySeasons(tree.userData.berries, phase, phaseProgress); });
        this.trackedShrubs.forEach(shrub => { if (shrub.userData.berries) updateBerrySeasons(shrub.userData.berries, phase, phaseProgress); });
    }

    updateWeatherState(bass, melody, groove, cycleWeatherBias = null) {
        let audioState = WeatherState.CLEAR;
        let audioIntensity = 0;
        if (bass > 0.7 && groove > 0.5) { audioState = WeatherState.STORM; audioIntensity = 1.0; }
        else if (bass > 0.3 || melody > 0.4) { audioState = WeatherState.RAIN; audioIntensity = 0.5; }
        if (cycleWeatherBias) {
            const biasWeight = 0.4;
            let biasState = WeatherState.CLEAR;
            if (cycleWeatherBias.biasState === 'storm') biasState = WeatherState.STORM;
            else if (cycleWeatherBias.biasState === 'rain') biasState = WeatherState.RAIN;
            if (audioState !== biasState) {
                const stateValue = { [WeatherState.CLEAR]: 0, [WeatherState.RAIN]: 1, [WeatherState.STORM]: 2 };
                if (Math.random() < biasWeight) { this.state = biasState; this.targetIntensity = cycleWeatherBias.biasIntensity; }
                else { this.state = audioState; this.targetIntensity = audioIntensity; }
            } else {
                this.state = audioState;
                this.targetIntensity = audioIntensity * (1 - biasWeight) + cycleWeatherBias.biasIntensity * biasWeight;
            }
            this.weatherType = cycleWeatherBias.type || 'default';
        } else {
            this.state = audioState;
            this.targetIntensity = audioIntensity;
            this.weatherType = 'audio';
        }
    }

    updatePercussionRain(time, bassIntensity) {
        const shouldShow = bassIntensity > 0.2 || this.state !== WeatherState.CLEAR;
        this.percussionRain.visible = shouldShow;
        if (!shouldShow) return;
        const positions = this.percussionRain.geometry.attributes.position.array;
        const velocities = this.percussionRain.geometry.userData.velocities;
        const offsets = this.percussionRain.geometry.userData.offsets;
        this.percussionRain.material.size = 0.3 + bassIntensity * 0.5;
        this.percussionRain.material.opacity = 0.4 + this.intensity * 0.6;
        if (this.weatherType === 'mist') this.percussionRain.material.color.setHex(0xE0F4FF);
        else if (this.weatherType === 'drizzle') this.percussionRain.material.color.setHex(0x9AB5C8);
        else if (this.weatherType === 'thunderstorm' || this.state === WeatherState.STORM) this.percussionRain.material.color.setHex(0x6090B0);
        else this.percussionRain.material.color.setHex(0x88CCFF);
        for (let i = 0; i < positions.length / 3; i++) {
            const startY = 50 + offsets[i];
            const speed = velocities[i] * (1 + bassIntensity);
            const newY = calcRainDropY(startY, time, speed, 50);
            positions[i * 3 + 1] = newY;
            if (newY < 0) {
                positions[i * 3] = (Math.random() - 0.5) * 100;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            }
        }
        this.percussionRain.geometry.attributes.position.needsUpdate = true;
    }

    updateMelodicMist(time, melodyVol) {
        const shouldShow = melodyVol > 0.2 || (this.weatherType === 'mist' && this.state === WeatherState.RAIN);
        this.melodicMist.visible = shouldShow;
        if (!shouldShow) return;
        const positions = this.melodicMist.geometry.attributes.position.array;
        for (let i = 0; i < positions.length / 3; i++) {
            const offset = i * 0.1;
            positions[i * 3 + 1] = 1 + Math.sin(time + offset) * 2 * Math.max(melodyVol, 0.3);
            positions[i * 3] += Math.sin(time * 0.5 + offset) * 0.01;
            positions[i * 3 + 2] += Math.cos(time * 0.4 + offset) * 0.01;
        }
        this.melodicMist.material.opacity = 0.3 + melodyVol * 0.4;
        if (this.weatherType === 'mist') { this.melodicMist.material.color.setHex(0xDDFFDD); this.melodicMist.material.opacity = 0.6; }
        else { this.melodicMist.material.color.setHex(0xAAFFAA); }
        this.melodicMist.geometry.attributes.position.needsUpdate = true;
    }

    updateLightning(time, bassIntensity) {
        // [Simplified, now handled in main update loop for coordination with clouds]
    }

    chargeBerryGlow(bassIntensity) {
        const chargeAmount = bassIntensity * 0.05;
        this.trackedTrees.forEach(tree => { if (tree.userData.berries) chargeBerries(tree.userData.berries, chargeAmount); });
        this.trackedShrubs.forEach(shrub => { if (shrub.userData.berries) chargeBerries(shrub.userData.berries, chargeAmount); });
        if (bassIntensity > 0.6) {
            this.trackedTrees.forEach(tree => { if (tree.userData.berries) shakeBerriesLoose(tree.userData.berries, bassIntensity); });
            this.trackedShrubs.forEach(shrub => { if (shrub.userData.berries) shakeBerriesLoose(shrub.userData.berries, bassIntensity); });
        }
    }

    growPlants(intensity) { triggerGrowth(this.trackedTrees, intensity); triggerGrowth(this.trackedMushrooms, intensity); }
    bloomFlora(intensity) { triggerBloom(this.trackedFlowers, intensity); }
    getState() { return this.state; }
    getStormCharge() { return this.stormCharge; }
    getIntensity() { return this.intensity; }
    forceState(state) {
        this.state = state;
        switch (state) {
            case WeatherState.STORM: this.targetIntensity = 1.0; break;
            case WeatherState.RAIN: this.targetIntensity = 0.5; break;
            default: this.targetIntensity = 0;
        }
    }
    dispose() {
        if (this.percussionRain) { this.scene.remove(this.percussionRain); this.percussionRain.geometry.dispose(); this.percussionRain.material.dispose(); }
        if (this.melodicMist) { this.scene.remove(this.melodicMist); this.melodicMist.geometry.dispose(); this.melodicMist.material.dispose(); }
        if (this.lightningLight) { this.scene.remove(this.lightningLight); }
    }
}
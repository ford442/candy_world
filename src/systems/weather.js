// src/systems/weather.js

import * as THREE from 'three';
import { getGroundHeight, uploadPositions, uploadAnimationData, uploadMushroomSpecs, batchMushroomSpawnCandidates, readSpawnCandidates, isWasmReady } from '../utils/wasm-loader.js';
import { chargeBerries, triggerGrowth, triggerBloom, shakeBerriesLoose, updateBerrySeasons, createMushroom, createWaterfall, createLanternFlower } from '../foliage/index.js';
import { createRainbow, uRainbowOpacity } from '../foliage/rainbow.js';
import { getCelestialState, getSeasonalState } from '../core/cycle.js';
import { CYCLE_DURATION, CONFIG } from '../core/config.js';
import { uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor, updateCloudAttraction, isCloudOverTarget } from '../foliage/clouds.js';
import { uSkyDarkness } from '../foliage/sky.js';
import { updateCaveWaterLevel } from '../foliage/cave.js';
import { LegacyParticleSystem } from './adapters/LegacyParticleSystem.js';
import { WasmParticleSystem } from './adapters/WasmParticleSystem.js';
import { foliageClouds } from '../world/state.js';
import { replaceMushroomWithGiant } from '../foliage/mushrooms.js';

// Weather states
export const WeatherState = {
    CLEAR: 'clear',
    RAIN: 'rain',
    STORM: 'storm'
};

const _UP = new THREE.Vector3(0, 1, 0);
const _scratchSunDir = new THREE.Vector3();
const _scratchCelestialForce = new THREE.Vector3();
const _scratchAttraction = new THREE.Vector3();
const _scratchBlack = new THREE.Color(0x000000);

export class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.state = WeatherState.CLEAR;
        this.intensity = 0;
        this.stormCharge = 0;
        
        // Player Control Factor
        this.cloudDensity = 1.0;
        this.cloudRegenRate = 0.0005;
        
        // Ground Water Logic
        this.groundWaterLevel = 0.0; // 0.0 = Dry, 1.0 = Flooded
        this.trackedCaves = [];

        // Particle systems
        this.particles = new WasmParticleSystem();

        this.mushroomWaterfalls = new Map();

        this.lightningLight = null;
        this.lightningTimer = 0;
        this.lightningActive = false;

        this.rainbow = null;
        this.rainbowTimer = 0;
        this.lastState = WeatherState.CLEAR;

        this.trackedTrees = [];
        this.trackedShrubs = [];
        this.trackedFlowers = [];
        this.trackedMushrooms = [];

        this.targetIntensity = 0;
        this.transitionSpeed = 0.02;

        this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();
        this.windSpeed = 0;
        this.windTargetSpeed = 0;
        this.onSpawnFoliage = null;

        this._lastSpawnCheck = 0;
        this._spawnCapPerFrame = 3;
        this._spawnThrottle = 0.5;
        this._spawnQueue = [];
        
        this.fog = scene.fog;
        this.baseFogNear = scene.fog ? scene.fog.near : 20;
        this.baseFogFar = scene.fog ? scene.fog.far : 100;

        this.initParticles();
        this.initLightning();
        this.initRainbow();
    }

    initRainbow() {
        this.rainbow = createRainbow();
        this.rainbow.position.set(0, -20, -100);
        this.rainbow.scale.setScalar(2.0);
        this.scene.add(this.rainbow);
    }

    initParticles() {
        this.particles.init(this.scene);
    }

    registerMushroom(mushroom) {
        if (!mushroom) return;
        if (!this.trackedMushrooms.includes(mushroom)) this.trackedMushrooms.push(mushroom);
    }

    registerCave(cave) {
        if (!this.trackedCaves.includes(cave)) {
            this.trackedCaves.push(cave);
        }
    }

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

    getGlobalLightLevel(celestial, seasonal) {
        const sun = celestial.sunIntensity * (seasonal ? seasonal.sunInclination : 1.0);
        const moon = celestial.moonIntensity * (seasonal ? seasonal.moonPhase : 1.0) * 0.25;
        const stars = 0.05;
        const cloudCover = this.cloudDensity;
        const totalLight = (sun + moon + stars) * (1.0 - (cloudCover * 0.8));
        return Math.min(1.0, totalLight);
    }

    updateEcosystem(dt) {
        // Only run if we have active entities
        if (!foliageClouds || foliageClouds.length === 0 || this.trackedMushrooms.length === 0) return;

        // TRACKING SET: Prevents multiple clouds from picking the same mushroom
        // We rebuild this every frame based on active cloud assignments
        const claimedMushrooms = new Set();

        // 1. Register existing locks first
        foliageClouds.forEach(cloud => {
            if (cloud.userData.targetMushroom) {
                claimedMushrooms.add(cloud.userData.targetMushroom.uuid);
            }
        });

        // 2. Process Clouds
        foliageClouds.forEach(cloud => {
            // Skip dead/falling clouds
            if (cloud.userData.isFalling) {
                // If it had a target, we implicitly release it by not moving towards it
                cloud.userData.targetMushroom = null;
                return;
            }

            // A. Find Target (if none)
            if (!cloud.userData.targetMushroom) {
                let minDist = 1000;
                let candidate = null;

                for (const m of this.trackedMushrooms) {
                    // Rule: Don't target if already claimed by another cloud
                    if (claimedMushrooms.has(m.uuid)) continue;

                    // Rule: Favor Small mushrooms initially to grow them
                    // But if it's already Giant, we can still latch on if we are close (permanent barrier logic)

                    const dist = cloud.position.distanceTo(m.position);
                    if (dist < 50 && dist < minDist) { // 50m scan range
                        minDist = dist;
                        candidate = m;
                    }
                }

                if (candidate) {
                    cloud.userData.targetMushroom = candidate;
                    claimedMushrooms.add(candidate.uuid); // Claim it immediately
                }
            }

            // B. Execute Behavior
            if (cloud.userData.targetMushroom) {
                const target = cloud.userData.targetMushroom;

                // Safety check: Mushroom might have been deleted/replaced
                if (!target.parent) {
                    cloud.userData.targetMushroom = null;
                    return;
                }

                // Steer
                updateCloudAttraction(cloud, target.position, dt);

                // Rain Logic
                if (isCloudOverTarget(cloud, target.position)) {
                    // Only effective if it's actually raining in the world
                    // OR: Do we want these anchored clouds to rain even if global weather is clear?
                    // User said "tied to right there", implies localized rain.
                    // Let's assume if the cloud is there, it's raining on the mushroom.

                    // Increase Wetness
                    if (!target.userData.wetness) target.userData.wetness = 0;
                    target.userData.wetness += dt * 1.5;

                    // Growth Threshold (~3 seconds of dedicated rain)
                    if (target.userData.wetness > 3.0 && target.userData.size !== 'giant') {
                        this.transformMushroom(target);
                    }
                }
            }
        });
    }

    transformMushroom(oldMushroom) {
        const index = this.trackedMushrooms.indexOf(oldMushroom);
        if (index === -1) return;

        // Perform the Swap
        const newGiant = replaceMushroomWithGiant(this.scene, oldMushroom);

        if (newGiant) {
            // Update WeatherSystem Registry
            this.trackedMushrooms[index] = newGiant;

            // Critical: Update the Cloud's reference!
            // Find the cloud that was targeting the old mushroom
            foliageClouds.forEach(c => {
                if (c.userData.targetMushroom === oldMushroom) {
                    c.userData.targetMushroom = newGiant;

                    // Lift the cloud up! Giants are tall.
                    // Smoothly animate y would be better, but immediate jump prevents clipping
                    c.position.y = Math.max(c.position.y, newGiant.position.y + 25);
                }
            });
        }
    }

    update(time, audioData, cycleWeatherBias = null) {
        if (!audioData) return;
        const dt = 0.016;

        this.cloudDensity = Math.min(1.0, this.cloudDensity + this.cloudRegenRate);

        // ECOSYSTEM UPDATE
        this.updateEcosystem(dt);

        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = channels[2]?.volume || 0;
        const celestial = getCelestialState(time); 
        const seasonal = getSeasonalState(time);
        this.currentSeason = seasonal.season;

        const currentPattern = audioData.patternIndex || 0;
        if (currentPattern !== this.lastPatternIndex) {
            this.lastPatternIndex = currentPattern;
        }

        this.updateWeatherState(bassIntensity, melodyVol, groove, cycleWeatherBias, seasonal);

        // --- Ground Water Update ---
        if (this.state === WeatherState.RAIN) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0005);
        } else if (this.state === WeatherState.STORM) {
            this.groundWaterLevel = Math.min(1.0, this.groundWaterLevel + 0.0015);
        } else {
            this.groundWaterLevel = Math.max(0.0, this.groundWaterLevel - 0.0003);
        }

        // Update Caves
        if (this.trackedCaves.length > 0) {
            this.trackedCaves.forEach(cave => {
                updateCaveWaterLevel(cave, this.groundWaterLevel);
            });
        }
        // ---------------------------

        if (this.lastState === WeatherState.STORM && this.state !== WeatherState.STORM) {
            this.rainbowTimer = 45.0;
        }
        this.lastState = this.state;

        if (this.rainbowTimer > 0) {
            this.rainbowTimer -= dt;
            let opacity = 1.0;
            if (this.rainbowTimer > 40.0) opacity = (45.0 - this.rainbowTimer) / 5.0;
            else if (this.rainbowTimer < 5.0) opacity = this.rainbowTimer / 5.0;
            uRainbowOpacity.value = opacity * 0.6;
        } else {
            uRainbowOpacity.value = 0.0;
        }

        this.currentLightLevel = this.getGlobalLightLevel(celestial, seasonal);
        this.targetIntensity *= this.cloudDensity;

        const highVol = channels[3]?.volume || 0;
        const rainbowTarget = (melodyVol * 0.5 + highVol * 0.5) * this.cloudDensity;
        try { if(uCloudRainbowIntensity) uCloudRainbowIntensity.value += (rainbowTarget - uCloudRainbowIntensity.value) * 0.05; } catch(e) {}

        if (this.state === WeatherState.STORM && (bassIntensity > 0.8 || Math.random() < 0.01)) {
            try { if(uCloudLightningStrength) uCloudLightningStrength.value = 1.0; } catch(e) {}
            
            const paletteKeys = Object.keys((CONFIG.noteColorMap && CONFIG.noteColorMap.cloud) || {});
            if (paletteKeys.length > 0) {
                const randomKey = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
                const colorHex = CONFIG.noteColorMap.cloud[randomKey];
                try { if (uCloudLightningColor && uCloudLightningColor.value && uCloudLightningColor.value.setHex) uCloudLightningColor.value.setHex(colorHex); } catch(e) {}
                this.lightningLight.color.setHex(colorHex);
                this.lightningLight.intensity = 10 * this.cloudDensity;
                this.lightningLight.position.set((Math.random()-0.5)*100, 50, (Math.random()-0.5)*100);
                this.lightningActive = true;
            }
        } else {
            try { if(uCloudLightningStrength) uCloudLightningStrength.value *= 0.85; } catch(e) {}
            if (this.lightningActive) {
                this.lightningLight.intensity *= 0.85;
                if (this.lightningLight.intensity < 0.1) this.lightningActive = false;
            }
        }

        this.applyDarknessLogic(celestial, seasonal.moonPhase);

        const sunPower = celestial.sunIntensity * (1.0 - this.cloudDensity * 0.7);
        const moonPower = celestial.moonIntensity * 0.3;
        const globalLight = Math.max(0, sunPower + moonPower);
        const moisture = this.intensity + (this.stormCharge * 0.5);

        let floraFavorability = globalLight * (0.5 + moisture);
        if (moisture > 0.9) floraFavorability *= 0.5;

        let fungiFavorability = (1.0 - globalLight) * (0.2 + moisture * 1.5);
        let lanternFavorability = (this.state === WeatherState.STORM ? 1.0 : 0.0) + (1.0 - globalLight) * 0.2;

        if (this.particles.percussionRain && this.particles.percussionRain.visible) {
            if (this.trackedTrees.length > 0) {
                triggerGrowth(this.trackedTrees, floraFavorability * bassIntensity * 0.1);
            }
            if (this.trackedFlowers.length > 0) {
                triggerGrowth(this.trackedFlowers, floraFavorability * bassIntensity * 0.1);
            }
            // MUSHROOMS removed from here, handled in dedicated logic block below
        }

        // --- MUSHROOM GROWTH/SHRINK LOGIC ---
        // Rain = Grow. No Rain + Sun = Shrink.
        let mushroomRate = 0;
        const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;

        if (isRaining) {
            // Grow: Base rate + bass boost
            mushroomRate = 0.5 + (bassIntensity * 0.5);
        } else {
            if (globalLight > 0.6 && this.cloudDensity < 0.5) {
                // Bright Sun + Dry: Shrink
                mushroomRate = -0.5;
            } else {
                // Night or Cloudy: Neutral / slight decay
                mushroomRate = -0.05;
            }
        }

        if (this.trackedMushrooms.length > 0) {
            // Trigger with calculated rate (can be negative)
            triggerGrowth(this.trackedMushrooms, mushroomRate);
        }
        // ------------------------------------

        this.handleSpawning(time, fungiFavorability, lanternFavorability, globalLight);
        this.updateMushroomWaterfalls(time, bassIntensity);

        this.intensity += (this.targetIntensity - this.intensity) * this.transitionSpeed;

        this.particles.update(time, bassIntensity, melodyVol, this.state, this.weatherType, this.intensity);

        if (this.state === WeatherState.STORM) {
            this.updateLightning(time, bassIntensity);
            this.chargeBerryGlow(bassIntensity);
        }

        if (this.state !== WeatherState.CLEAR) {
            this.stormCharge = Math.min(2.0, this.stormCharge + 0.001);
        } else {
            this.stormCharge = Math.max(0, this.stormCharge - 0.0005);
        }

        this.updateWind(time, audioData, celestial);
        this.updateFog(audioData);
    }

    handleSpawning(time, fungiScore, lanternScore, globalLight) {
        if (time - this._lastSpawnCheck < this._spawnThrottle) return;
        this._lastSpawnCheck = time;

        if (fungiScore > 0.8) {
            if (Math.random() < 0.4) this.spawnFoliage('mushroom', true);
        }
        if (lanternScore > 0.6) {
            if (Math.random() < 0.3) this.spawnFoliage('lantern', false);
        }
        if (globalLight > 0.7 && fungiScore < 0.3) {
             if (Math.random() < 0.2) this.spawnFoliage('flower', false);
        }
    }

    spawnFoliage(type, isGlowing) {
        if (!this.onSpawnFoliage) return;

        const x = (Math.random() - 0.5) * 60;
        const z = (Math.random() - 0.5) * 60;
        const y = getGroundHeight(x, z);

        let object;
        if (type === 'mushroom') {
            object = createMushroom({
                size: 'regular',
                scale: 0.5 + Math.random() * 0.5,
                isBioluminescent: isGlowing
            });
        } else if (type === 'lantern') {
            object = createLanternFlower({
                height: 2.0 + Math.random() * 1.5,
                color: 0xFFaa00
            });
        }

        if (object) {
            object.position.set(x, y, z);
            object.scale.setScalar(0.01);
            this.onSpawnFoliage(object, true, 0);
            if (type === 'mushroom') this.registerMushroom(object);
            if (type === 'lantern') this.registerFlower(object);
        }
    }

    updateWind(time, audioData, celestial) {
        const channels = audioData.channelData || [];
        const highFreqVol = channels[3]?.volume || 0;
        const melodyVol = channels[2]?.volume || 0;

        this.windTargetSpeed = Math.max(highFreqVol, melodyVol * 0.5);
        this.windSpeed += (this.windTargetSpeed - this.windSpeed) * 0.02;

        const rotSpeed = (audioData.beatPhase || 0) * 0.001;
        this.windDirection.applyAxisAngle(_UP, rotSpeed);

        const dayProgress = (time % CYCLE_DURATION) / CYCLE_DURATION;
        const sunAngle = dayProgress * Math.PI * 2;
        _scratchSunDir.set(Math.cos(sunAngle), Math.sin(sunAngle), 0);
        _scratchCelestialForce.copy(_scratchSunDir).negate();
        this.windDirection.lerp(_scratchCelestialForce, 0.1);
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
            _scratchAttraction.set(centerX, 0, centerZ).normalize();
            this.windDirection.lerp(_scratchAttraction, 0.05);
            this.windDirection.normalize();
        }

        const count = this.trackedMushrooms.length;
        if (this.windSpeed > 0.4 && count > 0) {
            const now = time;
            if (now - this._lastSpawnCheck > this._spawnThrottle) {
                this._lastSpawnCheck = now;

                if (!isWasmReady() || typeof batchMushroomSpawnCandidates !== 'function') {
                    let spawned = 0;
                    for (let i = 0; i < this.trackedMushrooms.length && spawned < this._spawnCapPerFrame; i++) {
                        const m = this.trackedMushrooms[i];
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
                                try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) {}
                            } else {
                                this.scene.add(newM);
                                this.registerMushroom(newM);
                            }
                            spawned++;
                        }
                    }
                } else {
                    try {
                        uploadMushroomSpecs(this.trackedMushrooms);
                        const spawnThreshold = 1.0;
                        const minDistance = 3.0;
                        const maxDistance = 8.0;
                        const candidateCount = batchMushroomSpawnCandidates(time, this.windDirection.x, this.windDirection.z, this.windSpeed, count, spawnThreshold, minDistance, maxDistance);
                        if (candidateCount > 0) {
                            const candidates = readSpawnCandidates(candidateCount);
                            let spawned = 0;
                            for (const c of candidates) {
                                if (spawned >= this._spawnCapPerFrame) break;
                                const newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: c.colorIndex });
                                newM.position.set(c.x, c.y, c.z);
                                newM.rotation.y = Math.random() * Math.PI * 2;
                                if (this.onSpawnFoliage) {
                                    try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) {}
                                } else {
                                    this.scene.add(newM);
                                    this.registerMushroom(newM);
                                }
                                spawned++;
                            }
                        }
                    } catch (e) {
                        console.warn('WASM spawn path failed, falling back to JS:', e);
                    }
                }
            }
        }
    }

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

    applyDarknessLogic(celestial, moonPhase) {
        const nightFactor = celestial.moonIntensity; 
        const densityFactor = this.cloudDensity;     
        const moonDarkness = 1.0 - (moonPhase || 0) * 0.5;
        const darkness = nightFactor * densityFactor * moonDarkness * 0.95; 

        if (this.scene.fog && this.scene.fog.color) {
            this.scene.fog.color.lerp(_scratchBlack, darkness);
        }
        uSkyDarkness.value = darkness;
        this.darknessFactor = darkness; 
    }

    updateFog(audioData) {
        if (!this.fog) return;

        let fogMultiplier = 1.0;
        switch (this.state) {
            case WeatherState.RAIN: fogMultiplier = 0.8; break;
            case WeatherState.STORM: fogMultiplier = 0.6; break;
            default: fogMultiplier = 1.0;
        }

        let crescendoFactor = 0;
        if (audioData) {
            const volume = audioData.average || 0;
            crescendoFactor = volume * 0.3;
        }

        const weatherVisibility = (1.0 - this.intensity * (1.0 - fogMultiplier));
        const darknessVisibility = (1.0 - (this.darknessFactor || 0) * 0.7);
        const crescendoVisibility = (1.0 - crescendoFactor);

        const totalVisibility = weatherVisibility * darknessVisibility * crescendoVisibility;

        const targetNear = this.baseFogNear * totalVisibility;
        const targetFar = this.baseFogFar * totalVisibility;

        this.fog.near += (targetNear - this.fog.near) * 0.05;
        this.fog.far += (targetFar - this.fog.far) * 0.05;
    }

    updateBerrySeasonalSize(cyclePos, CYCLE_DURATION) {
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

        this.trackedTrees.forEach(tree => {
            if (tree.userData.berries) updateBerrySeasons(tree.userData.berries, phase, phaseProgress);
        });
        this.trackedShrubs.forEach(shrub => {
            if (shrub.userData.berries) updateBerrySeasons(shrub.userData.berries, phase, phaseProgress);
        });
    }

    updateWeatherState(bass, melody, groove, cycleWeatherBias = null, seasonal = null) {
        let audioState = WeatherState.CLEAR;
        let audioIntensity = 0;
        
        if (bass > 0.7 && groove > 0.5) {
            audioState = WeatherState.STORM;
            audioIntensity = 1.0;
        } else if (bass > 0.3 || melody > 0.4) {
            audioState = WeatherState.RAIN;
            audioIntensity = 0.5;
        }

        if (seasonal) {
            const r = Math.random();
            if (seasonal.season === 'Winter') {
                if (audioState === WeatherState.STORM && r > 0.3) audioState = WeatherState.RAIN;
            }
            if (seasonal.season === 'Summer') {
                if (audioState === WeatherState.RAIN && r > 0.7) audioState = WeatherState.STORM;
            }
            if (seasonal.season === 'Spring') {
                if (audioState === WeatherState.CLEAR && r > 0.9) {
                    audioState = WeatherState.RAIN;
                    audioIntensity = 0.3;
                }
            }
        }

        if (cycleWeatherBias) {
            const biasWeight = 0.4;
            let biasState = WeatherState.CLEAR;
            if (cycleWeatherBias.biasState === 'storm') biasState = WeatherState.STORM;
            else if (cycleWeatherBias.biasState === 'rain') biasState = WeatherState.RAIN;

            if (audioState !== biasState) {
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

    updateLightning(time, bassIntensity) {
        this.lightningTimer -= 0.016;

        if (bassIntensity > 0.8 && this.lightningTimer <= 0 && Math.random() > 0.7) {
            this.lightningActive = true;
            this.lightningTimer = 0.5 + Math.random() * 1.0;
            this.lightningLight.intensity = 5 + Math.random() * 5;
            this.lightningLight.position.set(
                (Math.random() - 0.5) * 60,
                40 + Math.random() * 20,
                (Math.random() - 0.5) * 60
            );
        }

        if (this.lightningActive) {
            this.lightningLight.intensity *= 0.85;
            if (this.lightningLight.intensity < 0.1) {
                this.lightningActive = false;
                this.lightningLight.intensity = 0;
            }
        }
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

    growPlants(intensity) {
        triggerGrowth(this.trackedTrees, intensity);
        triggerGrowth(this.trackedMushrooms, intensity);
    }
    bloomFlora(intensity) {
        triggerBloom(this.trackedFlowers, intensity);
    }
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
        if (this.particles) {
            this.particles.dispose(this.scene);
        }
        if (this.lightningLight) {
            this.scene.remove(this.lightningLight);
        }
        if (this.rainbow) {
            this.scene.remove(this.rainbow);
            this.rainbow.geometry.dispose();
        }
        if (this.mushroomWaterfalls && this.mushroomWaterfalls.size > 0) {
            this.mushroomWaterfalls.forEach(wf => {
                this.scene.remove(wf);
            });
            this.mushroomWaterfalls.clear();
        }
    }
}

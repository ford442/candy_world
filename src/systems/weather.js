// Weather System for Candy World
// Manages audio-reactive weather states: Clear, Rain, Storm
// Triggers berry charging and plant growth

import * as THREE from 'three';
import { calcRainDropY, getGroundHeight, uploadPositions, uploadAnimationData, batchMushroomSpawnCandidates, readSpawnCandidates, isWasmReady } from '../utils/wasm-loader.js';
import { chargeBerries, triggerGrowth, triggerBloom, shakeBerriesLoose, updateBerrySeasons, createMushroom, createWaterfall } from '../foliage/index.js';
import { createRainbow, uRainbowOpacity } from '../foliage/rainbow.js';
import { getCelestialState, getSeasonalState } from '../core/cycle.js'; // Import seasonal helper
import { CYCLE_DURATION, CONFIG } from '../core/config.js'; // Import cycle duration and config
import { uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor } from '../foliage/clouds.js';
import { uSkyDarkness } from '../foliage/sky.js';

// Weather states
export const WeatherState = {
    CLEAR: 'clear',
    RAIN: 'rain',
    STORM: 'storm'
};

// Bolt: Scratch objects to prevent GC in animation loop
const _UP = new THREE.Vector3(0, 1, 0);
const _scratchSunDir = new THREE.Vector3();
const _scratchCelestialForce = new THREE.Vector3();
const _scratchAttraction = new THREE.Vector3();
const _scratchBlack = new THREE.Color(0x000000);

/**
 * Weather System - Audio-reactive weather effects
 */
export class WeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this.state = WeatherState.CLEAR;
        this.intensity = 0;
        this.stormCharge = 0; // Accumulated storm energy
        
        // --- NEW: Player Control Factor ---
        this.cloudDensity = 1.0; // 1.0 = Full weather potential, 0.0 = No rain possible
        this.cloudRegenRate = 0.0005; // Clouds slowly return
        // ----------------------------------
        
        // Particle systems
        this.percussionRain = null;  // Fat droplets (bass triggered)
        this.melodicMist = null;     // Fine spray (melody triggered)

        // Track waterfalls attached to giant mushrooms
        this.mushroomWaterfalls = new Map(); // Store waterfalls: mushroomUuid -> waterfallMesh

        // Lightning
        this.lightningLight = null;
        this.lightningTimer = 0;
        this.lightningActive = false;

        // Rainbow
        this.rainbow = null;
        this.rainbowTimer = 0;
        this.lastState = WeatherState.CLEAR;

        // Tracked objects for growth/charging
        this.trackedTrees = [];
        this.trackedShrubs = [];
        this.trackedFlowers = [];
        this.trackedMushrooms = [];

        // State transition
        this.targetIntensity = 0;
        this.transitionSpeed = 0.02;

        // Wind System
        this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();
        this.windSpeed = 0; // 0-1, driven by audio
        this.windTargetSpeed = 0;
        // Callback for spawning foliage into world (main.js should set this to safeAddFoliage)
        this.onSpawnFoliage = null;

        // Spawn throttling to avoid occasional main-thread spikes from mass spawn checks
        this._lastSpawnCheck = 0;           // last time we ran the heavy spawn path
        this._spawnCapPerFrame = 3;         // maximum mushrooms to spawn per check
        this._spawnThrottle = 0.5;         // seconds between heavy spawn checks
        this._spawnQueue = [];
        

        // Fog reference (set from main.js)
        this.fog = scene.fog;
        this.baseFogNear = scene.fog ? scene.fog.near : 20;
        this.baseFogFar = scene.fog ? scene.fog.far : 100;

        this.initParticles();
        this.initLightning();
        this.initRainbow();
    }

    initRainbow() {
        this.rainbow = createRainbow();
        // Position arc: distant, rising from horizon
        // Scale it up so it encompasses the view
        this.rainbow.position.set(0, -20, -100);
        this.rainbow.scale.setScalar(2.0);
        // It's a ring, so rotation needs to be checked. createRainbow returns upright.
        this.scene.add(this.rainbow);
    }

    /**
     * Initialize percussion rain particles (fat droplets)
     */
    initParticles() {
        // Percussion Rain - Large droplets for bass hits
        const rainCount = 500;
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainNormals = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);
        const rainOffsets = new Float32Array(rainCount);

        for (let i = 0; i < rainCount; i++) {
            // Spread across world
            rainPositions[i * 3] = (Math.random() - 0.5) * 100;
            rainPositions[i * 3 + 1] = 20 + Math.random() * 30;
            rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;

            // Dummy normals
            rainNormals[i * 3] = 0; rainNormals[i * 3 + 1] = 1; rainNormals[i * 3 + 2] = 0;

            rainVelocities[i] = 5 + Math.random() * 5; // Drop speed
            rainOffsets[i] = Math.random() * 50; // Start height variation
        }

        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        rainGeo.setAttribute('normal', new THREE.BufferAttribute(rainNormals, 3));
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
        const mistNormals = new Float32Array(mistCount * 3);

        for (let i = 0; i < mistCount; i++) {
            mistPositions[i * 3] = (Math.random() - 0.5) * 80;
            mistPositions[i * 3 + 1] = Math.random() * 5;
            mistPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;

            // Dummy normals
            mistNormals[i * 3] = 0; mistNormals[i * 3 + 1] = 1; mistNormals[i * 3 + 2] = 0;
        }

        mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
        mistGeo.setAttribute('normal', new THREE.BufferAttribute(mistNormals, 3));

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
     * Register a mushroom so weather can affect it (e.g., wind propagation)
     * @param {THREE.Object3D} mushroom
     */
    registerMushroom(mushroom) {
        if (!mushroom) return;
        if (!this.trackedMushrooms.includes(mushroom)) this.trackedMushrooms.push(mushroom);
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

    // --- NEW: Called when player shoots a cloud ---
    notifyCloudShot(isDaytime) {
        // Reduce density (limiting max rain intensity)
        this.cloudDensity = Math.max(0.2, this.cloudDensity - 0.05);
        
        // Immediate weather reaction?
        // Maybe a small thunderclap or light flash could happen here
    }

    /**
     * Calculate global light level based on celestial and seasonal state
     */
    getGlobalLightLevel(celestial, seasonal) {
        // sunIntensity checks daily cycle (Dawn -> Noon -> Dusk)
        // seasonal.sunInclination checks yearly cycle (Winter -> Summer)
        const sun = celestial.sunIntensity * (seasonal ? seasonal.sunInclination : 1.0);

        // Moon is dim (max ~0.25)
        const moon = celestial.moonIntensity * (seasonal ? seasonal.moonPhase : 1.0) * 0.25;

        const stars = 0.05; // Starlight baseline

        const cloudCover = this.cloudDensity; // 0.0 to 1.0

        // Clouds block light
        const totalLight = (sun + moon + stars) * (1.0 - (cloudCover * 0.8));

        return Math.min(1.0, totalLight);
    }

    /**
     * Main update loop - call every frame
     * @param {number} time - Current time
     * @param {object} audioData - Audio analysis data
     * @param {object} cycleWeatherBias - Optional time-of-day weather bias
     */
    update(time, audioData, cycleWeatherBias = null) {
        if (!audioData) return;

        const dt = 0.016; // Approx delta

        // 0. Regenerate Cloud Density slowly
        this.cloudDensity = Math.min(1.0, this.cloudDensity + this.cloudRegenRate);

        // 1. Get Audio Data
        const bassIntensity = audioData.kickTrigger || 0;
        const groove = audioData.grooveAmount || 0;
        const channels = audioData.channelData || [];
        const melodyVol = channels[2]?.volume || 0;
        const celestial = getCelestialState(time); 
        
        // --- NEW: Get Seasonal Data ---
        const seasonal = getSeasonalState(time);
        this.currentSeason = seasonal.season;
        // ------------------------------

        // 3. Update Weather State (Audio + Time of Day + Season)
        this.updateWeatherState(bassIntensity, melodyVol, groove, cycleWeatherBias, seasonal);

        // Check for Rainbow Trigger (Storm -> Clear/Rain)
        if (this.lastState === WeatherState.STORM && this.state !== WeatherState.STORM) {
            this.rainbowTimer = 45.0; // 45 seconds of rainbow
            // Also play a sound? (TODO)
        }
        this.lastState = this.state;

        // Update Rainbow Opacity
        if (this.rainbowTimer > 0) {
            this.rainbowTimer -= dt;
            // Fade in over 5s, fade out last 5s
            let opacity = 1.0;
            if (this.rainbowTimer > 40.0) opacity = (45.0 - this.rainbowTimer) / 5.0;
            else if (this.rainbowTimer < 5.0) opacity = this.rainbowTimer / 5.0;

            // Pulse with melody/highs
            const pulse = (melodyVol || 0) * 0.2;

            uRainbowOpacity.value = opacity * 0.6; // Max opacity 0.6
        } else {
            uRainbowOpacity.value = 0.0;
        }

        // --- NEW: Calculate Global Light Level ---
        this.currentLightLevel = this.getGlobalLightLevel(celestial, seasonal);
        // -----------------------------------------

        // --- NEW: Scale intensity by Player's Cloud Density ---
        this.targetIntensity *= this.cloudDensity;
        // -----------------------------------------------------

        // --- NEW: Drive Cloud Visuals (Rainbows & Lightning) ---
        // 1. Rainbows: Driven by Melody & Highs
        const highVol = channels[3]?.volume || 0;   // High Hat/FX Channel (already captured above)
        const rainbowTarget = (melodyVol * 0.5 + highVol * 0.5) * this.cloudDensity;
        // Smooth interpolation
        try { uCloudRainbowIntensity.value += (rainbowTarget - uCloudRainbowIntensity.value) * 0.05; } catch(e) {}

        // 2. Lightning: Driven by Bass (Kick) or Random Storm
        if (this.state === WeatherState.STORM && (bassIntensity > 0.8 || Math.random() < 0.01)) {
            // Flash!
            try { uCloudLightningStrength.value = 1.0; } catch(e) {}
            
            // Pick a color based on cloud palette in CONFIG
            const paletteKeys = Object.keys((CONFIG.noteColorMap && CONFIG.noteColorMap.cloud) || {});
            if (paletteKeys.length > 0) {
                const randomKey = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
                const colorHex = CONFIG.noteColorMap.cloud[randomKey];
                try { if (uCloudLightningColor && uCloudLightningColor.value && uCloudLightningColor.value.setHex) uCloudLightningColor.value.setHex(colorHex); } catch(e) {}
                // Also update the scene light to match
                this.lightningLight.color.setHex(colorHex);
                this.lightningLight.intensity = 10 * this.cloudDensity;
                this.lightningLight.position.set((Math.random()-0.5)*100, 50, (Math.random()-0.5)*100);
                this.lightningActive = true;
            }
        } else {
            // Decay lightning
            try { uCloudLightningStrength.value *= 0.85; } catch(e) {}
            if (this.lightningActive) {
                this.lightningLight.intensity *= 0.85;
                if (this.lightningLight.intensity < 0.1) this.lightningActive = false;
            }
        }
        // --------------------------------------------------------

        // --- NEW: Darkness Mechanic ---
        // If it is night (low sun, high moon) AND clouds are dense, darken everything
        this.applyDarknessLogic(celestial, seasonal.moonPhase); // Updated to use real moon phase
        // ------------------------------

        // Trigger Growth/Bloom based on weather active state
        if (this.state === WeatherState.RAIN || this.state === WeatherState.STORM) {
            const growthBase = (this.state === WeatherState.STORM ? 0.2 : 0.1) * bassIntensity;
            const bloomBase = (this.state === WeatherState.STORM ? 0.2 : 0.1) * melodyVol;

            // Sun powers Flowers/Trees, Moon powers Mushrooms
            const solarGrowth = growthBase * (0.5 + celestial.sunIntensity);
            const lunarGrowth = growthBase * (0.5 + celestial.moonIntensity);

            if (this.percussionRain.visible) {
                // Grow trees/flowers with Sun influence
                triggerGrowth(this.trackedTrees, solarGrowth);
                triggerGrowth(this.trackedFlowers, solarGrowth); // Assuming flowers have growth trigger
                
                // Grow Mushrooms with Moon influence
                triggerGrowth(this.trackedMushrooms, lunarGrowth);
            }

            if (this.melodicMist.visible) {
                triggerBloom(this.trackedFlowers, bloomBase * (0.8 + celestial.sunIntensity * 0.4));
            }
        }

        // 5. Update Waterfalls on Giant Mushrooms
        this.updateMushroomWaterfalls(time, bassIntensity);

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

        // Update wind system
        this.updateWind(time, audioData, celestial);

        // Update fog density based on weather
        this.updateFog(audioData);
    }

    /**
     * Update wind direction and speed based on audio
     */
    updateWind(time, audioData, celestial) {
        const channels = audioData.channelData || [];
        const highFreqVol = channels[3]?.volume || 0;
        const melodyVol = channels[2]?.volume || 0;

        this.windTargetSpeed = Math.max(highFreqVol, melodyVol * 0.5);
        this.windSpeed += (this.windTargetSpeed - this.windSpeed) * 0.02;

        // Base rotation from beat
        const rotSpeed = (audioData.beatPhase || 0) * 0.001;
        this.windDirection.applyAxisAngle(_UP, rotSpeed);

        // --- NEW: Celestial Wind Tides ---
        // Calculate approximate sun position (rotating around Z or X)
        const dayProgress = (time % CYCLE_DURATION) / CYCLE_DURATION;
        const sunAngle = dayProgress * Math.PI * 2;
        
        // Sun Vector (approximate) - Reuse scratch vector
        _scratchSunDir.set(Math.cos(sunAngle), Math.sin(sunAngle), 0);
        
        // Calculate celestial force
        // Day: Wind blows AWAY from Sun (Heat push) -> -sunDir
        // Night: Wind blows TOWARDS Moon (Tidal pull). Moon is approx -sunDir.
        // Towards Moon -> Towards -sunDir -> -sunDir.
        // In both cases, the force is roughly opposite the sun's position.
        _scratchCelestialForce.copy(_scratchSunDir).negate();

        // Apply celestial bias to wind (10% influence)
        this.windDirection.lerp(_scratchCelestialForce, 0.1);
        this.windDirection.normalize();
        // ---------------------------------

        // Mushroom Gathering (Attraction)
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
            // Reuse scratch attraction vector
            _scratchAttraction.set(centerX, 0, centerZ).normalize();
            this.windDirection.lerp(_scratchAttraction, 0.05);
            this.windDirection.normalize();
        }

        // ... [Spawning logic remains same] ...
        // (Omitted for brevity, assume WASM/JS fallback exists here as in previous file)
        const count = this.trackedMushrooms.length;
        if (this.windSpeed > 0.4 && count > 0) {
            // Throttle heavy spawn checks to avoid main-thread spikes
            const now = time;
            if (now - this._lastSpawnCheck > this._spawnThrottle) {
                this._lastSpawnCheck = now;

                if (!isWasmReady() || typeof batchMushroomSpawnCandidates !== 'function') {
                    // JS fallback: iterate but cap number of spawns per frame
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
                                try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) { console.warn('onSpawnFoliage failed', e); }
                            } else {
                                this.scene.add(newM);
                                this.registerMushroom(newM);
                            }
                            spawned++;
                        }
                    }
                } else {
                    // WASM path: run batch candidate generation but cap how many we instantiate
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
                            let spawned = 0;
                            for (const c of candidates) {
                                if (spawned >= this._spawnCapPerFrame) break;
                                const newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: c.colorIndex });
                                newM.position.set(c.x, c.y, c.z);
                                newM.rotation.y = Math.random() * Math.PI * 2;
                                if (this.onSpawnFoliage) {
                                    try { this.onSpawnFoliage(newM, true, 0.5); } catch (e) { console.warn('onSpawnFoliage failed', e); }
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
            // If spawn check is throttled this frame, skip to avoid added load
        }
    }

    updateMushroomWaterfalls(time, bassIntensity) {
        // Only active during heavy RAIN or STORM
        const isRaining = this.state !== WeatherState.CLEAR && this.intensity > 0.4;
        
        this.trackedMushrooms.forEach(mushroom => {
            if (mushroom.userData.size === 'giant') {
                const uuid = mushroom.uuid;
                
                if (isRaining) {
                    if (!this.mushroomWaterfalls.has(uuid)) {
                        // Create Waterfall
                        const radius = mushroom.userData.capRadius || 5.0;
                        const height = mushroom.userData.capHeight || 8.0;
                        
                        // Start point: Edge of cap
                        // End point: Ground (approx 0) or base
                        const wf = createWaterfall(
                            new THREE.Vector3(mushroom.position.x + radius * 0.8, height * 0.8, mushroom.position.z),
                            new THREE.Vector3(mushroom.position.x + radius * 1.1, 0, mushroom.position.z),
                            2.0 // Width
                        );
                        
                        this.scene.add(wf);
                        this.mushroomWaterfalls.set(uuid, wf);
                    }

                    // Animate existing waterfall
                    const wf = this.mushroomWaterfalls.get(uuid);
                    if (wf.onAnimate) wf.onAnimate(0.016, time); // Update splashes
                    
                    // Pulse with bass
                    if (bassIntensity > 0.5) {
                        wf.scale.setScalar(1.0 + bassIntensity * 0.1);
                    }
                } else {
                    // Cleanup if not raining
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
        // Darkness Factor: 0 = Normal, 1 = Pitch Black
        // Night * Clouds * (1 - MoonPhase)
        // Full Moon (1.0) = Less Dark. New Moon (0.0) = More Dark.
        
        const nightFactor = celestial.moonIntensity; 
        const densityFactor = this.cloudDensity;     
        const moonDarkness = 1.0 - (moonPhase || 0) * 0.5; // Full moon lights up the night a bit
        
        const darkness = nightFactor * densityFactor * moonDarkness * 0.95; 

        if (this.scene.fog && this.scene.fog.color) {
            this.scene.fog.color.lerp(_scratchBlack, darkness);
        }
        uSkyDarkness.value = darkness;
        this.darknessFactor = darkness; 
    }

    /**
     * Update fog density based on weather state and audio energy (Crescendo Fog)
     * @param {object} audioData - Audio analysis data
     */
    updateFog(audioData) {
        if (!this.fog) return;

        let fogMultiplier = 1.0;
        switch (this.state) {
            case WeatherState.RAIN:
                fogMultiplier = 0.8; // Slightly thicker
                break;
            case WeatherState.STORM:
                fogMultiplier = 0.6; // Much thicker fog
                break;
            default:
                fogMultiplier = 1.0;
        }

        // Crescendo Fog Logic: Density ramps with crescendos (average volume)
        // mixEnergy calculation: active channels * average volume, roughly approximated by average * 2 here
        let crescendoFactor = 0;
        if (audioData) {
            // Use average volume to drive fog density
            const volume = audioData.average || 0;
            // Map volume 0.0-1.0 to fog thickness. High volume = thicker fog (lower multiplier).
            // But "Crescendo Fog" implies it gets denser.
            // Current logic: visibility multiplier. Lower is thicker.
            crescendoFactor = volume * 0.3; // Reduce visibility by up to 30% based on volume
        }

        // Combine Weather Intensity, Darkness Mechanic, AND Crescendo Fog
        // fogMultiplier affects how much the weather intensity reduces visibility.
        // darknessFactor reduces visibility further.
        // crescendoFactor reduces visibility dynamically.

        const weatherVisibility = (1.0 - this.intensity * (1.0 - fogMultiplier));
        const darknessVisibility = (1.0 - (this.darknessFactor || 0) * 0.7);
        const crescendoVisibility = (1.0 - crescendoFactor);

        const totalVisibility = weatherVisibility * darknessVisibility * crescendoVisibility;

        // Smooth transition for fog updates
        const targetNear = this.baseFogNear * totalVisibility;
        const targetFar = this.baseFogFar * totalVisibility;

        this.fog.near += (targetNear - this.fog.near) * 0.05;
        this.fog.far += (targetFar - this.fog.far) * 0.05;
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
     * Determine weather state from audio and time-of-day bias
     */
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

        // --- Seasonal Bias ---
        if (seasonal) {
            const r = Math.random();
            // Winter: Suppress storms, encourage clear/crisp
            if (seasonal.season === 'Winter') {
                if (audioState === WeatherState.STORM && r > 0.3) audioState = WeatherState.RAIN; // Storms become just rain/snow
            }
            // Summer: Encourage Storms
            if (seasonal.season === 'Summer') {
                if (audioState === WeatherState.RAIN && r > 0.7) audioState = WeatherState.STORM; // Heat storms
            }
            // Spring: Encourage Rain
            if (seasonal.season === 'Spring') {
                if (audioState === WeatherState.CLEAR && r > 0.9) {
                    audioState = WeatherState.RAIN; // Random spring showers
                    audioIntensity = 0.3;
                }
            }
        }
        // ---------------------

        // Apply time-of-day / cycle bias if provided (same blending as before)
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
        
        // Color based on weather type
        if (this.weatherType === 'mist') {
            // Morning mist: soft white-blue
            this.percussionRain.material.color.setHex(0xE0F4FF);
        } else if (this.weatherType === 'drizzle') {
            // Evening drizzle: cool gray-blue
            this.percussionRain.material.color.setHex(0x9AB5C8);
        } else if (this.weatherType === 'thunderstorm' || this.state === WeatherState.STORM) {
            // Storm: darker blue with white flashes
            this.percussionRain.material.color.setHex(0x6090B0);
        } else {
            // Default rain
            this.percussionRain.material.color.setHex(0x88CCFF);
        }

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
        const shouldShow = melodyVol > 0.2 || (this.weatherType === 'mist' && this.state === WeatherState.RAIN);
        this.melodicMist.visible = shouldShow;

        if (!shouldShow) return;

        const positions = this.melodicMist.geometry.attributes.position.array;

        // Mist drifts slowly
        for (let i = 0; i < positions.length / 3; i++) {
            const offset = i * 0.1;
            positions[i * 3 + 1] = 1 + Math.sin(time + offset) * 2 * Math.max(melodyVol, 0.3);
            positions[i * 3] += Math.sin(time * 0.5 + offset) * 0.01;
            positions[i * 3 + 2] += Math.cos(time * 0.4 + offset) * 0.01;
        }

        this.melodicMist.material.opacity = 0.3 + melodyVol * 0.4;
        
        // Color based on weather type
        if (this.weatherType === 'mist') {
            // Morning mist: pale green-white
            this.melodicMist.material.color.setHex(0xDDFFDD);
            this.melodicMist.material.opacity = 0.6; // Thicker for morning effect
        } else {
            // Default melodic color
            this.melodicMist.material.color.setHex(0xAAFFAA);
        }
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
        triggerGrowth(this.trackedTrees, intensity);
        triggerGrowth(this.trackedMushrooms, intensity);
    }

    /**
     * Trigger bloom for flowers
     */
    bloomFlora(intensity) {
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
        if (this.rainbow) {
            this.scene.remove(this.rainbow);
            this.rainbow.geometry.dispose();
        }
        // Remove any active waterfalls
        if (this.mushroomWaterfalls && this.mushroomWaterfalls.size > 0) {
            this.mushroomWaterfalls.forEach(wf => {
                this.scene.remove(wf);
                // waterfall components will be disposed by GC or by explicit cleanup if added
            });
            this.mushroomWaterfalls.clear();
        }
    }
}

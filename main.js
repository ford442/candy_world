import * as THREE from 'three';
import { uWindSpeed, uWindDirection, uSkyTopColor, uSkyBottomColor, uHorizonColor, uAtmosphereIntensity, uStarPulse, uStarOpacity, updateMoon, animateFoliage, updateFoliageMaterials, updateFireflies, updateFallingBerries, collectFallingBerries, createFlower, createMushroom } from './src/foliage/index.js';
import { initCelestialBodies } from './src/foliage/celestial-bodies.js';
import { MusicReactivity, updateMusicReactivity } from './src/systems/music-reactivity.js';
import { AudioSystem } from './src/audio/audio-system.js';
import { BeatSync } from './src/audio/beat-sync.js';
import { WeatherSystem, WeatherState } from './src/systems/weather.js';
import { initWasm, isWasmReady } from './src/utils/wasm-loader.js';

// Core imports
import { PALETTE, CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY, DURATION_SUNSET, DURATION_DUSK_NIGHT, DURATION_DEEP_NIGHT } from './src/core/config.js';
import { initScene } from './src/core/init.js';
import { initInput, keyStates } from './src/core/input.js';
import { getCycleState } from './src/core/cycle.js';

// World & System imports
import { initWorld } from './src/world/generation.js';
import { animatedFoliage, foliageGroup, activeVineSwing, foliageClouds } from './src/world/state.js';
import { updatePhysics, player, bpmWind } from './src/systems/physics.js';
import { fireRainbow, updateBlaster } from './src/gameplay/rainbow-blaster.js';
import { updateFallingClouds } from './src/foliage/clouds.js';
import { getGroundHeight } from './src/utils/wasm-loader.js';

// Optimization: Hoist reusable objects to module scope to prevent GC in animation loop
const COLOR_STORM_SKY_TOP = new THREE.Color(0x1A1A2E);
const COLOR_STORM_SKY_BOT = new THREE.Color(0x2E3A59);
const COLOR_STORM_FOG = new THREE.Color(0x4A5568);
const COLOR_RAIN = new THREE.Color(0xA0B5C8);
const COLOR_RAIN_FOG = new THREE.Color(0xC0D0E0);
const COLOR_WIND_VECTOR = new THREE.Vector3(0, 1, 0);

const _weatherBiasOutput = { biasState: 'clear', biasIntensity: 0, type: 'clear' };

// --- Initialization ---

// 1. Scene & Render Loop Setup
const { scene, camera, renderer, ambientLight, sunLight, sunGlow, sunCorona, lightShaftGroup, sunGlowMat, coronaMat } = initScene();

// 2. Audio & Systems
const audioSystem = new AudioSystem();
const beatSync = new BeatSync(audioSystem);
const musicReactivity = new MusicReactivity(scene, {}); // Config moved to internal default or passed if needed
const weatherSystem = new WeatherSystem(scene);

// 3. World Generation
// We need to pass weatherSystem so foliage can register themselves
const { moon, fireflies } = initWorld(scene, weatherSystem);

// Add Celestial Bodies
initCelestialBodies(scene);
// Note: world generation populates animatedFoliage, obstacles, etc. via state.js

// 4. Input Handling
let isNight = false;
let timeOffset = 0;

function toggleDayNight() {
    timeOffset += CYCLE_DURATION / 2;
    // Update UI state
    const currentIsNight = !isNight; // Toggle logic approx
    inputSystem.updateDayNightButtonState(currentIsNight);
}

const inputSystem = initInput(camera, audioSystem, toggleDayNight);
const controls = inputSystem.controls;

// DEV: Demo triggers — press 'F' to trigger a 'C4' note on nearest flower; 'G' to spawn a flower in front of the camera
// This is intentionally small and safe for local testing; remove before production
window.addEventListener('keydown', (e) => {
    try {
        if (!e.key) return;
        const key = e.key.toLowerCase();
        if (key === 'f') {
            let nearest = null;
            let bestDist = Infinity;
            const camPos = camera.position;
            for (let i = 0, l = animatedFoliage.length; i < l; i++) {
                const f = animatedFoliage[i];
                if (!f || f.userData?.type !== 'flower') continue;
                const d = f.position.distanceToSquared(camPos);
                if (d < bestDist) { bestDist = d; nearest = f; }
            }
            if (nearest) {
                musicReactivity.reactObject(nearest, 'C4', 1.0);
                console.log('Demo: triggered C4 on nearest flower', nearest);
            } else {
                console.log('Demo: no flowers found nearby');
            }
        } else if (key === 'g') {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const pos = camera.position.clone().add(dir.multiplyScalar(3));
            const f = createFlower({ shape: 'layered' });
            f.position.copy(pos);
            f.rotation.y = Math.random() * Math.PI * 2;
            foliageGroup.add(f);
            animatedFoliage.push(f);
            console.log('Demo: spawned a flower at', f.position);
        } else if (key === 'h') {
            // Spawn a mushroom in front of the camera for mushroom palette testing
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const pos = camera.position.clone().add(dir.multiplyScalar(3));
            const m = createMushroom({ size: 'regular' });
            m.position.copy(pos);
            m.rotation.y = Math.random() * Math.PI * 2;
            foliageGroup.add(m);
            animatedFoliage.push(m);
            console.log('Demo: spawned a mushroom at', m.position);
        } else if (key === 't') {
            // Trigger C4 on nearest mushroom
            let nearest = null;
            let bestDist = Infinity;
            const camPos = camera.position;
            for (let i = 0, l = animatedFoliage.length; i < l; i++) {
                const f = animatedFoliage[i];
                if (!f || f.userData?.type !== 'mushroom') continue;
                const d = f.position.distanceToSquared(camPos);
                if (d < bestDist) { bestDist = d; nearest = f; }
            }
            if (nearest) {
                musicReactivity.reactObject(nearest, 'C4', 1.0);
                console.log('Demo: triggered C4 on nearest mushroom', nearest);
            } else {
                console.log('Demo: no mushrooms found nearby');
            }
        }
    } catch (err) {
        console.warn('Demo trigger error', err);
    }
});

// Mouse input: Rainbow Blaster (click while pointer locked)
window.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const origin = camera.position.clone().add(dir.clone().multiplyScalar(1.0));
        origin.y -= 0.2; // Lower slightly
        fireRainbow(scene, origin, dir);
    }
});

// --- Animation Loop State ---
const clock = new THREE.Clock();
let gameTime = 0; // Accumulates based on BPM
let audioState = null;
let lastBeatPhase = 0;
let beatFlashIntensity = 0;
let cameraZoomPulse = 0;
const baseFOV = 75;

// Register Beat Effects
beatSync.onBeat((state) => {
    const kickTrigger = state?.kickTrigger || 0;
    if (kickTrigger > 0.2) {
        beatFlashIntensity = Math.max(beatFlashIntensity, 0.4 + kickTrigger * 0.5);
        cameraZoomPulse = Math.max(cameraZoomPulse, 1 + kickTrigger * 3);
    }
    if (typeof uStarPulse !== 'undefined') {
        uStarPulse.value += 0.5 * (kickTrigger + 0.1);
    }
});

function getWeatherForTimeOfDay(cyclePos, audioData) {
    // Duplicate logic from original main.js for now, or move to weather.js as a static helper?
    // It's used to drive weather bias.
    // Let's keep it here for now as it orchestrates the cycle.
    const SUNRISE = DURATION_SUNRISE;
    const DAY = DURATION_DAY;
    const SUNSET = DURATION_SUNSET;
    const DUSK = 180; // DURATION_DUSK_NIGHT
    
    // Default reset
    _weatherBiasOutput.biasState = 'clear';
    _weatherBiasOutput.biasIntensity = 0;
    _weatherBiasOutput.type = 'clear';

    if (cyclePos < SUNRISE + 60) {
        const progress = (cyclePos / (SUNRISE + 60));
        _weatherBiasOutput.biasState = 'rain';
        _weatherBiasOutput.biasIntensity = 0.3 * (1 - progress);
        _weatherBiasOutput.type = 'mist';
    }
    else if (cyclePos > SUNRISE + 120 && cyclePos < SUNRISE + DAY - 60) {
        const stormChance = 0.0003;
        if (Math.random() < stormChance) {
             _weatherBiasOutput.biasState = 'storm';
             _weatherBiasOutput.biasIntensity = 0.7 + Math.random() * 0.3;
             _weatherBiasOutput.type = 'thunderstorm';
        }
    }
    else if (cyclePos > SUNRISE + DAY && cyclePos < SUNRISE + DAY + SUNSET + DUSK / 2) {
        const progress = (cyclePos - SUNRISE - DAY) / (SUNSET + DUSK / 2);
         _weatherBiasOutput.biasState = 'rain';
         _weatherBiasOutput.biasIntensity = 0.3 + progress * 0.2;
         _weatherBiasOutput.type = 'drizzle';
    }

    return _weatherBiasOutput;
}

function animate() {
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);

    audioState = audioSystem.update();
    beatSync.update();

    // Time Dilation based on BPM (Inverse: Higher BPM = Slower Time)
    // Base BPM = 120. At 240 BPM, speed is 0.5. At 60 BPM, speed is 2.0.
    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    gameTime += delta * timeFactor;
    
    const t = gameTime; // Use gameTime instead of clock.getElapsedTime()

    // Cycle Update
    const effectiveTime = t + timeOffset;
    const cyclePos = effectiveTime % CYCLE_DURATION;
    const cycleWeatherBias = getWeatherForTimeOfDay(cyclePos, audioState);
    
    // Weather Update
    weatherSystem.update(t, audioState, cycleWeatherBias);

    // Sync TSL Wind
    uWindSpeed.value = 1.0 + weatherSystem.windSpeed * 4.0;
    uWindDirection.value.copy(weatherSystem.windDirection);

    const currentBeatPhase = audioState?.beatPhase || 0;

    // Beat Detection
    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            beatFlashIntensity = 0.5 + kickTrigger * 0.5;
            cameraZoomPulse = 2 + kickTrigger * 3;
        }
    }
    lastBeatPhase = currentBeatPhase;

    // Effects Decay
    if (beatFlashIntensity > 0) {
        beatFlashIntensity *= 0.9;
        if (beatFlashIntensity < 0.01) beatFlashIntensity = 0;
    }
    if (cameraZoomPulse > 0) {
        camera.fov = baseFOV - cameraZoomPulse;
        camera.updateProjectionMatrix();
        cameraZoomPulse *= 0.85;
        if (cameraZoomPulse < 0.1) {
            cameraZoomPulse = 0;
            camera.fov = baseFOV;
            camera.updateProjectionMatrix();
        }
    }

    // Cycle & Visuals
    const currentState = getCycleState(effectiveTime);
    weatherSystem.updateBerrySeasonalSize(cyclePos, CYCLE_DURATION);

    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET;
    isNight = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    // Weather Visuals
    const weatherIntensity = weatherSystem.getIntensity();
    const weatherState = weatherSystem.getState();
    
    const baseSkyTop = currentState.skyTop.clone();
    const baseSkyBot = currentState.skyBot.clone();
    const baseFog = currentState.fog.clone();
    
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
    scene.fog.color.copy(baseFog);

    const targetNear = isNight ? 5 : 20;
    const targetFar = isNight ? 40 : 100;
    scene.fog.near += (targetNear - scene.fog.near) * delta * 0.5;
    scene.fog.far += (targetFar - scene.fog.far) * delta * 0.5;

    let sunIntensity = currentState.sunInt;
    let ambIntensity = currentState.ambInt;
    
    if (weatherState === WeatherState.STORM) {
        sunIntensity *= (1 - weatherIntensity * 0.7);
        ambIntensity *= (1 - weatherIntensity * 0.5);
    } else if (weatherState === WeatherState.RAIN) {
        sunIntensity *= (1 - weatherIntensity * 0.3);
        ambIntensity *= (1 - weatherIntensity * 0.2);
    }
    
    sunLight.color.copy(currentState.sun);
    sunLight.intensity = sunIntensity;
    ambientLight.color.copy(currentState.amb);
    ambientLight.intensity = ambIntensity + beatFlashIntensity * 0.5;

    // Sun/Moon Position
    if (cyclePos < 540) {
        const sunProgress = cyclePos / 540;
        const angle = sunProgress * Math.PI;
        const r = 100;
        sunLight.position.set(Math.cos(angle) * -r, Math.sin(angle) * r, 20);
        sunLight.visible = true;
        sunGlow.visible = true;
        sunCorona.visible = true;
        moon.visible = false;

        sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
        sunGlow.lookAt(camera.position);
        sunCorona.position.copy(sunLight.position.clone().normalize().multiplyScalar(390));
        sunCorona.lookAt(camera.position);
        lightShaftGroup.position.copy(sunLight.position.clone().normalize().multiplyScalar(380));
        lightShaftGroup.lookAt(camera.position);

        // Sun Visual Tweaks (Glow/Shafts)
        let glowIntensity = 0.25;
        let coronaIntensity = 0.15;
        let shaftIntensity = 0.0;
        let shaftVisible = false;
        
        if (sunProgress < 0.15) {
            const factor = 1.0 - (sunProgress / 0.15);
            glowIntensity = 0.25 + factor * 0.35;
            coronaIntensity = 0.15 + factor * 0.25;
            shaftIntensity = factor * 0.12;
            shaftVisible = true;
            sunGlowMat.color.setHex(0xFFB366);
            coronaMat.color.setHex(0xFFD6A3);
        } else if (sunProgress > 0.85) {
            const factor = (sunProgress - 0.85) / 0.15;
            glowIntensity = 0.25 + factor * 0.45;
            coronaIntensity = 0.15 + factor * 0.35;
            shaftIntensity = factor * 0.18;
            shaftVisible = true;
            sunGlowMat.color.setHex(0xFF9966);
            coronaMat.color.setHex(0xFFCC99);
        } else {
            sunGlowMat.color.setHex(0xFFE599);
            coronaMat.color.setHex(0xFFF4D6);
        }
        
        sunGlowMat.opacity = glowIntensity;
        coronaMat.opacity = coronaIntensity;
        lightShaftGroup.visible = shaftVisible;
        if (shaftVisible) {
            lightShaftGroup.rotation.z += delta * 0.1;
            lightShaftGroup.children.forEach(shaft => {
                shaft.material.opacity = shaftIntensity;
            });
        }
    } else {
        sunLight.visible = false;
        sunGlow.visible = false;
        sunCorona.visible = false;
        lightShaftGroup.visible = false;
        moon.visible = true;

        const nightProgress = (cyclePos - 540) / (CYCLE_DURATION - 540);
        const moonAngle = nightProgress * Math.PI;
        const r = 90;
        moon.position.set(Math.cos(moonAngle) * -r, Math.sin(moonAngle) * r, -30);
        moon.lookAt(0,0,0);
        updateMoon(moon, delta, audioState);
    }

    // Star Opacity
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

    // Foliage Materials
    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';
    updateFoliageMaterials(audioState, isNight, weatherStateStr, weatherIntensity);

    // Deep Night
    const deepNightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT;
    const deepNightEnd = deepNightStart + DURATION_DEEP_NIGHT;
    const isDeepNight = (cyclePos >= deepNightStart && cyclePos < deepNightEnd);

    // Music Reactivity Update (Split-Channel System)
    musicReactivity.update(audioState);

    // Handle Moon Blink (Visual/Gameplay Effect)
    // We check specific channels roughly corresponding to "Percussion/Tree" equivalent if possible,
    // or just check if any low-end (bass/tree-like) channel is active for moon blink.
    // For now, let's keep it simple: if there is strong bass, blink moon.
    // Or better: integrate into musicReactivity logic later.
    // To preserve existing behavior without the old loop:
    if (isNight && audioState?.channelData) {
        // Simple check: if channel 2 (often snare/tree in old mapping) is active
        const treeChannel = audioState.channelData[2] || audioState.channelData[0]; // fallback
        if (treeChannel && treeChannel.trigger > 0.5) {
             triggerMoonBlink(moon);
        }
    }

    const camPos = camera.position;
    const maxAnimationDistance = 50;
    const maxDistanceSq = maxAnimationDistance * maxAnimationDistance;
    
    // Time budgeting: Limit material updates to avoid audio stutter
    // Allocate max 2ms per frame for foliage updates (leaves ~14ms for audio processing at 60fps)
    const maxFoliageUpdateTime = 2; // milliseconds
    const frameStartTime = performance.now();
    let foliageUpdatesThisFrame = 0;
    const maxFoliageUpdates = 50; // Max number of foliage objects to update per frame

    for (let i = 0, l = animatedFoliage.length; i < l; i++) {
        const f = animatedFoliage[i];
        const distSq = f.position.distanceToSquared(camPos);
        if (distSq > maxDistanceSq) continue;
        
        // Check time budget
        if (performance.now() - frameStartTime > maxFoliageUpdateTime) {
            break; // Skip remaining updates this frame to preserve audio performance
        }
        
        // Limit number of updates per frame
        if (foliageUpdatesThisFrame >= maxFoliageUpdates) {
            break;
        }

        animateFoliage(f, t, audioState, !isNight, isDeepNight);
        foliageUpdatesThisFrame++;
    }

    // Fireflies
    if (fireflies) {
        fireflies.visible = isDeepNight;
        if (isDeepNight) {
            updateFireflies(fireflies, t, delta);
        }
    }

    // Update Berries & Physics
    updateFallingBerries(delta);
    const berriesCollected = collectFallingBerries(camera.position, 1.5);
    if (berriesCollected > 0) {
        player.energy = Math.min(player.maxEnergy, player.energy + berriesCollected * 0.5);
    }
    player.energy = Math.max(0, player.energy - delta * 0.1);

    // Player Physics
    updatePhysics(delta, camera, controls, keyStates, audioState);

    // Gameplay: Blaster projectiles & falling clouds
    updateBlaster(delta, scene, weatherSystem, t);
    updateFallingClouds(delta, foliageClouds, getGroundHeight);

    renderer.render(scene, camera);
}

// Start
initWasm().then((wasmLoaded) => {
    console.log(`WASM module ${wasmLoaded ? 'active' : 'using JS fallbacks'}`);
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = false;
        startButton.innerText = 'Start Exploration 🚀';
    }
    renderer.setAnimationLoop(animate);
    // Test hook: signal that the scene/animation loop is running
    try { window.__sceneReady = true; } catch (e) {}
});

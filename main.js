import * as THREE from 'three';
import { uWindSpeed, uWindDirection, uSkyTopColor, uSkyBottomColor, uHorizonColor, uAtmosphereIntensity, uStarPulse, uStarOpacity, uAuroraIntensity, uAuroraColor, uAudioLow, uAudioHigh, createAurora, updateMoon, animateFoliage, updateFoliageMaterials, updateFireflies, updateFallingBerries, collectFallingBerries, createFlower, createMushroom, validateNodeGeometries } from './src/foliage/index.js';
import { initCelestialBodies } from './src/foliage/celestial-bodies.js';
import { MusicReactivitySystem } from './src/systems/music-reactivity.js';
import { AudioSystem } from './src/audio/audio-system.js';
import { BeatSync } from './src/audio/beat-sync.js';
import { WeatherSystem, WeatherState } from './src/systems/weather.js';
import { initWasm, initWasmParallel, isWasmReady, LOADING_PHASES } from './src/utils/wasm-loader.js';
import { profiler } from './src/utils/profiler.js';

// Core imports
import { PALETTE, CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY, DURATION_SUNSET, DURATION_DUSK_NIGHT, DURATION_DEEP_NIGHT } from './src/core/config.js';
import { initScene, forceFullSceneWarmup } from './src/core/init.js';
import { initInput, keyStates } from './src/core/input.js';
import { getCycleState } from './src/core/cycle.js';

// World & System imports
import { initWorld } from './src/world/generation.ts';
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

const _scratchBaseSkyTop = new THREE.Color();
const _scratchBaseSkyBot = new THREE.Color();
const _scratchBaseFog = new THREE.Color();
const _scratchSunVector = new THREE.Vector3();
const _scratchAuroraColor = new THREE.Color();

const _weatherBiasOutput = { biasState: 'clear', biasIntensity: 0, type: 'clear' };

// --- Initialization ---

// 1. Scene & Render Loop Setup
const { scene, camera, renderer, ambientLight, sunLight, sunGlow, sunCorona, lightShaftGroup, sunGlowMat, coronaMat } = initScene();

// 2. Audio & Systems
const audioSystem = new AudioSystem();
const beatSync = new BeatSync(audioSystem);
const musicReactivity = new MusicReactivitySystem(scene, {}); // Config moved to internal default or passed if needed
const weatherSystem = new WeatherSystem(scene);

// 3. World Generation
// We need to pass weatherSystem so foliage can register themselves
if (window.setLoadingStatus) window.setLoadingStatus("Loading World Map...");
const { moon, fireflies } = initWorld(scene, weatherSystem);

// Add Celestial Bodies
initCelestialBodies(scene);

// Add Spectrum Aurora
const aurora = createAurora();
scene.add(aurora);

// Validate node material geometries to avoid TSL attribute errors
validateNodeGeometries(scene);
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
        if (key === 'p') {
            profiler.toggle();
        } else if (key === 'f') {
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
    profiler.startFrame();

    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);

    audioState = profiler.measure('Audio', () => audioSystem.update());
    profiler.measure('BeatSync', () => beatSync.update());

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
    profiler.measure('Weather', () => {
        weatherSystem.update(t, audioState, cycleWeatherBias);
        weatherSystem.updateBerrySeasonalSize(cyclePos, CYCLE_DURATION);
    });

    // Sync TSL Wind with BPM modulation
    // Map BPM (60-180 range approx) to a wind multiplier
    const activeBPM = audioState?.bpm || 120; // Renamed to avoid confusion and ensure definition
    const bpmWindFactor = THREE.MathUtils.clamp((activeBPM - 60) / 120, 0, 1.5);
    const baseWind = 1.0 + weatherSystem.windSpeed * 4.0;

    // Smoothly interpolate wind speed changes to avoid jerky TSL updates
    const targetWindSpeed = baseWind * (1.0 + bpmWindFactor * 0.5);
    // Use a simple lerp for smoothing, assuming 60fps
    uWindSpeed.value = THREE.MathUtils.lerp(uWindSpeed.value, targetWindSpeed, 0.05);

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
    // Use weatherSystem's target palette mode (from pattern)
    const currentState = getCycleState(effectiveTime, weatherSystem.targetPaletteMode || 'standard');
    // weatherSystem.updateBerrySeasonalSize called earlier in Weather block

    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET;
    isNight = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    // Weather Visuals
    const weatherIntensity = weatherSystem.getIntensity();
    const weatherState = weatherSystem.getState();
    
    // Bolt: Use scratch objects to prevent GC
    const baseSkyTop = _scratchBaseSkyTop.copy(currentState.skyTop);
    const baseSkyBot = _scratchBaseSkyBot.copy(currentState.skyBot);
    const baseFog = _scratchBaseFog.copy(currentState.fog);
    
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

        // Bolt: Reuse scratch vector to prevent GC (3 vectors per frame)
        _scratchSunVector.copy(sunLight.position).normalize();

        sunGlow.position.copy(_scratchSunVector).multiplyScalar(400);
        sunGlow.lookAt(camera.position);
        sunCorona.position.copy(_scratchSunVector).multiplyScalar(390);
        sunCorona.lookAt(camera.position);
        lightShaftGroup.position.copy(_scratchSunVector).multiplyScalar(380);
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
            shaftVisible = false; // DISABLED: Light shafts cause 2-5s freeze during sunrise when viewing sun directly
            sunGlowMat.color.setHex(0xFFB366);
            coronaMat.color.setHex(0xFFD6A3);
        } else if (sunProgress > 0.85) {
            const factor = (sunProgress - 0.85) / 0.15;
            glowIntensity = 0.25 + factor * 0.45;
            coronaIntensity = 0.15 + factor * 0.35;
            shaftIntensity = factor * 0.18;
            shaftVisible = false; // DISABLED: Light shafts cause 2-5s freeze during sunset when viewing sun directly
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

    // Aurora Update (Visible only at night, intensity driven by high-freq/melody channels if avail)
    // We'll base it on star opacity for visibility, and mix in some audio reactivity
    const baseAuroraVis = starOp * 0.8; // Max 0.8 visibility at night

    // Update Water Uniforms
    if (audioState) {
        const kick = audioState.kickTrigger || 0;
        uAudioLow.value = THREE.MathUtils.lerp(uAudioLow.value, kick, 0.2);

        let high = 0;
        if (audioState.channelData && audioState.channelData.length > 5) {
             const ch5 = audioState.channelData[5].trigger || 0;
             const ch6 = audioState.channelData[6] ? (audioState.channelData[6].trigger || 0) : 0;
             high = Math.max(ch5, ch6);
        }
        uAudioHigh.value = THREE.MathUtils.lerp(uAudioHigh.value, high, 0.2);
    }

    // Simple audio reactivity for Aurora (using generic audioState.energy or high channels)
    // If we have channels, grab a high-freq one (e.g. 5 or 6)
    let auroraAudioBoost = 0.0;
    if (audioState && audioState.channelData && audioState.channelData.length > 4) {
        // Use channel 5 (often leads/pads)
        auroraAudioBoost = audioState.channelData[4].trigger || 0;
    } else if (audioState) {
        // Fallback to average energy
        auroraAudioBoost = (audioState.energy || 0) * 2.0;
    }

    const targetAuroraInt = baseAuroraVis * (0.3 + auroraAudioBoost * 0.7); // Base glow + reactive boost
    uAuroraIntensity.value = THREE.MathUtils.lerp(uAuroraIntensity.value, targetAuroraInt, delta * 2);

    // Aurora Color Shift (Slowly rotate hue or react to chords)
    // For now, let's just shift hue slowly with time
    const hue = (t * 0.05) % 1.0;
    // Bolt Optimization: Use scratch color to avoid per-frame GC
    _scratchAuroraColor.setHSL(hue, 1.0, 0.5);
    // If heavy bass, shift to purple/red?
    if (beatFlashIntensity > 0.2) {
        _scratchAuroraColor.setHSL(0.8 + beatFlashIntensity * 0.1, 1.0, 0.6); // Pink/Red shift
    }
    uAuroraColor.value.copy(_scratchAuroraColor);

    // Foliage Materials
    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';
    updateFoliageMaterials(audioState, isNight, weatherStateStr, weatherIntensity);

    // Deep Night
    const deepNightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT;
    const deepNightEnd = deepNightStart + DURATION_DEEP_NIGHT;
    const isDeepNight = (cyclePos >= deepNightStart && cyclePos < deepNightEnd);

    // Foliage Animation & Reactivity (Delegated to MusicReactivitySystem)
    profiler.measure('MusicReact', () => {
        musicReactivity.update(t, audioState, weatherSystem, animatedFoliage, camera, isNight, isDeepNight, moon);
    });

    // Fireflies
    if (fireflies) {
        fireflies.visible = isDeepNight;
        if (isDeepNight) {
            updateFireflies(fireflies, t, delta);
        }
    }

    // Player Physics
    profiler.measure('Physics', () => {
        updatePhysics(delta, camera, controls, keyStates, audioState);
    });

    // Gameplay: Blaster projectiles & falling clouds & Berries
    // Reordered slightly to group them as per profiler instruction
    profiler.measure('Gameplay', () => {
        updateFallingBerries(delta);
        const berriesCollected = collectFallingBerries(camera.position, 1.5);
        if (berriesCollected > 0) {
            player.energy = Math.min(player.maxEnergy, player.energy + berriesCollected * 0.5);
        }
        player.energy = Math.max(0, player.energy - delta * 0.1);

        updateBlaster(delta, scene, weatherSystem, t);
        updateFallingClouds(delta, foliageClouds, getGroundHeight);
    });

    profiler.measure('Render', () => renderer.render(scene, camera));

    profiler.endFrame();
}

initWasm().then(async (wasmLoaded) => { // Mark as async
    console.log(`WASM module ${wasmLoaded ? 'active' : 'using JS fallbacks'}`);

    // --- NUCLEAR WARMUP: FORCE SHADER COMPILATION ---
    // Create dummy objects for everything that might spawn later
    const dummyGroup = new THREE.Group();
    dummyGroup.position.set(0, -9999, 0); // Hide underground
    scene.add(dummyGroup);

    // 1. Spawn Dummy Flora
    const dummyFlower = createFlower({ shape: 'layered' });
    const dummyMushroom = createMushroom({ size: 'regular' });
    dummyGroup.add(dummyFlower);
    dummyGroup.add(dummyMushroom);

    // 2. Fire Dummy Projectile
    const dummyOrigin = new THREE.Vector3(0, -9999, 0);
    const dummyDir = new THREE.Vector3(0, 1, 0);
    fireRainbow(scene, dummyOrigin, dummyDir);

    if (window.setLoadingStatus) window.setLoadingStatus("Compiling Shaders... (This may take a moment)");

    // 3. FORCE COMPILATION
    // This makes the renderer look at the whole scene and build shaders NOW.
    try {
        await renderer.compileAsync(scene, camera);
        await forceFullSceneWarmup(renderer, scene, camera);
        console.log("✅ Scene shaders pre-compiled (Nuclear Warmup complete).");
    } catch (e) {
        console.warn("Shader compile error:", e);
    }

    // 4. Cleanup (Remove from scene, but DO NOT Dispose geometries/materials)
    scene.remove(dummyGroup);

    // 5. Initialize camera position to ground height (ensures player doesn't start in mid-air or underground)
    const initialGroundY = getGroundHeight(camera.position.x, camera.position.z);
    camera.position.y = initialGroundY + 1.8; // Player eye height is 1.8 above ground
    console.log(`[Startup] Camera positioned at ground height: y=${camera.position.y.toFixed(2)}`);

    if (window.setLoadingStatus) window.setLoadingStatus("Entering Candy World...");

    setTimeout(() => {
        if (window.hideLoadingScreen) window.hideLoadingScreen();
    }, 500);

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = false;
        startButton.innerText = 'Start Exploration 🚀';
    }

    renderer.setAnimationLoop(animate);
    try { window.__sceneReady = true; } catch (e) {}
});
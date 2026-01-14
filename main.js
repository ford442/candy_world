import * as THREE from 'three';
import './style.css';
import { uWindSpeed, uWindDirection, uSkyTopColor, uSkyBottomColor, uHorizonColor, uAtmosphereIntensity, uStarPulse, uStarOpacity, uAuroraIntensity, uAuroraColor, uAudioLow, uAudioHigh, uGlitchIntensity, uChromaticIntensity, uTime, createAurora, createChromaticPulse, updateMoon, animateFoliage, updateFoliageMaterials, updateFireflies, updateFallingBerries, collectFallingBerries, createFlower, createMushroom, validateNodeGeometries, createMelodyRibbon, updateMelodyRibbons, createMelodyMirror, createSparkleTrail, updateSparkleTrail, createImpactSystem } from './src/foliage/index.js';
import { initCelestialBodies } from './src/foliage/celestial-bodies.js';
import { InteractionSystem } from './src/systems/interaction.js';
import { musicReactivitySystem } from './src/systems/music-reactivity.js';
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
import { initWorld, generateMap } from './src/world/generation.ts';
import { animatedFoliage, foliageGroup, activeVineSwing, foliageClouds, foliageMushrooms } from './src/world/state.js';
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

const _scratchBaseSkyTop = new THREE.Color();
const _scratchBaseSkyBot = new THREE.Color();
const _scratchBaseFog = new THREE.Color();
const _scratchSunVector = new THREE.Vector3();
const _scratchAuroraColor = new THREE.Color();

const _weatherBiasOutput = { biasState: 'clear', biasIntensity: 0, type: 'clear' };

// --- Initialization ---

// 1. Scene & Render Loop Setup
const { scene, camera, renderer, ambientLight, sunLight, sunGlow, sunCorona, lightShaftGroup, sunGlowMat, coronaMat } = initScene();

// 2. Audio & Systems (Initialize but defer heavy loading)
const audioSystem = new AudioSystem();
const beatSync = new BeatSync(audioSystem);
const weatherSystem = new WeatherSystem(scene);

// 3. World Generation (Critical - load immediately)
if (window.setLoadingStatus) window.setLoadingStatus("Loading World Map...");

// CHANGE: Load only the base world (sky/ground) initially, defer content
const { moon, fireflies } = initWorld(scene, weatherSystem, false);

// Initialize Music Reactivity with dependencies
musicReactivitySystem.init(scene, weatherSystem);
// Explicitly register moon (cleaner than traversing scene later)
musicReactivitySystem.registerMoon(moon);

// Hook up audio system note events to music reactivity
if (audioSystem.onNote) {
    audioSystem.onNote((note, velocity, channel) => {
        musicReactivitySystem.handleNoteOn(note, velocity, channel);
    });
} else {
    // If not, we might need to modify AudioSystem or use a polling approach in animate()
    // For now, let's assume we will add setNoteCallback to AudioSystem
    audioSystem.setNoteCallback((note, velocity, channel) => {
         musicReactivitySystem.handleNoteOn(note, velocity, channel);
    });
}


// Validate node material geometries to avoid TSL attribute errors
validateNodeGeometries(scene);

// Defer non-critical visual elements to load after basic scene is ready
let aurora = null;
let chromaticPulse = null;
let celestialBodiesInitialized = false;
let melodyRibbon = null;
let sparkleTrail = null;
let impactSystem = null;

// Function to initialize deferred visual elements
function initDeferredVisuals() {
    if (!aurora) {
        aurora = createAurora();
        scene.add(aurora);
        console.log('[Deferred] Aurora initialized');
    }
    
    if (!chromaticPulse) {
        chromaticPulse = createChromaticPulse();
        camera.add(chromaticPulse);
        console.log('[Deferred] Chromatic Pulse initialized');
    }

    if (!celestialBodiesInitialized) {
        initCelestialBodies(scene);
        celestialBodiesInitialized = true;
        console.log('[Deferred] Celestial bodies initialized');
    }

    if (!melodyRibbon) {
        melodyRibbon = createMelodyRibbon(scene);
        console.log('[Deferred] Melody Ribbon initialized');
    }

    if (!sparkleTrail) {
        sparkleTrail = createSparkleTrail();
        scene.add(sparkleTrail);
        console.log('[Deferred] Sparkle Trail initialized');
    }

    if (!impactSystem) {
        impactSystem = createImpactSystem();
        scene.add(impactSystem);
        console.log('[Deferred] Impact System initialized');
    }
}

// 4. Input Handling
let isNight = false;
let timeOffset = 0;

function toggleDayNight() {
    timeOffset += CYCLE_DURATION / 2;
    const currentIsNight = !isNight;
    inputSystem.updateDayNightButtonState(currentIsNight);
}

const inputSystem = initInput(camera, audioSystem, toggleDayNight);
const controls = inputSystem.controls;

// Initialize Interaction System
const interactionSystem = new InteractionSystem(camera, inputSystem.updateReticleState);

// DEV: Demo triggers
window.addEventListener('keydown', (e) => {
    try {
        if (!e.key) return;
        const key = e.key.toLowerCase();
        if (key === 'p') {
            profiler.toggle();
        } else if (key === 'f') {
            // Demo logic...
        }
    } catch (err) {
        console.warn('Demo trigger error', err);
    }
});

// Mouse input: Rainbow Blaster (click while pointer locked)
window.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement) {
        // Left Click (0) -> Standard Interaction
        if (e.button === 0) {
            // First check if we are interacting with an object
            const handled = interactionSystem.triggerClick();

            // If interaction didn't handle it, fire rainbow blaster
            if (!handled) {
                const dir = new THREE.Vector3();
                camera.getWorldDirection(dir);
                const origin = camera.position.clone().add(dir.clone().multiplyScalar(1.0));
                origin.y -= 0.2; // Lower slightly
                fireRainbow(scene, origin, dir);
            }
        }
    }
});

// --- Animation Loop State ---
const clock = new THREE.Clock();
let gameTime = 0;
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
    const SUNRISE = DURATION_SUNRISE;
    const DAY = DURATION_DAY;
    const SUNSET = DURATION_SUNSET;
    const DUSK = 180;
    
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

    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    gameTime += delta * timeFactor;
    
    // Update global shader time
    uTime.value = gameTime;

    const t = gameTime;

    const effectiveTime = t + timeOffset;
    const cyclePos = effectiveTime % CYCLE_DURATION;
    const cycleWeatherBias = getWeatherForTimeOfDay(cyclePos, audioState);

    profiler.measure('Weather', () => {
        weatherSystem.update(t, audioState, cycleWeatherBias);
        weatherSystem.updateBerrySeasonalSize(cyclePos, CYCLE_DURATION);
    });

    profiler.measure('Interaction', () => {
        // Collect all interactive elements safely
        // ⚡ OPTIMIZATION: Pass arrays directly to avoid GC from spread syntax [...a, ...b]
        const activeFoliage = animatedFoliage || [];
        const activeMushrooms = foliageMushrooms || [];
        const activeClouds = foliageClouds || [];

        interactionSystem.update(delta, camera.position, activeFoliage, activeMushrooms, activeClouds);
    });

    const activeBPM = audioState?.bpm || 120;
    const bpmWindFactor = THREE.MathUtils.clamp((activeBPM - 60) / 120, 0, 1.5);
    const baseWind = 1.0 + weatherSystem.windSpeed * 4.0;
    const targetWindSpeed = baseWind * (1.0 + bpmWindFactor * 0.5);
    uWindSpeed.value = THREE.MathUtils.lerp(uWindSpeed.value, targetWindSpeed, 0.05);

    uWindDirection.value.copy(weatherSystem.windDirection);

    const currentBeatPhase = audioState?.beatPhase || 0;

    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            beatFlashIntensity = 0.5 + kickTrigger * 0.5;
            cameraZoomPulse = 2 + kickTrigger * 3;
        }
    }
    lastBeatPhase = currentBeatPhase;

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

    const currentState = getCycleState(effectiveTime, weatherSystem.targetPaletteMode || 'standard');

    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET;
    isNight = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    const weatherIntensity = weatherSystem.getIntensity();
    const weatherState = weatherSystem.getState();
    
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

    if (cyclePos < 540) {
        const sunProgress = cyclePos / 540;
        const angle = sunProgress * Math.PI;
        const r = 100;
        sunLight.position.set(Math.cos(angle) * -r, Math.sin(angle) * r, 20);
        sunLight.visible = true;
        sunGlow.visible = true;
        sunCorona.visible = true;
        moon.visible = false;

        _scratchSunVector.copy(sunLight.position).normalize();

        sunGlow.position.copy(_scratchSunVector).multiplyScalar(400);
        sunGlow.lookAt(camera.position);
        sunCorona.position.copy(_scratchSunVector).multiplyScalar(390);
        sunCorona.lookAt(camera.position);
        lightShaftGroup.position.copy(_scratchSunVector).multiplyScalar(380);
        lightShaftGroup.lookAt(camera.position);

        let glowIntensity = 0.25;
        let coronaIntensity = 0.15;
        let shaftIntensity = 0.0;
        let shaftVisible = false;
        
        if (sunProgress < 0.15) {
            const factor = 1.0 - (sunProgress / 0.15);
            glowIntensity = 0.25 + factor * 0.35;
            coronaIntensity = 0.15 + factor * 0.25;
            shaftIntensity = factor * 0.12;
            shaftVisible = false;
            sunGlowMat.color.setHex(0xFFB366);
            coronaMat.color.setHex(0xFFD6A3);
        } else if (sunProgress > 0.85) {
            const factor = (sunProgress - 0.85) / 0.15;
            glowIntensity = 0.25 + factor * 0.45;
            coronaIntensity = 0.15 + factor * 0.35;
            shaftIntensity = factor * 0.18;
            shaftVisible = false;
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
        // updateMoon is now handled by musicReactivitySystem for animation, but positioning is here.
        // We should consolidate, but for now musicReactivitySystem handles animation state.
        // Note: musicReactivitySystem.updateMoon is called in the reactivity block below.
    }

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

    const baseAuroraVis = starOp * 0.8;

    if (audioState) {
        const kick = audioState.kickTrigger || 0;
        uAudioLow.value = THREE.MathUtils.lerp(uAudioLow.value, kick, 0.2);

        let high = 0;
        let glitchTrigger = 0;

        if (audioState.channelData) {
             if (audioState.channelData.length > 5) {
                const ch5 = audioState.channelData[5].trigger || 0;
                const ch6 = audioState.channelData[6] ? (audioState.channelData[6].trigger || 0) : 0;
                high = Math.max(ch5, ch6);
             }

             for (const ch of audioState.channelData) {
                 if (ch.activeEffect === 5 && ch.effectValue > 0) {
                     glitchTrigger = Math.max(glitchTrigger, ch.effectValue);
                 }
             }
        }
        uAudioHigh.value = THREE.MathUtils.lerp(uAudioHigh.value, high, 0.2);

        if (glitchTrigger > 0) {
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
    uAuroraColor.value.copy(_scratchAuroraColor);

    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';
    updateFoliageMaterials(audioState, isNight, weatherStateStr, weatherIntensity);

    const deepNightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT;
    const deepNightEnd = deepNightStart + DURATION_DEEP_NIGHT;
    const isDeepNight = (cyclePos >= deepNightStart && cyclePos < deepNightEnd);

    profiler.measure('MusicReact', () => {
        musicReactivitySystem.update(t, delta, audioState, weatherSystem, animatedFoliage, camera, isNight, isDeepNight);
        if (melodyRibbon) updateMelodyRibbons(melodyRibbon, delta, audioState);
    });

    if (fireflies) {
        fireflies.visible = isDeepNight;
        if (isDeepNight) {
            updateFireflies(fireflies, t, delta);
        }
    }

    profiler.measure('Physics', () => {
        updatePhysics(delta, camera, controls, keyStates, audioState);
        if (sparkleTrail) updateSparkleTrail(sparkleTrail, player.position, player.velocity, gameTime);
    });

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

initWasm().then(async (wasmLoaded) => {
    console.log(`WASM module ${wasmLoaded ? 'active' : 'using JS fallbacks'}`);

    // Use getGroundHeight (which is now wrapped in physics/generation but here we access the raw one)
    // Actually, for camera start position, we should use the UNIFIED height if possible.
    // But since that logic is inside generation.ts/physics.js, we rely on the fact that
    // the start position (0,0,0) is likely safe or we'll snap to physics on frame 1.
    const initialGroundY = getGroundHeight(camera.position.x, camera.position.z);
    camera.position.y = initialGroundY + 1.8;
    console.log(`[Startup] Camera positioned at ground height: y=${camera.position.y.toFixed(2)}`);

    if (window.setLoadingStatus) window.setLoadingStatus("Preparing Scene...");

    // --- CRITICAL: Start Game Loop IMMEDIATELY (Before heavy compile) ---
    renderer.setAnimationLoop(animate);
    try { window.__sceneReady = true; } catch (e) {}

    // Hide loading screen early - the basic scene is ready
    if (window.setLoadingStatus) window.setLoadingStatus("Entering Candy World...");
    
    setTimeout(() => {
        if (window.hideLoadingScreen) window.hideLoadingScreen();
    }, 200);

    // Create a temporary "Preview" mushroom for the startup scene
    const previewMushroom = createMushroom({ size: 'giant', scale: 1.5, hasFace: true, isBouncy: true });
    previewMushroom.position.set(0, getGroundHeight(0, -10), -10);
    previewMushroom.rotation.y = Math.PI / 8;
    scene.add(previewMushroom);
    animatedFoliage.push(previewMushroom);

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = false;
        startButton.innerText = 'Enter World 🍭';
        
        startButton.addEventListener('click', () => {
            console.log('[Startup] Entering world...');
            
            // UX: Show loading state immediately to prevent "freeze" feeling
            startButton.disabled = true;
            startButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Generating... 🍭';

            // Defer execution slightly to let the UI update
            setTimeout(() => {
                scene.remove(previewMushroom);
                const idx = animatedFoliage.indexOf(previewMushroom);
                if (idx > -1) animatedFoliage.splice(idx, 1);

                generateMap(weatherSystem);

                // UX: Now that generation is done, hide the instructions
                // (We delayed this in input.js to keep the "Generating..." message visible)
                const instructions = document.getElementById('instructions');
                if (instructions) instructions.style.display = 'none';

                // Note: The pointer lock will happen automatically via input system
            }, 50);
            
        }, { once: true });
    }

    // --- DEFERRED NUCLEAR WARMUP ---
    // Delay this by 2 seconds to let the browser breathe after initial load
    setTimeout(async () => {
        console.log('[Deferred] Starting shader pre-compilation...');
        
        const dummyGroup = new THREE.Group();
        dummyGroup.position.set(0, -9999, 0);
        scene.add(dummyGroup);

        const dummyFlower = createFlower({ shape: 'layered' });
        const dummyMushroom = createMushroom({ size: 'regular' });
        dummyGroup.add(dummyFlower);
        dummyGroup.add(dummyMushroom);

        const dummyOrigin = new THREE.Vector3(0, -9999, 0);
        const dummyDir = new THREE.Vector3(0, 1, 0);
        fireRainbow(scene, dummyOrigin, dummyDir);

        try {
            // Async compile prevents blocking the main thread too hard
            await renderer.compileAsync(scene, camera);
            await forceFullSceneWarmup(renderer, scene, camera);
            console.log("✅ Scene shaders pre-compiled (Nuclear Warmup complete).");
        } catch (e) {
            console.warn("Shader compile error:", e);
        }

        scene.remove(dummyGroup);
        
        console.log('[Deferred] Shader compilation complete');
    }, 2000); // 2 second delay

    setTimeout(() => {
        console.log('[Deferred] Loading celestial bodies and aurora...');
        initDeferredVisuals();
    }, 300);

});

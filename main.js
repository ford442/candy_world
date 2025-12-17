import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, PointsNodeMaterial } from 'three/webgpu';
import { color, float, vec3, time, positionLocal, attribute, storage, uniform, uv } from 'three/tsl';
import {
    createFlower, createGrass, createFloweringTree, createShrub, animateFoliage,
    createGlowingFlower, createFloatingOrb, createVine, createStarflower,
    createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle,
    createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster,
    createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush,
    createPrismRoseBush, initGrassSystem, addGrassInstance, updateFoliageMaterials,
    createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createMushroom, createWaterfall, createFireflies, updateFireflies,
    initFallingBerries, updateFallingBerries, collectFallingBerries,
    createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    VineSwing, createSwingableVine, createMelodyLake
} from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor, uHorizonColor, uAtmosphereIntensity } from './sky.js';
import { createStars, uStarPulse, uStarColor, uStarOpacity } from './stars.js';
import { createMoon, updateMoon, moonConfig, triggerMoonBlink } from './moon.js';
import { MusicReactivity, getNoteColor } from './music-reactivity.js';
import { AudioSystem } from './audio-system.js';
import { BeatSync } from './src/audio/beat-sync.js';
import { WeatherSystem, WeatherState } from './weather.js';
import { initWasm, getGroundHeight, isWasmReady } from './wasm-loader.js';

// --- Configuration ---
// Cycle: Sunrise (1m), Day (7m), Sunset (1m), Night (7m) = Total 16m = 960s
const DURATION_SUNRISE = 60;
const DURATION_DAY = 420;
const DURATION_SUNSET = 60;
const DURATION_DUSK_NIGHT = 180; // 3 min
const DURATION_DEEP_NIGHT = 120; // 2 min
const DURATION_PRE_DAWN = 120;   // 2 min
const CYCLE_DURATION = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT + DURATION_DEEP_NIGHT + DURATION_PRE_DAWN; // 960s

const PALETTE = {
    day: {
        skyTop: new THREE.Color(0x87CEEB),   // Brighter sky blue for day
        skyBot: new THREE.Color(0xB8E6F0),   // Softer transition to horizon
        horizon: new THREE.Color(0xFFE5CC),  // Warm peachy horizon glow
        fog: new THREE.Color(0xFFC5D3),      // Warmer pastel pink fog
        sun: new THREE.Color(0xFFFAF0),      // Warm white sunlight
        amb: new THREE.Color(0xFFF5EE),      // Soft seashell ambient
        sunInt: 0.9,
        ambInt: 0.65,
        atmosphereIntensity: 0.3
    },
    sunset: {
        skyTop: new THREE.Color(0x4B3D8F),   // Rich purple-blue
        skyBot: new THREE.Color(0xFF6B4A),   // Warm coral-orange glow
        horizon: new THREE.Color(0xFFB347),  // Vibrant orange-gold horizon
        fog: new THREE.Color(0xE87B9F),      // Candy pink-coral fog
        sun: new THREE.Color(0xFFA040),      // Golden-orange sun
        amb: new THREE.Color(0x9B5050),      // Warm reddish ambient
        sunInt: 0.55,
        ambInt: 0.45,
        atmosphereIntensity: 0.7            // Strong atmospheric effect at sunset
    },
    night: {
        skyTop: new THREE.Color(0x0A0A2E),   // Deeper night blue with slight color
        skyBot: new THREE.Color(0x1A1A35),   // Slightly lighter horizon at night
        horizon: new THREE.Color(0x2A2A4A),  // Subtle purple-blue horizon glow
        fog: new THREE.Color(0x0A0A18),      // Dark blue-tinted fog
        sun: new THREE.Color(0x334466),      // Moonlight blue tint
        amb: new THREE.Color(0x080815),      // Very dim ambient
        sunInt: 0.12,
        ambInt: 0.08,
        atmosphereIntensity: 0.15           // Subtle night atmosphere
    },
    sunrise: {
        skyTop: new THREE.Color(0x48D8E8),   // Bright turquoise dawn sky
        skyBot: new THREE.Color(0xFF9BAC),   // Warm rosy pink
        horizon: new THREE.Color(0xFFD4A3),  // Golden peachy horizon
        fog: new THREE.Color(0xFFE4CA),      // Peachy-warm fog
        sun: new THREE.Color(0xFFE066),      // Golden morning light
        amb: new THREE.Color(0xFFC8D8),      // Soft pink ambient
        sunInt: 0.65,
        ambInt: 0.55,
        atmosphereIntensity: 0.6            // Strong morning atmosphere
    }
};

const CONFIG = {
    colors: { ground: 0x90EE90 }, // Slightly softer light green
    noteColorMap: {
        // Default mapping used by MusicReactivity, can be overridden here
        // species -> mapping
    }
};

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

const sky = createSky();
scene.add(sky);

const stars = createStars();
scene.add(stars);

const moon = createMoon();
// Position moon opposite to sun or in a fixed orbit
moon.position.set(-50, 60, -30); // High up
scene.add(moon);

const audioSystem = new AudioSystem();
const musicReactivity = new MusicReactivity(scene, CONFIG.noteColorMap);
const weatherSystem = new WeatherSystem(scene);
// BeatSync instance to centralize beat event detection
const beatSync = new BeatSync(audioSystem);
// Register a couple of global beat effects using BeatSync
beatSync.onBeat((state) => {
    const kickTrigger = state?.kickTrigger || 0;
    if (kickTrigger > 0.2) {
        // Visual pulse
        beatFlashIntensity = Math.max(beatFlashIntensity, 0.4 + kickTrigger * 0.5);
        cameraZoomPulse = Math.max(cameraZoomPulse, 1 + kickTrigger * 3);
    }
    // Pulse stars a bit by updating uniform if available
    if (typeof uStarPulse !== 'undefined') {
        uStarPulse.value += 0.5 * (kickTrigger + 0.1);
    }
});
let isNight = false;
let timeOffset = 0; // Manual time shift for Day/Night toggle

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 5, 0);

if (!WebGPU.isAvailable()) {
    const warning = WebGPU.getErrorMessage();
    document.body.appendChild(warning);
    throw new Error('WebGPU not supported');
}

const renderer = new WebGPURenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for better performance
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Lighting ---
// Enhanced hemisphere light for candy-world ambient
const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.1);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.9);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024; // Reduced from 2048 for better performance
sunLight.shadow.mapSize.height = 1024;
scene.add(sunLight);

// Enhanced Sun Glow with dynamic corona effect
const sunGlowMat = new THREE.MeshBasicMaterial({
    color: 0xFFE599,  // Warmer golden glow
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
});
const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), sunGlowMat);
sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
sunGlow.lookAt(0, 0, 0);
scene.add(sunGlow);

// Add additional corona layer for more dramatic effect
const coronaMat = new THREE.MeshBasicMaterial({
    color: 0xFFF4D6,  // Soft cream white
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
});
const sunCorona = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), coronaMat);
sunCorona.position.copy(sunLight.position.clone().normalize().multiplyScalar(390));
sunCorona.lookAt(0, 0, 0);
scene.add(sunCorona);

// --- Procedural Generation ---
// getGroundHeight is now provided by WASM module (with JS fallback)
// Import from wasm-loader.js above

const groundGeo = new THREE.PlaneGeometry(2000, 2000, 128, 128); // Reduced from 256 for better performance
const posAttribute = groundGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i);
    const zWorld = -y;
    const height = getGroundHeight(x, zWorld);
    posAttribute.setZ(i, height);
}
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshPhysicalMaterial({
    color: CONFIG.colors.ground,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.6,
    flatShading: false,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const worldGroup = new THREE.Group();
scene.add(worldGroup);
const obstacles = [];
const animatedFoliage = [];
// Optimization: Separate arrays for faster collision checks
const foliageMushrooms = [];
const foliageTrampolines = [];
const foliageClouds = [];
const vineSwings = []; // Managers for swing physics
let activeVineSwing = null; // Current vine player is attached to
let lastVineDetachTime = 0; // Debounce re-attach

const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);

// Initialize Grass
initGrassSystem(scene, 8000); // Increased population

// Initialize Fireflies (for Deep Night)
const fireflies = createFireflies(150, 100);
scene.add(fireflies);

// Initialize Melody Lake
const melodyLake = createMelodyLake(100, 100);
melodyLake.position.set(0, 2.5, 0); // Slightly above ground
scene.add(melodyLake);

// Initialize Falling Berry Pool (for storms)
initFallingBerries(scene);

function safeAddFoliage(obj, isObstacle = false, radius = 1.0) {
    if (animatedFoliage.length > 2500) return; // Increased limit for Vertical Ecosystem
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });

    // Optimization: Categorize for faster collision checks
    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);

    // Register with weather system for berry charging
    if (obj.userData.type === 'tree') {
        weatherSystem.registerTree(obj);
    } else if (obj.userData.type === 'shrub') {
        weatherSystem.registerShrub(obj);
    }
    else if (obj.userData.type === 'mushroom') {
        weatherSystem.registerMushroom(obj);
    }
}

// Give WeatherSystem a hook to add foliage into the world (so spawned mushrooms get registered properly)
weatherSystem.onSpawnFoliage = (obj, isObstacle = false, radius = 1.0) => {
    safeAddFoliage(obj, isObstacle, radius);
};

// --- NEW SCENE CLUSTERING SPAWNER ---

function spawnCluster(cx, cz, type) {
    // Each cluster is roughly 30x30 units

    // 1. Mushroom Forest (Fixes "0 mushrooms" issue)
    if (type === 'mushroom_forest') {
        const count = 25 + Math.random() * 10; // Increased count
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 30;
            const z = cz + (Math.random() - 0.5) * 30;
            const y = getGroundHeight(x, z);

            // Mix of sizes
            const isGiant = Math.random() < 0.15; // Increased Giant chance
            const size = isGiant ? 'giant' : 'regular';
            const m = createMushroom({ size: size, scale: 0.8 + Math.random() * 0.5 });

            m.position.set(x, y, z);
            m.rotation.y = Math.random() * Math.PI * 2;
            m.rotation.z = (Math.random() - 0.5) * 0.2; // Slight tilt

            safeAddFoliage(m, true, isGiant ? 2.0 : 0.5);

            // Shadow Zone Logic: Spawn glowing flowers under giant mushrooms
            if (isGiant) {
                const underCount = 3 + Math.floor(Math.random() * 3);
                for (let k = 0; k < underCount; k++) {
                    const gx = x + (Math.random() - 0.5) * 4; // Tight radius under cap
                    const gz = z + (Math.random() - 0.5) * 4;
                    const gy = getGroundHeight(gx, gz);
                    const gf = createGlowingFlower({ intensity: 2.0, color: 0x00FFFF }); // Cyan/Neon glow
                    gf.position.set(gx, gy, gz);
                    // Force night-mode logic for these?
                    // For now just high intensity.
                    safeAddFoliage(gf);
                }
            }
        }
    }

    // 2. Glowing Flower Field
    else if (type === 'flower_field') {
        const count = 30 + Math.random() * 10; // Reduced for performance
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 35;
            const z = cz + (Math.random() - 0.5) * 35;
            const y = getGroundHeight(x, z);

            // Mix grass in (reduced frequency)
            if (Math.random() > 0.5) {
                addGrassInstance(x, y, z);
            }

            // Flowers
            if (Math.random() > 0.3) {
                const isGlowing = Math.random() < 0.3;
                const f = isGlowing ? createGlowingFlower() : createFlower({ shape: 'layered' });
                f.position.set(x, y, z);
                safeAddFoliage(f);
            }
        }
    }

    // 3. Weird Jungle (Subwoofers, Palms, Willows)
    else if (type === 'weird_jungle') {
        const count = 12; // Increased from 8
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 25;
            const z = cz + (Math.random() - 0.5) * 25;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            let plant;
            if (r < 0.3) plant = createSubwooferLotus({ color: 0x2E8B57 });
            else if (r < 0.6) plant = createAccordionPalm({ color: 0xFF6347 }); // Regular Tree equivalent
            else plant = createFiberOpticWillow(); // Flowering Tree equivalent

            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 1.0);

            // Spawn attached fruit clusters for density
            if (Math.random() < 0.3) {
                 const fruit = createFloatingOrb({ size: 0.2, color: 0xFF00FF });
                 fruit.position.set(x + (Math.random()-0.5)*1.5, y + 2 + Math.random(), z + (Math.random()-0.5)*1.5);
                 safeAddFoliage(fruit);
            }
        }

        // Add Swingable Vines hanging from "canopy" (invisible or implied)
        const vineCount = 3;
        for (let i = 0; i < vineCount; i++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            // High anchor point
            const y = getGroundHeight(x, z) + 15 + Math.random() * 5;

            const vine = createSwingableVine({ length: 12 + Math.random() * 4 });
            vine.position.set(x, y, z);
            safeAddFoliage(vine);

            // Create Physics Manager
            const swingManager = new VineSwing(vine, vine.userData.vineLength);
            vineSwings.push(swingManager);
        }
    }

    // 4. Crystal Grove (Prisms, Starflowers)
    else if (type === 'crystal_grove') {
        const count = 20; // Increased from 15
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            const plant = r < 0.5 ? createPrismRoseBush() : createStarflower();
            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 0.8);
        }
    }

    // 5. Musical Meadow (Vibrato Violets, Tremolo Tulips, Kick-Drum Geysers)
    // From plan.md - Musical ecosystem features
    else if (type === 'musical_meadow') {
        // Vibrato Violets (bioluminescent flowers with vibrating petals)
        const violetCount = 8 + Math.floor(Math.random() * 6);
        for (let i = 0; i < violetCount; i++) {
            const x = cx + (Math.random() - 0.5) * 25;
            const z = cz + (Math.random() - 0.5) * 25;
            const y = getGroundHeight(x, z);

            const violet = createVibratoViolet({
                color: [0x8A2BE2, 0x9400D3, 0xBA55D3, 0x9932CC][Math.floor(Math.random() * 4)],
                intensity: 0.8 + Math.random() * 0.4
            });
            violet.position.set(x, y, z);
            violet.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(violet, false, 0.3);
        }

        // Tremolo Tulips (pulsing bell flowers)
        const tulipCount = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < tulipCount; i++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);

            const tulip = createTremoloTulip({
                color: [0xFF6347, 0xFF4500, 0xFFD700, 0xFF69B4][Math.floor(Math.random() * 4)],
                size: 0.8 + Math.random() * 0.4
            });
            tulip.position.set(x, y, z);
            tulip.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(tulip, false, 0.4);
        }

        // Kick-Drum Geysers (rhythmic structures that erupt on kick)
        const geyserCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < geyserCount; i++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);

            const geyser = createKickDrumGeyser({
                color: [0xFF4500, 0xFF6600, 0xFF8C00][Math.floor(Math.random() * 3)],
                maxHeight: 4 + Math.random() * 3
            });
            geyser.position.set(x, y, z);
            safeAddFoliage(geyser, true, 0.5);
        }

        // Add some grass for context
        for (let i = 0; i < 15; i++) {
            const x = cx + (Math.random() - 0.5) * 30;
            const z = cz + (Math.random() - 0.5) * 30;
            const y = getGroundHeight(x, z);
            addGrassInstance(x, y, z);
        }
    }
}

// Generate the Map
const SCENE_GRID_SIZE = 40; // Spacing between centers
const SCENE_ROWS = 4; // Reduced from 6 for better performance
const SCENE_COLS = 4; // Reduced from 6 for better performance
const SCENE_TYPES = ['mushroom_forest', 'flower_field', 'weird_jungle', 'crystal_grove', 'musical_meadow'];

for (let r = -SCENE_ROWS / 2; r < SCENE_ROWS / 2; r++) {
    for (let c = -SCENE_COLS / 2; c < SCENE_COLS / 2; c++) {
        const cx = r * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;
        const cz = c * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;

        // Pick a type based on noise or random
        const typeIndex = Math.floor(Math.random() * SCENE_TYPES.length);
        spawnCluster(cx, cz, SCENE_TYPES[typeIndex]);

        // Fill gaps with grass
        for (let k = 0; k < 10; k++) { // Reduced from 20 for better performance
            const gx = cx + (Math.random() - 0.5) * 40;
            const gz = cz + (Math.random() - 0.5) * 40;
            const gy = getGroundHeight(gx, gz);
            addGrassInstance(gx, gy, gz);
        }
    }
}

// Rain Clouds (Vertical Hierarchy: Tier 1 and Tier 2)
const cloudCount = 25; // Increased from 10
for (let i = 0; i < cloudCount; i++) {
    // 30% chance for Tier 1 (Solid, Walkable)
    const isTier1 = Math.random() < 0.3;
    const height = isTier1 ? 40 + Math.random() * 15 : 25 + Math.random() * 10; // Tier 1 higher

    // Create cloud
    const cloud = createRainingCloud({
        rainIntensity: isTier1 ? 50 : 20, // Heavier rain from top tier
        size: isTier1 ? 2.0 : 1.2
    });

    cloud.position.set((Math.random() - 0.5) * 200, height, (Math.random() - 0.5) * 200);

    // Tag for walking if Tier 1
    if (isTier1) {
        cloud.userData.isWalkable = true;
        cloud.userData.tier = 1;
        // Make it denser visual
        cloud.scale.multiplyScalar(1.5);
    } else {
        cloud.userData.tier = 2;
    }

    scene.add(cloud);
    animatedFoliage.push(cloud);
    foliageClouds.push(cloud); // Add to optimized array
}

// --- Inputs ---
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
const startButton = document.getElementById('startButton');

// Lock pointer when Start button is clicked
startButton.addEventListener('click', () => {
    controls.lock();
});

// Also keep the instructions container click for convenience,
// but ensure we don't trigger it when clicking settings buttons
instructions.addEventListener('click', (event) => {
    // If the click target is the container itself (not a child button that bubbled up)
    if (event.target === instructions) {
        controls.lock();
    }
});

// Prevent clicks on settings container from starting the game
const settingsContainer = document.querySelector('.settings-container');
if (settingsContainer) {
    settingsContainer.addEventListener('click', (event) => {
        event.stopPropagation();
    });
}

controls.addEventListener('lock', () => instructions.style.display = 'none');
controls.addEventListener('unlock', () => instructions.style.display = 'flex');

// Control State
const keyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false
};

// Helper function to toggle day/night
function toggleDayNight() {
    timeOffset += CYCLE_DURATION / 2;
    // Update ARIA state for accessibility
    const btn = document.getElementById('toggleDayNight');
    if (btn) {
        // Toggle the state (if night is coming, it's "pressed" in context of "Night Mode"?)
        // Or simply toggle the state boolean.
        const isPressed = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', !isPressed);
    }
}

// Key Handlers
const onKeyDown = function (event) {
    if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
        event.preventDefault();
    }
    switch (event.code) {
        case 'KeyW': keyStates.jump = true; break;
        case 'KeyA': keyStates.left = true; break;
        case 'KeyS': keyStates.backward = true; break;
        case 'KeyD': keyStates.right = true; break;
        case 'Space': keyStates.jump = true; break;
        case 'KeyN': toggleDayNight(); break;
        case 'ControlLeft':
        case 'ControlRight':
            keyStates.sneak = true;
            event.preventDefault();
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            keyStates.sprint = true;
            break;
    }
};

const onKeyUp = function (event) {
    switch (event.code) {
        case 'KeyW': keyStates.jump = false; break;
        case 'KeyA': keyStates.left = false; break;
        case 'KeyS': keyStates.backward = false; break;
        case 'KeyD': keyStates.right = false; break;
        case 'Space': keyStates.jump = false; break;
        case 'ControlLeft':
        case 'ControlRight': keyStates.sneak = false; break;
        case 'ShiftLeft':
        case 'ShiftRight': keyStates.sprint = false; break;
    }
};

const onMouseDown = function (event) {
    if (event.button === 2) { // Right Click
        keyStates.forward = true;
    }
};

const onMouseUp = function (event) {
    if (event.button === 2) {
        keyStates.forward = false;
    }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
document.addEventListener('mousedown', onMouseDown);
document.addEventListener('mouseup', onMouseUp);

// Player State
const _targetVelocity = new THREE.Vector3(); // Reusable vector for movement calculations
const player = {
    velocity: new THREE.Vector3(),
    speed: 15.0,
    sprintSpeed: 25.0,
    sneakSpeed: 5.0,
    gravity: 20.0,
    energy: 0.0,        // Berry energy (0 to 10)
    maxEnergy: 10.0
};

// --- Musical Ecosystem: Global Effects (from plan.md Category 3) ---
// BPM Wind: Global wind vector scaled to BPM affecting particles, foliage, projectiles
const bpmWind = {
    direction: new THREE.Vector3(1, 0, 0), // Default wind direction
    strength: 0,                            // Current wind strength (0-1)
    targetStrength: 0,
    bpm: 120                                // Current BPM
};

// Groove Gravity: Global gravity modulation based on swing/groove factor
const grooveGravity = {
    multiplier: 1.0,       // Current gravity multiplier (0.5 = floaty, 1.5 = heavy)
    targetMultiplier: 1.0,
    baseGravity: 20.0      // Base gravity value
};

// --- Physics Helpers ---
function checkMushroomBounce(pos) {
    // Check collision with mushroom caps
    // Optimized: Use filtered array
    for (let i = 0; i < foliageMushrooms.length; i++) {
        const obj = foliageMushrooms[i];

        // Cylinder/Capsule check approx
        const dx = pos.x - obj.position.x;
        const dz = pos.z - obj.position.z;

        // Check if we are "on" the cap (horizontal dist)
        // Cap radius is dynamic, but usually around 1.0-3.0
        if (dx * dx + dz * dz < 2.0) {
            // Check if we are hitting it from above
            const distSq = pos.distanceToSquared(obj.position);
            if (distSq < 5.0) { // Close enough
                // Are we falling onto it?
                if (player.velocity.y < 0 && pos.y > obj.position.y + 0.5) {
                    const audioIntensity = audioState?.kickTrigger || 0.5;
                    return 15 + audioIntensity * 10; // BASE_JUMP + BONUS
                }
            }
        }
    }
    return 0;
}

function checkFlowerTrampoline(pos) {
    // Check collision with trampoline flowers (puffballs etc)
    // Optimized: Use filtered array
    for (let i = 0; i < foliageTrampolines.length; i++) {
        const obj = foliageTrampolines[i];

        const dx = pos.x - obj.position.x;
        const dz = pos.z - obj.position.z;
        const bounceTop = obj.position.y + obj.userData.bounceHeight;
        const dy = pos.y - bounceTop;

        const distH = Math.sqrt(dx * dx + dz * dz);
        const radius = obj.userData.bounceRadius || 0.5;

        // Check if above the flower and within radius
        if (distH < radius && dy > -0.5 && dy < 1.5) {
            // Are we falling onto it?
            if (player.velocity.y < 0) {
                const audioBoost = audioState?.kickTrigger || 0.3;
                const force = obj.userData.bounceForce || 12;

                // Visual feedback - squash the flower slightly
                obj.scale.y = 0.7;
                setTimeout(() => { obj.scale.y = 1.0; }, 100);

                return force + audioBoost * 5;
            }
        }
    }
    return 0;
}

// --- Cycle Interpolation (Corrected for Segments) ---
function getCycleState(tRaw) {
    const t = tRaw % CYCLE_DURATION;

    // 1. Sunrise (0-60)
    if (t < DURATION_SUNRISE) {
        return lerpPalette(PALETTE.night, PALETTE.sunrise, t / DURATION_SUNRISE);
    }

    let elapsed = DURATION_SUNRISE;

    // 2. Day (60-480)
    if (t < elapsed + DURATION_DAY) {
        const localT = t - elapsed;
        if (localT < 60) return lerpPalette(PALETTE.sunrise, PALETTE.day, localT / 60);
        return PALETTE.day;
    }
    elapsed += DURATION_DAY;

    // 3. Sunset (480-540)
    if (t < elapsed + DURATION_SUNSET) {
        const localT = t - elapsed;
        return lerpPalette(PALETTE.day, PALETTE.sunset, localT / DURATION_SUNSET);
    }
    elapsed += DURATION_SUNSET;

    // 4. Dusk Night (540-720)
    if (t < elapsed + DURATION_DUSK_NIGHT) {
        const localT = t - elapsed;
        // Fade to Night
        if (localT < 60) return lerpPalette(PALETTE.sunset, PALETTE.night, localT / 60);
        return PALETTE.night;
    }
    elapsed += DURATION_DUSK_NIGHT;

    // 5. Deep Night (720-840)
    if (t < elapsed + DURATION_DEEP_NIGHT) {
        // Darker night? Or just same night palette. 
        // Use night palette but maybe reduce ambient even more?
        // For now, stick to standard night palette but we will use the timing for "Sleep" logic
        return PALETTE.night;
    }
    elapsed += DURATION_DEEP_NIGHT;

    // 6. Pre-Dawn (840-960)
    if (t < elapsed + DURATION_PRE_DAWN) {
        return PALETTE.night;
    }

    return PALETTE.night; // Fallback
}

// --- Reusable Color Pool for Render Loop (prevents GC pressure) ---
const _scratchPalette = {
    skyTop: new THREE.Color(),
    skyBot: new THREE.Color(),
    horizon: new THREE.Color(),
    fog: new THREE.Color(),
    sun: new THREE.Color(),
    amb: new THREE.Color(),
    sunInt: 0,
    ambInt: 0,
    atmosphereIntensity: 0
};

function lerpPalette(p1, p2, t) {
    _scratchPalette.skyTop.copy(p1.skyTop).lerp(p2.skyTop, t);
    _scratchPalette.skyBot.copy(p1.skyBot).lerp(p2.skyBot, t);
    _scratchPalette.horizon.copy(p1.horizon).lerp(p2.horizon, t);
    _scratchPalette.fog.copy(p1.fog).lerp(p2.fog, t);
    _scratchPalette.sun.copy(p1.sun).lerp(p2.sun, t);
    _scratchPalette.amb.copy(p1.amb).lerp(p2.amb, t);
    _scratchPalette.sunInt = THREE.MathUtils.lerp(p1.sunInt, p2.sunInt, t);
    _scratchPalette.ambInt = THREE.MathUtils.lerp(p1.ambInt, p2.ambInt, t);
    _scratchPalette.atmosphereIntensity = THREE.MathUtils.lerp(p1.atmosphereIntensity, p2.atmosphereIntensity, t);
    return _scratchPalette;
}

// --- Weather-Cycle Integration ---
/**
 * Determine natural weather patterns based on time of day
 * @param {number} cyclePos - Position in day/night cycle (0 to CYCLE_DURATION)
 * @param {object} audioData - Current audio state (for audio-reactive override)
 * @returns {object} Weather suggestion { biasState, biasIntensity, type }
 */
function getWeatherForTimeOfDay(cyclePos, audioData) {
    const SUNRISE = DURATION_SUNRISE;
    const DAY = DURATION_DAY;
    const SUNSET = DURATION_SUNSET;
    const DUSK = DURATION_DUSK_NIGHT;
    
    // Morning mist during sunrise
    if (cyclePos < SUNRISE + 60) {
        const progress = (cyclePos / (SUNRISE + 60));
        return { 
            biasState: 'rain', 
            biasIntensity: 0.3 * (1 - progress), // Fade out as sun rises
            type: 'mist' 
        };
    }
    
    // Afternoon storm potential (mid-day, 20% weighted chance)
    else if (cyclePos > SUNRISE + 120 && cyclePos < SUNRISE + DAY - 60) {
        // Accumulate storm probability over time
        const midDayProgress = (cyclePos - SUNRISE - 120) / (DAY - 180);
        const stormChance = 0.0003; // Per-frame chance
        
        if (Math.random() < stormChance) {
            return { 
                biasState: 'storm', 
                biasIntensity: 0.7 + Math.random() * 0.3,
                type: 'thunderstorm' 
            };
        }
    }
    
    // Evening drizzle during sunset and dusk
    else if (cyclePos > SUNRISE + DAY && cyclePos < SUNRISE + DAY + SUNSET + DUSK / 2) {
        const progress = (cyclePos - SUNRISE - DAY) / (SUNSET + DUSK / 2);
        return { 
            biasState: 'rain', 
            biasIntensity: 0.3 + progress * 0.2, // Gradually intensify
            type: 'drizzle' 
        };
    }
    
    // Clear night (stars visible)
    return { 
        biasState: 'clear', 
        biasIntensity: 0,
        type: 'clear' 
    };
}

// --- Animation ---
const clock = new THREE.Clock();
let audioState = null;
let lastBeatPhase = 0;
let beatFlashIntensity = 0;
let cameraZoomPulse = 0;
const baseFOV = 75;

function animate() {
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1); // Cap delta to prevent large jumps
    const t = clock.getElapsedTime();

    audioState = audioSystem.update();
    // Update central BeatSync (calls registered callbacks when beat wraps)
    beatSync.update();
    
    // Cycle Update
    const effectiveTime = t + timeOffset;
    const cyclePos = effectiveTime % CYCLE_DURATION;
    
    // Get time-of-day weather bias
    const cycleWeatherBias = getWeatherForTimeOfDay(cyclePos, audioState);
    
    // Update weather with cycle integration
    weatherSystem.update(t, audioState, cycleWeatherBias);

    // Get current beat phase early (needed for BPM Wind and beat detection)
    const currentBeatPhase = audioState?.beatPhase || 0;

    // --- Musical Ecosystem: BPM Wind (from plan.md Category 3) ---
    // Wind strength scales with BPM, direction pulses with beat
    if (audioState) {
        // Use actual BPM from audio system (normalized to 60-180 BPM range)
        const currentBPM = audioState.bpm || 120;
        bpmWind.bpm = currentBPM;
        bpmWind.targetStrength = Math.min(1.0, (currentBPM - 60) / 120);
        
        // Wind gusts pulse with beat phase
        const gustPulse = Math.sin(currentBeatPhase * Math.PI * 2) * 0.3;
        bpmWind.targetStrength += gustPulse;
        
        // Smooth wind strength changes
        bpmWind.strength += (bpmWind.targetStrength - bpmWind.strength) * delta * 2;
        bpmWind.strength = Math.max(0, Math.min(1, bpmWind.strength));
        
        // Rotate wind direction slowly
        bpmWind.direction.x = Math.sin(t * 0.1);
        bpmWind.direction.z = Math.cos(t * 0.1);
        bpmWind.direction.normalize();
    }

    // --- Musical Ecosystem: Groove Gravity (from plan.md Category 3) ---
    // Gravity modulation based on groove factor - swing makes things floatier
    if (audioState) {
        const groove = audioState.grooveAmount || 0;
        // Swing/groove reduces gravity (makes things floatier)
        // 0 groove = 1.0 multiplier, max groove = 0.6 multiplier
        grooveGravity.targetMultiplier = 1.0 - groove * 0.4;
        
        // Smooth gravity changes (ease over ~1s as per plan.md)
        grooveGravity.multiplier += (grooveGravity.targetMultiplier - grooveGravity.multiplier) * delta;
        
        // Apply to player gravity
        player.gravity = grooveGravity.baseGravity * grooveGravity.multiplier;
    }

    // Beat Detection - detect when beatPhase wraps around (new beat)
    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        // Beat just happened!
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            beatFlashIntensity = 0.5 + kickTrigger * 0.5;
            cameraZoomPulse = 2 + kickTrigger * 3; // FOV reduction
        }
    }
    lastBeatPhase = currentBeatPhase;

    // Apply beat effects
    if (beatFlashIntensity > 0) {
        beatFlashIntensity *= 0.9; // Decay
        if (beatFlashIntensity < 0.01) beatFlashIntensity = 0;
    }
    if (cameraZoomPulse > 0) {
        camera.fov = baseFOV - cameraZoomPulse;
        camera.updateProjectionMatrix();
        cameraZoomPulse *= 0.85; // Decay back to normal
        if (cameraZoomPulse < 0.1) {
            cameraZoomPulse = 0;
            camera.fov = baseFOV;
            camera.updateProjectionMatrix();
        }
    }


    // Get current cycle colors
    const currentState = getCycleState(effectiveTime);

    // Update berry seasonal sizes based on cycle phase
    weatherSystem.updateBerrySeasonalSize(cyclePos, CYCLE_DURATION);

    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET; // 540
    const sunriseStart = 0; // 0
    // Strictly, night is the dark period.
    isNight = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    // Apply weather-based sky modifications
    const weatherIntensity = weatherSystem.getIntensity();
    const weatherState = weatherSystem.getState();
    
    // Base sky colors from cycle
    const baseSkyTop = currentState.skyTop.clone();
    const baseSkyBot = currentState.skyBot.clone();
    const baseFog = currentState.fog.clone();
    
    // Modify colors based on weather
    if (weatherState === WeatherState.STORM) {
        // Darken and desaturate sky during storms
        const stormColor = new THREE.Color(0x1A1A2E);
        baseSkyTop.lerp(stormColor, weatherIntensity * 0.6);
        baseSkyBot.lerp(new THREE.Color(0x2E3A59), weatherIntensity * 0.5);
        baseFog.lerp(new THREE.Color(0x4A5568), weatherIntensity * 0.4);
    } else if (weatherState === WeatherState.RAIN) {
        // Slight gray tint during rain
        const rainColor = new THREE.Color(0xA0B5C8);
        baseSkyTop.lerp(rainColor, weatherIntensity * 0.3);
        baseSkyBot.lerp(rainColor, weatherIntensity * 0.25);
        baseFog.lerp(new THREE.Color(0xC0D0E0), weatherIntensity * 0.2);
    }
    
    uSkyTopColor.value.copy(baseSkyTop);
    uSkyBottomColor.value.copy(baseSkyBot);
    uHorizonColor.value.copy(currentState.horizon);
    uAtmosphereIntensity.value = currentState.atmosphereIntensity;
    scene.fog.color.copy(baseFog);

    // Fog Density
    const targetNear = isNight ? 5 : 20;
    const targetFar = isNight ? 40 : 100;
    scene.fog.near += (targetNear - scene.fog.near) * delta * 0.5;
    scene.fog.far += (targetFar - scene.fog.far) * delta * 0.5;

    // Apply weather dimming to lighting
    let sunIntensity = currentState.sunInt;
    let ambIntensity = currentState.ambInt;
    
    if (weatherState === WeatherState.STORM) {
        // Significantly dim during storms
        sunIntensity *= (1 - weatherIntensity * 0.7);
        ambIntensity *= (1 - weatherIntensity * 0.5);
    } else if (weatherState === WeatherState.RAIN) {
        // Slightly dim during rain
        sunIntensity *= (1 - weatherIntensity * 0.3);
        ambIntensity *= (1 - weatherIntensity * 0.2);
    }
    
    sunLight.color.copy(currentState.sun);
    sunLight.intensity = sunIntensity;
    ambientLight.color.copy(currentState.amb);
    ambientLight.intensity = ambIntensity + beatFlashIntensity * 0.5; // Beat flash boost

    // Sun Position Animation (Arc over sky)
    // Map cycle to angle. 
    // Sunrise=0deg, Day=overhead, Sunset=180deg
    // We want the sun to be visible during Sunrise -> Sunset (0 to 540s)
    // 0s = Horizon East (-50, 0, 0)
    // 270s = Noon (0, 100, 0)
    // 540s = Horizon West (50, 0, 0)

    if (cyclePos < 540) {
        const sunProgress = cyclePos / 540;
        const angle = sunProgress * Math.PI; // 0 to PI
        const r = 100;
        sunLight.position.set(
            Math.cos(angle) * -r, // East to West
            Math.sin(angle) * r,
            20 // Slight tilt
        );
        sunLight.visible = true;
        sunGlow.visible = true;
        sunCorona.visible = true;
        moon.visible = false;

        // Update Glow Position
        sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
        sunGlow.lookAt(camera.position); // Billboard
        
        // Update Corona Position
        sunCorona.position.copy(sunLight.position.clone().normalize().multiplyScalar(390));
        sunCorona.lookAt(camera.position); // Billboard
        
        // Enhanced glow during sunrise/sunset (first and last hour)
        let glowIntensity = 0.25;
        let coronaIntensity = 0.15;
        
        if (sunProgress < 0.15) {
            // Sunrise enhancement
            const factor = 1.0 - (sunProgress / 0.15);
            glowIntensity = 0.25 + factor * 0.35; // Up to 0.6
            coronaIntensity = 0.15 + factor * 0.25; // Up to 0.4
            sunGlowMat.color.setHex(0xFFB366); // Orange tint
            coronaMat.color.setHex(0xFFD6A3); // Peachy tint
        } else if (sunProgress > 0.85) {
            // Sunset enhancement
            const factor = (sunProgress - 0.85) / 0.15;
            glowIntensity = 0.25 + factor * 0.45; // Up to 0.7
            coronaIntensity = 0.15 + factor * 0.35; // Up to 0.5
            sunGlowMat.color.setHex(0xFF9966); // Deep orange
            coronaMat.color.setHex(0xFFCC99); // Warm peach
        } else {
            // Day - normal glow
            sunGlowMat.color.setHex(0xFFE599);
            coronaMat.color.setHex(0xFFF4D6);
        }
        
        sunGlowMat.opacity = glowIntensity;
        coronaMat.opacity = coronaIntensity;
    } else {
        sunLight.visible = false;
        sunGlow.visible = false;
        sunCorona.visible = false;
        moon.visible = true;

        // Moon Orbit: Opposite to Sun? Or just high up.
        // Let's make it rise as sun sets
        const nightProgress = (cyclePos - 540) / (CYCLE_DURATION - 540); // 0 to 1 over night
        const moonAngle = nightProgress * Math.PI;
        const r = 90;
        moon.position.set(
            Math.cos(moonAngle) * -r, // East to West logic reversed?
            Math.sin(moonAngle) * r,
            -30
        );
        moon.lookAt(0,0,0);

        updateMoon(moon, delta, audioState);
    }

    // --- Enhanced Star Visibility Logic ---
    // Stars should fade in during dusk, be fully visible at night, and fade out at dawn
    const progress = cyclePos / CYCLE_DURATION;
    let starOp = 0;
    
    // Night phase: 540s (9min) to 960s (16min) in cycle
    // Full visibility during deep night: ~11-15 min (660s-900s)
    const starDuskStart = 0.50;   // 8 min mark - start fading in
    const starNightStart = 0.60;  // 9.6 min - fully visible
    const starNightEnd = 0.90;    // 14.4 min - start fading out
    const starDawnEnd = 0.98;     // 15.7 min - fully faded out
    
    if (progress >= starNightStart && progress <= starNightEnd) {
        starOp = 1.0; // Full visibility during night
    } else if (progress > starDuskStart && progress < starNightStart) {
        // Fade in during dusk
        starOp = (progress - starDuskStart) / (starNightStart - starDuskStart);
    } else if (progress > starNightEnd && progress < starDawnEnd) {
        // Fade out during dawn
        starOp = 1.0 - ((progress - starNightEnd) / (starDawnEnd - starNightEnd));
    }
    
    // Smooth transition with slight boost for better visibility
    uStarOpacity.value = THREE.MathUtils.lerp(uStarOpacity.value, starOp * 0.95, delta * 2);

    // Map weather state enum to string for materials
    let weatherStateStr = 'clear';
    if (weatherState === WeatherState.STORM) weatherStateStr = 'storm';
    else if (weatherState === WeatherState.RAIN) weatherStateStr = 'rain';
    
    updateFoliageMaterials(audioState, isNight, weatherStateStr, weatherIntensity);

    // Distance-based animation culling for better performance
    const camPos = camera.position;
    const maxAnimationDistance = 50; // Only animate objects within 50 units
    const maxDistanceSq = maxAnimationDistance * maxAnimationDistance;


    // Determine Deep Night status
    const deepNightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_DUSK_NIGHT;
    const deepNightEnd = deepNightStart + DURATION_DEEP_NIGHT;
    const isDeepNight = (cyclePos >= deepNightStart && cyclePos < deepNightEnd);

    // --- Music Reactivity & Animation Optimization ---
    // Bolt: Consolidated loops to iterate animatedFoliage only ONCE per frame.
    // First, collect all triggers for this frame.
    const frameTriggers = new Map(); // species -> { note, volume }

    if (audioState && audioState.channelData) {
        audioState.channelData.forEach(ch => {
            if (ch.trigger > 0.5) { // Triggered this frame
                // Determine species mapping (Simple heuristics for now)
                // Bass (low freq or ch 0-1) -> Mushrooms
                // Lead (mid/high or ch 2-3) -> Flowers
                let species = 'flower';
                if (ch.instrument === 1 || ch.freq < 200) species = 'mushroom';
                if (ch.instrument === 2) species = 'tree';

                // Store trigger for single-pass application
                // Last trigger for a species in the frame wins (or could accumulate)
                frameTriggers.set(species, { note: ch.note || 60, volume: ch.volume });

                // Blink moon on high notes or specific channel (Global effect)
                if (species === 'tree' && isNight) triggerMoonBlink(moon);
            }
        });
    }

    // Single pass for Animation and Reactivity
    // Reduces complexity from O(Channels * Objects) to O(Objects)
    for (let i = 0, l = animatedFoliage.length; i < l; i++) {
        const f = animatedFoliage[i];

        // Skip processing for objects far from camera
        const distSq = f.position.distanceToSquared(camPos);
        if (distSq > maxDistanceSq) continue;

        // 1. Animation
        animateFoliage(f, t, audioState, !isNight, isDeepNight);

        // 2. Reactivity (if triggered this frame)
        // Check if this object's species has a pending trigger
        if (frameTriggers.size > 0) {
            const trigger = frameTriggers.get(f.userData.type);
            if (trigger) {
                 musicReactivity.reactObject(f, trigger.note, trigger.volume);
            }
        }
    }

    // Firefly visibility and update (Deep Night only)
    if (fireflies) {
        fireflies.visible = isDeepNight;
        if (isDeepNight) {
            updateFireflies(fireflies, t, delta);
        }
    }

    // Update falling berries (physics)
    updateFallingBerries(delta);

    // Collect falling berries near player
    const berriesCollected = collectFallingBerries(camera.position, 1.5);
    if (berriesCollected > 0) {
        player.energy = Math.min(player.maxEnergy, player.energy + berriesCollected * 0.5);
    }
    // Energy decays slowly over time
    player.energy = Math.max(0, player.energy - delta * 0.1);

    // Update all vine visuals (swinging in wind or physics)
    vineSwings.forEach(v => {
        if (v !== activeVineSwing) {
            v.update(camera, delta, null);
        }
    });

    // Player Movement
    if (controls.isLocked) {
        // --- VINE SWINGING LOGIC ---
        if (activeVineSwing) {
            // Player is attached to a vine
            activeVineSwing.update(camera, delta, keyStates);

            // Detach if Jump is pressed
            if (keyStates.jump) {
                lastVineDetachTime = activeVineSwing.detach(player); // Update physics velocity
                activeVineSwing = null;
                keyStates.jump = false; // Consume jump
            }
        } else {
            // Check for Vine Attachment
            // If in air and close to a vine anchor line
            if (Date.now() - lastVineDetachTime > 500) { // 500ms cooldown
                const playerPos = camera.position;
                for (const vineManager of vineSwings) {
                    // Check horizontal distance to anchor
                    const dx = playerPos.x - vineManager.anchorPoint.x;
                    const dz = playerPos.z - vineManager.anchorPoint.z;
                    const distH = Math.sqrt(dx*dx + dz*dz);

                    // Check vertical range (between anchor and tip)
                    const tipY = vineManager.anchorPoint.y - vineManager.length;

                    if (distH < 2.0 && playerPos.y < vineManager.anchorPoint.y && playerPos.y > tipY) {
                         // Auto-attach if falling or holding jump?
                         // Let's require holding SPACE or getting very close
                         if (distH < 1.0) {
                             vineManager.attach(camera, player.velocity);
                             activeVineSwing = vineManager;
                             break;
                         }
                    }
                }
            }

            // Standard Movement
            let moveSpeed = player.speed;
            if (keyStates.sprint) moveSpeed = player.sprintSpeed;
            if (keyStates.sneak) moveSpeed = player.sneakSpeed;

            _targetVelocity.set(0, 0, 0);
            if (keyStates.forward) _targetVelocity.z += moveSpeed;
            if (keyStates.backward) _targetVelocity.z -= moveSpeed;
            if (keyStates.left) _targetVelocity.x -= moveSpeed;
            if (keyStates.right) _targetVelocity.x += moveSpeed;

            if (_targetVelocity.lengthSq() > 0) {
                _targetVelocity.normalize().multiplyScalar(moveSpeed);
            }

            // Apply BPM Wind effect to player movement (from plan.md - BPM Wind)
            // Wind affects jump trajectory and horizontal movement
            const windEffect = bpmWind.strength * 2.0; // Scale wind effect
            _targetVelocity.x += bpmWind.direction.x * windEffect;
            _targetVelocity.z += bpmWind.direction.z * windEffect;

            const smoothing = Math.min(1.0, 15.0 * delta);
            player.velocity.x += (_targetVelocity.x - player.velocity.x) * smoothing;
            player.velocity.z += (_targetVelocity.z - player.velocity.z) * smoothing;

            player.velocity.y -= player.gravity * delta;

            if (isNaN(player.velocity.x) || isNaN(player.velocity.z) || isNaN(player.velocity.y)) {
                player.velocity.set(0, 0, 0);
            }

            controls.moveRight(player.velocity.x * delta);
            controls.moveForward(player.velocity.z * delta);
        }

        // --- PHYSICS & COLLISION ---
        // Only apply collision if not on vine (vine handles position)
        if (!activeVineSwing) {
            const groundY = getGroundHeight(camera.position.x, camera.position.z);

        // 1. Cloud Walking & Elevator Logic
        let cloudY = -Infinity;
        const playerPos = camera.position;

        // Optimization: Only check clouds if we are high enough
        if (playerPos.y > 15) {
            for (let i = 0; i < foliageClouds.length; i++) {
                const obj = foliageClouds[i];
                // Distance check
                const dx = playerPos.x - obj.position.x;
                const dz = playerPos.z - obj.position.z;
                const distH = Math.sqrt(dx*dx + dz*dz);

                // Visual radius approx
                const radius = (obj.scale.x || 1.0) * 2.0;

                if (distH < radius) {
                    // Tier 1: Walkable Platform
                    if (obj.userData.tier === 1) {
                         const topY = obj.position.y + (obj.scale.y || 1.0) * 0.8;
                         // Check if we are close to top
                         if (playerPos.y >= topY - 0.5 && (playerPos.y - topY) < 3.0) {
                             cloudY = Math.max(cloudY, topY);
                         }
                    }
                    // Tier 2: Elevator / Mist
                    else if (obj.userData.tier === 2) {
                        // If inside the cloud volume
                        const bottomY = obj.position.y - 2.0;
                        const topY = obj.position.y + 2.0;
                        if (playerPos.y > bottomY && playerPos.y < topY) {
                            // Elevator effect: gentle lift
                            player.velocity.y += 30.0 * delta; // Lift against gravity
                            // Cap upward velocity
                            if (player.velocity.y > 8.0) player.velocity.y = 8.0;
                        }
                    }
                }
            }
        }

        // 2. Mushroom Bouncing (Velocity Boost)
        const bounce = checkMushroomBounce(playerPos);
        if (bounce > 0) {
            player.velocity.y = Math.max(player.velocity.y, bounce);
            keyStates.jump = false; // Consume jump
        }

        // 3. Flower Trampoline Bouncing
        const flowerBounce = checkFlowerTrampoline(playerPos);
        if (flowerBounce > 0) {
            player.velocity.y = Math.max(player.velocity.y, flowerBounce);
            keyStates.jump = false;
        }

        // Determine effective ground
        const safeGroundY = Math.max(isNaN(groundY) ? 0 : groundY, cloudY);

            // Landing Logic
            if (camera.position.y < safeGroundY + 1.8 && player.velocity.y <= 0) {
                camera.position.y = safeGroundY + 1.8;
                player.velocity.y = 0;
                if (keyStates.jump) {
                    // Base jump + energy bonus (up to +50% at max energy)
                    const energyBonus = 1 + (player.energy / player.maxEnergy) * 0.5;
                    player.velocity.y = 10 * energyBonus;
                    // Bonus jump height on clouds
                    if (cloudY > groundY) player.velocity.y = 15 * energyBonus;
                }
            } else {
                camera.position.y += player.velocity.y * delta;
            }
        }
    }

    renderer.render(scene, camera);
}

// Initialize WASM then start animation loop
initWasm().then((wasmLoaded) => {
    console.log(`WASM module ${wasmLoaded ? 'active' : 'using JS fallbacks'}`);

    // Enable start button
    if (startButton) {
        startButton.disabled = false;
        startButton.innerText = 'Start Exploration 🚀';
    }

    renderer.setAnimationLoop(animate);
});

// --- Music Upload Handler ---
const musicUpload = document.getElementById('musicUpload');
if (musicUpload) {
    musicUpload.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            console.log(`Selected ${files.length} file(s) for upload`);
            audioSystem.addToQueue(files);
        }
    });
}

const toggleDayNightBtn = document.getElementById('toggleDayNight');
if (toggleDayNightBtn) {
    toggleDayNightBtn.addEventListener('click', toggleDayNight);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
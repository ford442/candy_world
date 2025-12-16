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
    VineSwing, createSwingableVine
} from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor } from './sky.js';
import { createStars, uStarPulse, uStarColor } from './stars.js';
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
        skyTop: new THREE.Color(0x87CEEB),
        skyBot: new THREE.Color(0xADD8E6),
        fog: new THREE.Color(0xFFB6C1),
        sun: new THREE.Color(0xFFFFFF),
        amb: new THREE.Color(0xFFFFFF),
        sunInt: 0.8,
        ambInt: 0.6
    },
    sunset: {
        skyTop: new THREE.Color(0x483D8B),
        skyBot: new THREE.Color(0xFF4500), // Reflective Glow
        fog: new THREE.Color(0xDB7093),
        sun: new THREE.Color(0xFF8C00),
        amb: new THREE.Color(0x800000),
        sunInt: 0.5,
        ambInt: 0.4
    },
    night: {
        skyTop: new THREE.Color(0x020205),
        skyBot: new THREE.Color(0x050510),
        fog: new THREE.Color(0x050510),
        sun: new THREE.Color(0x223355),
        amb: new THREE.Color(0x050510),
        sunInt: 0.1,
        ambInt: 0.05
    },
    sunrise: {
        skyTop: new THREE.Color(0x40E0D0),
        skyBot: new THREE.Color(0xFF69B4),
        fog: new THREE.Color(0xFFDAB9),
        sun: new THREE.Color(0xFFD700),
        amb: new THREE.Color(0xFFB6C1),
        sunInt: 0.6,
        ambInt: 0.5
    }
};

const CONFIG = {
    colors: { ground: 0x98FB98 }
};

// Foliage color palettes
const FOLIAGE_COLORS = {
    floweringTrees: [0xFF69B4, 0x87CEEB, 0xDDA0DD, 0xFFD700, 0xFF6EC7],
    shrubs: [0x32CD32, 0x228B22, 0x2E8B57, 0x3CB371],
    glowingFlowers: [0xFFD700, 0xFF69B4, 0x87CEEB, 0x00FFFF],
    orbs: [0x87CEEB, 0xFF69B4, 0xFFD700, 0x00FFFF, 0xDA70D6],
    vines: [0x228B22, 0x2E8B57, 0x32CD32]
};

const CYCLE_DURATION = 420;

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

const sky = createSky();
scene.add(sky);

const stars = createStars();
scene.add(stars);

const audioSystem = new AudioSystem();
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

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000); // Increased far plane
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
const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.0);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.8);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024; // Reduced from 2048 for better performance
sunLight.shadow.mapSize.height = 1024;
scene.add(sunLight);

// Mild Shaft Lighting / Sun Glow
// We attach a large transparent plane to the sunlight direction to create a "bloom" source
const sunGlowMat = new THREE.MeshBasicMaterial({
    color: 0xFFD700,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
});
const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), sunGlowMat);
sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
sunGlow.lookAt(0, 0, 0);
scene.add(sunGlow);

// --- Procedural Generation ---
// getGroundHeight is now provided by WASM module (with JS fallback)
// Import from wasm-loader.js above

// FIX: Increased ground size to prevent falling off into the void (4000x4000)
const groundGeo = new THREE.PlaneGeometry(4000, 4000, 512, 512);
const posAttribute = groundGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i);
    const zWorld = -y;
    const height = getGroundHeight(x, zWorld);
    posAttribute.setZ(i, height);
}
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.ground,
    roughness: 0.8,
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
initGrassSystem(scene, 5000); // Reduced to fit WebGPU uniform buffer limits

// Initialize Fireflies (for Deep Night)
const fireflies = createFireflies(100, 80);
scene.add(fireflies);

// Initialize Falling Berry Pool (for storms)
initFallingBerries(scene);

function safeAddFoliage(obj, isObstacle = false, radius = 1.0) {
    if (animatedFoliage.length > 3500) {
        console.warn('Foliage limit reached:', animatedFoliage.length);
        return;
    }
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

// --- Spawn Logic ---
// --- Spawn Logic ---
const CLUSTER_COUNT = 90;
for (let i = 0; i < CLUSTER_COUNT; i++) {
    const cx = (Math.random() - 0.5) * 260;
    const cz = (Math.random() - 0.5) * 260;
    const type = Math.random();
    const subRoll = Math.random();

    if (type < 0.2) { // Swamp
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);

            // Mix of sizes
            const isGiant = Math.random() < 0.1;
            const size = isGiant ? 'giant' : 'regular';
            const m = createMushroom({ size: size, scale: 0.8 + Math.random() * 0.5 });

            m.position.set(x, y, z);
            m.rotation.y = Math.random() * Math.PI * 2;
            m.rotation.z = (Math.random() - 0.5) * 0.2; // Slight tilt

            safeAddFoliage(m, true, isGiant ? 2.0 : 0.5);
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
        const count = 8; // Reduced for performance
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 25;
            const z = cz + (Math.random() - 0.5) * 25;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            let plant;
            if (r < 0.3) plant = createSubwooferLotus({ color: 0x2E8B57 });
            else if (r < 0.6) plant = createAccordionPalm({ color: 0xFF6347 });
            else plant = createFiberOpticWillow();

            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 1.0);
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
        const count = 15; // Reduced for performance
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

// --- Additional Foliage Spawning (from plan.md) ---

// Flowering Trees (40)
for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = getGroundHeight(x, z);
    const tree = createFloweringTree({ color: FOLIAGE_COLORS.floweringTrees[Math.floor(Math.random() * FOLIAGE_COLORS.floweringTrees.length)] });
    tree.position.set(x, y, z);
    safeAddFoliage(tree, true, 2.0);
}

// Regular Trees (using shrubs for variety, 50)
for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = getGroundHeight(x, z);
    const shrub = createShrub({ color: FOLIAGE_COLORS.shrubs[Math.floor(Math.random() * FOLIAGE_COLORS.shrubs.length)] });
    shrub.position.set(x, y, z);
    shrub.scale.set(2, 2, 2);
    safeAddFoliage(shrub, true, 1.5);
}

// Glowing Flowers (30)
for (let i = 0; i < 30; i++) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = getGroundHeight(x, z);
    const flower = createGlowingFlower({ color: FOLIAGE_COLORS.glowingFlowers[Math.floor(Math.random() * FOLIAGE_COLORS.glowingFlowers.length)], intensity: 1.5 });
    flower.position.set(x, y, z);
    safeAddFoliage(flower);
}

// Floating Orbs (25)
for (let i = 0; i < 25; i++) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = getGroundHeight(x, z) + 3 + Math.random() * 5;
    const orb = createFloatingOrb({ color: FOLIAGE_COLORS.orbs[Math.floor(Math.random() * FOLIAGE_COLORS.orbs.length)], size: 0.3 + Math.random() * 0.3 });
    orb.position.set(x, y, z);
    safeAddFoliage(orb);
}

// Vines (15)
for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = getGroundHeight(x, z);
    const vine = createVine({ color: FOLIAGE_COLORS.vines[Math.floor(Math.random() * FOLIAGE_COLORS.vines.length)], length: 3 + Math.floor(Math.random() * 3) });
    vine.position.set(x, y, z);
    safeAddFoliage(vine);
}

const rainingClouds = [];
for (let i = 0; i < 25; i++) {
    const isRaining = Math.random() > 0.6;
    const cloud = isRaining ? createRainingCloud({ rainIntensity: 100 }) : createCloud();
    cloud.position.set((Math.random() - 0.5) * 200, 25 + Math.random() * 10, (Math.random() - 0.5) * 200);
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
    fog: new THREE.Color(),
    sun: new THREE.Color(),
    amb: new THREE.Color(),
    sunInt: 0,
    ambInt: 0
};

function lerpPalette(p1, p2, t) {
    _scratchPalette.skyTop.copy(p1.skyTop).lerp(p2.skyTop, t);
    _scratchPalette.skyBot.copy(p1.skyBot).lerp(p2.skyBot, t);
    _scratchPalette.fog.copy(p1.fog).lerp(p2.fog, t);
    _scratchPalette.sun.copy(p1.sun).lerp(p2.sun, t);
    _scratchPalette.amb.copy(p1.amb).lerp(p2.amb, t);
    _scratchPalette.sunInt = THREE.MathUtils.lerp(p1.sunInt, p2.sunInt, t);
    _scratchPalette.ambInt = THREE.MathUtils.lerp(p1.ambInt, p2.ambInt, t);
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

        // Update Glow Position
        sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
        sunGlow.lookAt(camera.position); // Billboard
    } else {
        sunLight.visible = false;
        sunGlow.visible = false;
        // Moon logic could go here
    }

    let starOpacity = 0;
    if (isNight) starOpacity = 1;
    else starOpacity = 0;
    if (stars.material) stars.material.opacity = THREE.MathUtils.lerp(stars.material.opacity, starOpacity, delta);

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

    animatedFoliage.forEach(f => {
        // Skip animation for objects far from camera
        const distSq = f.position.distanceToSquared(camPos);
        if (distSq > maxDistanceSq) return;

        animateFoliage(f, t, audioState, !isNight, isDeepNight);
    });

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

            const targetVelocity = new THREE.Vector3();
            if (keyStates.forward) targetVelocity.z += moveSpeed;
            if (keyStates.backward) targetVelocity.z -= moveSpeed;
            if (keyStates.left) targetVelocity.x -= moveSpeed;
            if (keyStates.right) targetVelocity.x += moveSpeed;

            if (targetVelocity.lengthSq() > 0) {
                targetVelocity.normalize().multiplyScalar(moveSpeed);
            }

            // Apply BPM Wind effect to player movement (from plan.md - BPM Wind)
            // Wind affects jump trajectory and horizontal movement
            const windEffect = bpmWind.strength * 2.0; // Scale wind effect
            targetVelocity.x += bpmWind.direction.x * windEffect;
            targetVelocity.z += bpmWind.direction.z * windEffect;

            const smoothing = Math.min(1.0, 15.0 * delta);
            player.velocity.x += (targetVelocity.x - player.velocity.x) * smoothing;
            player.velocity.z += (targetVelocity.z - player.velocity.z) * smoothing;

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

        // 1. Cloud Walking (Raycast-like check + simple box)
        let cloudY = -Infinity;
        const playerPos = camera.position;

        // Optimization: Only check clouds if we are high enough
        if (playerPos.y > 20) {
            for (let i = 0; i < foliageClouds.length; i++) {
                const obj = foliageClouds[i];
                // Simple distance check first
                const dx = playerPos.x - obj.position.x;
                const dz = playerPos.z - obj.position.z;
                if (Math.abs(dx) < 3 && Math.abs(dz) < 3) {
                    // We are roughly over/under a cloud
                    // Cloud top is approx position.y + 1.0 (radius approx 1.5)
                    const topY = obj.position.y + 0.5;
                    if (playerPos.y >= topY && (playerPos.y - topY) < 2.0) {
                        cloudY = Math.max(cloudY, topY);
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
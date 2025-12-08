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
    createMushroom, createWaterfall
} from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor } from './sky.js';
import { createStars, uStarPulse, uStarColor } from './stars.js';
import { AudioSystem } from './audio-system.js';

// --- Configuration ---
// Cycle: Sunrise (1m), Day (7m), Sunset (1m), Night (7m) = Total 16m = 960s
const DURATION_SUNRISE = 60;
const DURATION_DAY = 420;
const DURATION_SUNSET = 60;
const DURATION_NIGHT = 420;
const CYCLE_DURATION = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET + DURATION_NIGHT;

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

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

const sky = createSky();
scene.add(sky);

const stars = createStars();
scene.add(stars);

const audioSystem = new AudioSystem();
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
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Lighting ---
const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.0);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.8);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
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
function getGroundHeight(x, z) {
    if (isNaN(x) || isNaN(z)) return 0; // Guard
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 + (Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3);
}

const groundGeo = new THREE.PlaneGeometry(2000, 2000, 256, 256);
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
const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);

// Initialize Grass
initGrassSystem(scene, 30000); // Increased count for density

function safeAddFoliage(obj, isObstacle = false, radius = 1.0) {
    if (animatedFoliage.length > 4000) return; // Increased limit
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });
}

// --- NEW SCENE CLUSTERING SPAWNER ---

function spawnCluster(cx, cz, type) {
    // Each cluster is roughly 30x30 units

    // 1. Mushroom Forest (Fixes "0 mushrooms" issue)
    if (type === 'mushroom_forest') {
        const count = 40 + Math.random() * 20;
        for(let i=0; i<count; i++) {
            const x = cx + (Math.random() - 0.5) * 30;
            const z = cz + (Math.random() - 0.5) * 30;
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
        const count = 60 + Math.random() * 20;
        for(let i=0; i<count; i++) {
            const x = cx + (Math.random() - 0.5) * 35;
            const z = cz + (Math.random() - 0.5) * 35;
            const y = getGroundHeight(x, z);

            // Mix grass in
            addGrassInstance(x, y, z);
            addGrassInstance(x + 0.5, y, z + 0.5);

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
        const count = 15;
        for(let i=0; i<count; i++) {
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
    }

    // 4. Crystal Grove (Prisms, Starflowers)
    else if (type === 'crystal_grove') {
        const count = 25;
        for(let i=0; i<count; i++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            const plant = r < 0.5 ? createPrismRoseBush() : createStarflower();
            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 0.8);
        }
    }
}

// Generate the Map
const SCENE_GRID_SIZE = 40; // Spacing between centers
const SCENE_ROWS = 6;
const SCENE_COLS = 6;
const SCENE_TYPES = ['mushroom_forest', 'flower_field', 'weird_jungle', 'crystal_grove'];

for (let r = -SCENE_ROWS/2; r < SCENE_ROWS/2; r++) {
    for (let c = -SCENE_COLS/2; c < SCENE_COLS/2; c++) {
        const cx = r * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;
        const cz = c * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;

        // Pick a type based on noise or random
        const typeIndex = Math.floor(Math.random() * SCENE_TYPES.length);
        spawnCluster(cx, cz, SCENE_TYPES[typeIndex]);

        // Fill gaps with grass
        for(let k=0; k<20; k++) {
             const gx = cx + (Math.random()-0.5) * 40;
             const gz = cz + (Math.random()-0.5) * 40;
             const gy = getGroundHeight(gx, gz);
             addGrassInstance(gx, gy, gz);
        }
    }
}

// Rain Clouds
for (let i = 0; i < 20; i++) {
    const cloud = createRainingCloud({ rainIntensity: 100 });
    cloud.position.set((Math.random() - 0.5) * 200, 35 + Math.random() * 10, (Math.random() - 0.5) * 200);
    scene.add(cloud);
    animatedFoliage.push(cloud);
}

// --- Inputs ---
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
instructions.addEventListener('click', () => controls.lock());
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
    gravity: 20.0
};

// --- Cycle Interpolation (Corrected for Segments) ---
function getCycleState(tRaw) {
    const t = tRaw % CYCLE_DURATION;

    // 0 -> Sunrise End (60s)
    if (t < DURATION_SUNRISE) {
        const p = t / DURATION_SUNRISE;
        return lerpPalette(PALETTE.night, PALETTE.sunrise, p);
    }
    // 60 -> Day End (480s)
    else if (t < DURATION_SUNRISE + DURATION_DAY) {
        // Transition from Sunrise to Day quickly at start of Day block?
        // Or just hold Day? Let's Lerp from Sunrise to Day over 60s, then hold.
        const dayTime = t - DURATION_SUNRISE;
        if (dayTime < 60) return lerpPalette(PALETTE.sunrise, PALETTE.day, dayTime / 60);
        return PALETTE.day;
    }
    // 480 -> Sunset End (540s)
    else if (t < DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET) {
        const p = (t - (DURATION_SUNRISE + DURATION_DAY)) / DURATION_SUNSET;
        return lerpPalette(PALETTE.day, PALETTE.sunset, p);
    }
    // 540 -> Night End (960s)
    else {
        // Night
        const nightTime = t - (DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET);
        if (nightTime < 60) return lerpPalette(PALETTE.sunset, PALETTE.night, nightTime / 60);
        return PALETTE.night;
    }
}

function lerpPalette(p1, p2, t) {
    return {
        skyTop: p1.skyTop.clone().lerp(p2.skyTop, t),
        skyBot: p1.skyBot.clone().lerp(p2.skyBot, t),
        fog: p1.fog.clone().lerp(p2.fog, t),
        sun: p1.sun.clone().lerp(p2.sun, t),
        amb: p1.amb.clone().lerp(p2.amb, t),
        sunInt: THREE.MathUtils.lerp(p1.sunInt, p2.sunInt, t),
        ambInt: THREE.MathUtils.lerp(p1.ambInt, p2.ambInt, t)
    };
}

// --- Animation ---
const clock = new THREE.Clock();
let audioState = null;

function animate() {
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.getElapsedTime();

    audioState = audioSystem.update();

    // Cycle Update
    const effectiveTime = t + timeOffset;
    const currentState = getCycleState(effectiveTime);

    // Determine isNight for foliage logic
    const cyclePos = effectiveTime % CYCLE_DURATION;
    const nightStart = DURATION_SUNRISE + DURATION_DAY + DURATION_SUNSET; // 540
    const sunriseStart = 0; // 0
    // Strictly, night is the dark period.
    isNight = (cyclePos > nightStart - 30) || (cyclePos < DURATION_SUNRISE);

    uSkyTopColor.value.copy(currentState.skyTop);
    uSkyBottomColor.value.copy(currentState.skyBot);
    scene.fog.color.copy(currentState.fog);

    // Fog Density
    const targetNear = isNight ? 5 : 20;
    const targetFar = isNight ? 40 : 100;
    scene.fog.near += (targetNear - scene.fog.near) * delta * 0.5;
    scene.fog.far += (targetFar - scene.fog.far) * delta * 0.5;

    sunLight.color.copy(currentState.sun);
    sunLight.intensity = currentState.sunInt;
    ambientLight.color.copy(currentState.amb);
    ambientLight.intensity = currentState.ambInt;

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

    updateFoliageMaterials(audioState, isNight);
    animatedFoliage.forEach(f => animateFoliage(f, t, audioState, !isNight));

    // Player Movement
    if (controls.isLocked) {
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

        const smoothing = Math.min(1.0, 15.0 * delta);
        player.velocity.x += (targetVelocity.x - player.velocity.x) * smoothing;
        player.velocity.z += (targetVelocity.z - player.velocity.z) * smoothing;

        player.velocity.y -= player.gravity * delta;

        if (isNaN(player.velocity.x) || isNaN(player.velocity.z) || isNaN(player.velocity.y)) {
            player.velocity.set(0, 0, 0);
        }

        controls.moveRight(player.velocity.x * delta);
        controls.moveForward(player.velocity.z * delta);

        const groundY = getGroundHeight(camera.position.x, camera.position.z);
        const safeGroundY = isNaN(groundY) ? 0 : groundY;

        if (camera.position.y < safeGroundY + 1.8) {
            camera.position.y = safeGroundY + 1.8;
            player.velocity.y = 0;
            if (keyStates.jump) player.velocity.y = 10;
        } else {
            camera.position.y += player.velocity.y * delta;
        }
    }

    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

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
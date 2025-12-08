import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, PointsNodeMaterial } from 'three/webgpu';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle, createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster, createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush, createPrismRoseBush, initGrassSystem, addGrassInstance, updateFoliageMaterials, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow } from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor } from './sky.js';
import { createStars, uStarPulse, uStarColor } from './stars.js';
import { AudioSystem } from './audio-system.js';

// --- Configuration ---
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
        skyBot: new THREE.Color(0xFF4500),
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
let isNight = false;
let dayNightFactor = 0.0;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
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

// --- Procedural Generation ---
function getGroundHeight(x, z) {
    if (isNaN(x) || isNaN(z)) return 0; // Guard
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 + (Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3);
}

const groundGeo = new THREE.PlaneGeometry(300, 300, 128, 128);
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

// Initialize Grass (Reduced count for safety)
initGrassSystem(scene, 20000);

function safeAddFoliage(obj, isObstacle = false, radius = 1.0) {
    if (animatedFoliage.length > 2500) return;
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });
}

// --- Spawn Logic ---
const CLUSTER_COUNT = 60;
for (let i = 0; i < CLUSTER_COUNT; i++) {
    const cx = (Math.random() - 0.5) * 260;
    const cz = (Math.random() - 0.5) * 260;
    const type = Math.random();

    if (type < 0.2) { // Swamp
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const lotus = createSubwooferLotus({ color: 0x2E8B57 });
            lotus.position.set(x, y + 0.5, z);
            safeAddFoliage(lotus);
        }
        for (let j = 0; j < 2; j++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);
            const willow = createFiberOpticWillow();
            willow.position.set(x, y, z);
            safeAddFoliage(willow, true, 1.0);
        }
    } else if (type < 0.4) { // Accordion
        for (let j = 0; j < 6; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const palm = createAccordionPalm({ color: 0xFF6347 });
            palm.position.set(x, y, z);
            safeAddFoliage(palm, true, 0.8);
        }
    } else if (type < 0.7) { // Meadow
        for (let j = 0; j < 150; j++) {
            const r = Math.random() * 10;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const y = getGroundHeight(x, z);
            addGrassInstance(x, y, z);
        }
        for (let j = 0; j < 8; j++) {
            const r = Math.random() * 8;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const y = getGroundHeight(x, z);
            const f = createFlower({ color: 0xFF69B4 });
            f.position.set(x, y, z);
            safeAddFoliage(f);
        }
    } else { // Weird
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const obj = Math.random() < 0.5 ? createPrismRoseBush() : createPuffballFlower();
            obj.position.set(x, y, z);
            safeAddFoliage(obj);
        }
    }
}

const rainingClouds = [];
for (let i = 0; i < 25; i++) {
    const isRaining = Math.random() > 0.6;
    const cloud = isRaining ? createRainingCloud({ rainIntensity: 100 }) : createCloud();
    cloud.position.set((Math.random() - 0.5) * 200, 25 + Math.random() * 10, (Math.random() - 0.5) * 200);
    scene.add(cloud);
    if (cloud.userData.animationType === 'rain') {
        animatedFoliage.push(cloud);
        rainingClouds.push(cloud);
    }
}

// --- Inputs ---
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
instructions.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => instructions.style.display = 'none');
controls.addEventListener('unlock', () => instructions.style.display = 'flex');

const keyStates = { forward: false, backward: false, left: false, right: false, jump: false };
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keyStates.forward = true;
    if (e.code === 'KeyS') keyStates.backward = true;
    if (e.code === 'KeyA') keyStates.left = true;
    if (e.code === 'KeyD') keyStates.right = true;
    if (e.code === 'Space') keyStates.jump = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keyStates.forward = false;
    if (e.code === 'KeyS') keyStates.backward = false;
    if (e.code === 'KeyA') keyStates.left = false;
    if (e.code === 'KeyD') keyStates.right = false;
    if (e.code === 'Space') keyStates.jump = false;
});

// Player State
const player = {
    velocity: new THREE.Vector3(),
    speed: 30.0,
    gravity: 20.0
};

// --- Cycle Interpolation ---
function getCycleState(progress) {
    if (progress < 0.40) return PALETTE.day;
    else if (progress < 0.50) return lerpPalette(PALETTE.day, PALETTE.sunset, (progress - 0.40) / 0.10);
    else if (progress < 0.55) return lerpPalette(PALETTE.sunset, PALETTE.night, (progress - 0.50) / 0.05);
    else if (progress < 0.90) return PALETTE.night;
    else if (progress < 0.95) return lerpPalette(PALETTE.night, PALETTE.sunrise, (progress - 0.90) / 0.05);
    else return lerpPalette(PALETTE.sunrise, PALETTE.day, (progress - 0.95) / 0.05);
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
    // 1. Time & Safety
    const rawDelta = clock.getDelta();
    // Prevent explosion on lag spikes (cap at 0.1s)
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.getElapsedTime();

    audioState = audioSystem.update();

    // 2. Day/Night Cycle
    const progress = (t % CYCLE_DURATION) / CYCLE_DURATION;
    isNight = (progress > 0.50 && progress < 0.95);
    const currentState = getCycleState(progress);

    uSkyTopColor.value.copy(currentState.skyTop);
    uSkyBottomColor.value.copy(currentState.skyBot);
    scene.fog.color.copy(currentState.fog);

    // Smooth Fog transition
    const targetNear = isNight ? 5 : (progress > 0.4 && progress < 0.55 ? 10 : 20);
    const targetFar = isNight ? 40 : (progress > 0.4 && progress < 0.55 ? 60 : 100);
    scene.fog.near += (targetNear - scene.fog.near) * delta * 0.5;
    scene.fog.far += (targetFar - scene.fog.far) * delta * 0.5;

    sunLight.color.copy(currentState.sun);
    sunLight.intensity = currentState.sunInt;
    ambientLight.color.copy(currentState.amb);
    ambientLight.intensity = currentState.ambInt;

    let starOpacity = 0;
    if (progress > 0.50 && progress < 0.95) starOpacity = 1;
    else if (progress > 0.45 && progress <= 0.50) starOpacity = (progress - 0.45) / 0.05;
    else if (progress >= 0.95) starOpacity = 1.0 - (progress - 0.95) / 0.05;
    if (stars.material) stars.material.opacity = starOpacity;

    updateFoliageMaterials(audioState, isNight);
    animatedFoliage.forEach(f => animateFoliage(f, t, audioState, !isNight));

    // 3. Robust Player Movement (Direct Velocity Control)
    if (controls.isLocked) {
        // A. Calculate Target Velocity based on keys
        const targetVelocity = new THREE.Vector3();
        if (keyStates.forward) targetVelocity.z += player.speed;
        if (keyStates.backward) targetVelocity.z -= player.speed;
        if (keyStates.left) targetVelocity.x -= player.speed;
        if (keyStates.right) targetVelocity.x += player.speed;

        // B. Normalize to prevent fast diagonals
        if (targetVelocity.lengthSq() > 0) {
            targetVelocity.normalize().multiplyScalar(player.speed);
        }

        // C. Smoothly interpolate current velocity to target (10.0 = responsiveness)
        const smoothing = 10.0 * delta;
        player.velocity.x += (targetVelocity.x - player.velocity.x) * smoothing;
        player.velocity.z += (targetVelocity.z - player.velocity.z) * smoothing;

        // D. Apply Gravity (Independent of smoothing)
        player.velocity.y -= player.gravity * delta;

        // E. NaN Guard: Reset if physics broke
        if (isNaN(player.velocity.x) || isNaN(player.velocity.z) || isNaN(player.velocity.y)) {
            player.velocity.set(0, 0, 0);
        }

        // F. Move Camera
        // PointerLockControls moves relative to camera look direction
        controls.moveRight(player.velocity.x * delta);
        controls.moveForward(player.velocity.z * delta);

        // G. Ground Collision
        const groundY = getGroundHeight(camera.position.x, camera.position.z);
        // Safety check for NaN ground
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

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
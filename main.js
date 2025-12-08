import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, PointsNodeMaterial } from 'three/webgpu';
import { color, float, vec3, time, positionLocal, attribute, storage, uniform, uv } from 'three/tsl';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle, createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster, createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush, createPrismRoseBush, initGrassSystem, addGrassInstance, updateFoliageMaterials, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow } from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor } from './sky.js';
// FIX: Add uStarOpacity to imports
import { createStars, uStarPulse, uStarColor, uStarOpacity } from './stars.js';
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
let timeOffset = 0; // Manual time shift for Day/Night toggle

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000); // Increased far plane
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

// --- Materials ---
function createClayMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.0,
        roughness: 0.8, // Matte surface
        flatShading: false,
    });
}

const materials = {
    ground: createClayMaterial(CONFIG.colors.ground),
    trunk: createClayMaterial(0x8B5A2B), // Brownish
    leaves: [
        createClayMaterial(0xFF69B4), // Hot Pink
        createClayMaterial(0x87CEEB), // Sky Blue
        createClayMaterial(0xDDA0DD), // Plum
        createClayMaterial(0xFFD700), // Gold
    ],
    mushroomStem: createClayMaterial(0xF5DEB3), // Wheat
    mushroomCap: [
        createClayMaterial(0xFF6347), // Tomato
        createClayMaterial(0xDA70D6), // Orchid
        createClayMaterial(0xFFA07A), // Light Salmon
    ],
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }),
    cloud: new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    }),
    drivableMushroomCap: createClayMaterial(0x00BFFF)
};

// --- Helper Objects ---
const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);

function createCloud() {
    const group = new THREE.Group();
    const blobs = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobs; i++) {
        const size = 2 + Math.random() * 2;
        const geo = new THREE.SphereGeometry(size, 16, 16);
        const mesh = new THREE.Mesh(geo, materials.cloud);
        mesh.position.set(
            (Math.random() - 0.5) * size * 1.5,
            (Math.random() - 0.5) * size * 0.5,
            (Math.random() - 0.5) * size * 1.5
        );
        group.add(mesh);
    }
    return group;
}

function createWaterfall(height, colorHex = 0x87CEEB) {
    const particleCount = 2000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    const offsets = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 2.0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
        speeds[i] = 1.0 + Math.random() * 2.0;
        offsets[i] = Math.random() * height;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

    const mat = new PointsNodeMaterial({
        color: colorHex,
        size: 0.4,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    const aSpeed = attribute('aSpeed', 'float');
    const aOffset = attribute('aOffset', 'float');
    const uSpeed = uniform(1.0);
    mat.uSpeed = uSpeed;

    const t = time.mul(uSpeed);
    const fallHeight = float(height);
    const currentDist = aOffset.add(aSpeed.mul(t));
    const modDist = currentDist.mod(fallHeight);
    const newY = modDist.negate();

    mat.positionNode = vec3(
        positionLocal.x,
        newY,
        positionLocal.z
    );

    const waterfall = new THREE.Points(geo, mat);
    waterfall.userData = { animationType: 'gpuWaterfall' };
    return waterfall;
}

function createGiantMushroom(x, z, scale = 8) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    const stemH = (1.5 + Math.random()) * scale;
    const stemR = (0.3 + Math.random() * 0.2) * scale;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.castShadow = true;
    group.add(stem);

    const capR = stemR * 3 + Math.random() * scale;
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const matIndex = Math.floor(Math.random() * materials.mushroomCap.length);
    const capMaterial = materials.mushroomCap[matIndex];
    const cap = new THREE.Mesh(capGeo, capMaterial);
    cap.position.y = stemH;

    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);
    faceGroup.scale.set(scale, scale, scale);

    const leftEye = new THREE.Mesh(eyeGeo, materials.eye);
    leftEye.position.set(-0.15, 0.1, 0);
    const rightEye = new THREE.Mesh(eyeGeo, materials.eye);
    rightEye.position.set(0.15, 0.1, 0);

    const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
    const smile = new THREE.Mesh(smileGeo, materials.mouth);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.05, 0);

    faceGroup.add(leftEye, rightEye, smile);
    group.add(faceGroup);
    group.add(cap);

    worldGroup.add(group);
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 1.2
    });

    const anims = ['wobble', 'bounce', 'accordion'];
    const chosenAnim = anims[Math.floor(Math.random() * anims.length)];
    group.userData.animationType = chosenAnim;
    group.userData.type = 'mushroom';

    const giantMushroom = { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: false };
}

function createGiantRainCloud(options = {}) {
    const { color = 0x555555, rainIntensity = 200 } = options;
    const group = new THREE.Group();

    const cloudGeo = new THREE.SphereGeometry(4.5, 32, 32);
    const cloudMat = materials.cloud.clone();
    cloudMat.color.setHex(color);
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.castShadow = true;
    group.add(cloud);

    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainIntensity * 3);
    for (let i = 0; i < rainIntensity; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 9.0;
        positions[i * 3 + 1] = Math.random() * -6.0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 9.0;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
    const rain = new THREE.Points(rainGeo, rainMat);
    group.add(rain);

    group.userData.animationType = 'rain';
    return group;
}

// --- Procedural Generation ---
function getGroundHeight(x, z) {
    if (isNaN(x) || isNaN(z)) return 0; // Guard
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 + (Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3);
}

// FIX: Increased ground size to prevent falling off into the void
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

// Initialize Grass (Reduced count for safety)
initGrassSystem(scene, 20000);

function safeAddFoliage(obj, isObstacle = false, radius = 1.0) {
    if (animatedFoliage.length > 2500) return;
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });
}

// --- Spawn Logic ---
// --- Spawn Logic ---
const CLUSTER_COUNT = 60;
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
    } else if (type < 0.6) { // Meadow
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
    } else if (type < 0.8) { // Fantasy (Mushroom Zone)
        for (let j = 0; j < 8; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            if (subRoll < 0.3) {
                // Small Mushrooms
                const m = createMushroom(x, z);
                // m is a wrapper { mesh: group } to support animation targeting
                if (m && m.mesh) {
                    safeAddFoliage(m.mesh, false);
                }
            } else {
                // Other fantasy plants
                const y = getGroundHeight(x, z);
                const plant = createPuffballFlower();
                plant.position.set(x, y, z);
                safeAddFoliage(plant);
            }
        }
    } else { // Weird
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const obj = Math.random() < 0.5 ? createPrismRoseBush() : createBubbleWillow();
            obj.position.set(x, y, z);
            safeAddFoliage(obj);
        }
    }
}

function createMushroom(x, z) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Stem
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.15, 0.4, 8),
        materials.mushroomStem
    );
    stem.position.y = 0.2;
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.mushroomCap[Math.floor(Math.random() * materials.mushroomCap.length)]
    );
    cap.position.y = 0.4;
    cap.castShadow = true;
    group.add(cap);

    group.userData.animationType = 'bounce'; // Use bounce/squash
    group.userData.type = 'mushroom';

    return { mesh: group, type: 'mushroom' };
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

// --- OVERGROWN & KING MUSHROOM ZONES ---
function spawnKingMushroomZone(cx, cz) {
    const scale = 12;
    const stemH = 2.5 * scale;
    const stemR = 0.4 * scale;
    const capR = 1.5 * scale;

    const group = new THREE.Group();
    group.position.set(cx, getGroundHeight(cx, cz), cz);

    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 32),
        materials.mushroomStem
    );
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.mushroomCap[0]
    );
    cap.position.y = stemH;
    group.add(cap);

    const poolGeo = new THREE.CylinderGeometry(capR * 0.8, capR * 0.8, 0.5, 32);
    const poolMat = new THREE.MeshStandardMaterial({
        color: 0x0099FF,
        roughness: 0.1,
        metalness: 0.5
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.y = stemH + (capR * 0.2);
    group.add(pool);

    const waterfallOffset = capR * 0.8;
    const waterfall = createWaterfall(stemH);
    waterfall.position.set(0, stemH + 0.5, waterfallOffset);
    group.add(waterfall);

    obstacles.push({ position: group.position.clone(), radius: stemR * 1.2 });
    scene.add(group);
    animatedFoliage.push(waterfall);

    const splashZone = new THREE.Object3D();
    splashZone.position.set(cx, 0, cz + waterfallOffset);
    splashZone.userData = { animationType: 'rain' };
    rainingClouds.push(splashZone);

    for (let i = 0; i < 20; i++) {
        const r = 15 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);

        const type = Math.random();
        let plant;
        if (type < 0.33) plant = createBubbleWillow({ color: 0xDA70D6 });
        else if (type < 0.66) plant = createHelixPlant({ color: 0x7FFFD4 });
        else plant = createStarflower({ color: 0xFFD700 });

        const pScale = 4 + Math.random() * 4;
        plant.position.set(x, getGroundHeight(x, z), z);
        plant.scale.set(pScale, pScale, pScale);

        safeAddFoliage(plant, true, 1.0 * pScale);
    }
}

function spawnOvergrownZone(cx, cz) {
    const radius = 50;
    for (let i = 0; i < 3; i++) {
        const cloud = createGiantRainCloud({ rainIntensity: 200, color: 0x555555 });
        cloud.position.set(
            cx + (Math.random() - 0.5) * 30,
            60 + Math.random() * 10,
            cz + (Math.random() - 0.5) * 30
        );
        scene.add(cloud);
        animatedFoliage.push(cloud);
    }

    // Increased Mushrooms from 15 to 30
    for (let i = 0; i < 30; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        createGiantMushroom(x, z, 8 + Math.random() * 7);
    }

    for (let i = 0; i < 30; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        const y = getGroundHeight(x, z);

        const type = Math.random();
        let plant;

        if (type < 0.4) {
            plant = createHelixPlant({ color: 0x00FF00 });
            plant.scale.set(5, 5, 5);
        } else if (type < 0.7) {
            plant = createStarflower({ color: 0xFF00FF });
            plant.scale.set(4, 4, 4);
        } else {
            plant = createBubbleWillow({ color: 0x00BFFF });
            plant.scale.set(3, 3, 3);
        }

        plant.position.set(x, y, z);
        safeAddFoliage(plant, true, 2.0);
    }
}

spawnOvergrownZone(-100, -100);
spawnKingMushroomZone(-100, -100);

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
        case 'KeyW':
            // W is now JUMP
            keyStates.jump = true;
            break;
        case 'KeyA': keyStates.left = true; break;
        case 'KeyS': keyStates.backward = true; break;
        case 'KeyD': keyStates.right = true; break;
        case 'Space': keyStates.jump = true; break; // Space also Jumps
        case 'KeyN':
            toggleDayNight();
            break;
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
        case 'ControlRight':
            keyStates.sneak = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            keyStates.sprint = false;
            break;
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
    speed: 10.0, // Reduced from 15.0
    sprintSpeed: 18.0, // Reduced from 25.0
    sneakSpeed: 5.0,
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

    // 2. Day/Night Cycle with Manual Toggle Support
    const effectiveTime = t + timeOffset;
    const progress = (effectiveTime % CYCLE_DURATION) / CYCLE_DURATION;

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

    // --- FIX: Update the WebGPU Uniform for Star Opacity ---
    let starOp = 0;
    if (progress > 0.50 && progress < 0.95) starOp = 1;
    else if (progress > 0.45 && progress <= 0.50) starOp = (progress - 0.45) / 0.05;
    else if (progress >= 0.95) starOp = 1.0 - (progress - 0.95) / 0.05;

    // Instead of setting material.opacity, we set the node uniform value
    uStarOpacity.value = starOp;

    updateFoliageMaterials(audioState, isNight);
    animatedFoliage.forEach(f => animateFoliage(f, t, audioState, !isNight));

    // 3. Robust Player Movement (Direct Velocity Control)
    if (controls.isLocked) {
        // Determine base speed
        let moveSpeed = player.speed;
        if (keyStates.sprint) moveSpeed = player.sprintSpeed;
        if (keyStates.sneak) moveSpeed = player.sneakSpeed;

        // A. Calculate Target Velocity based on keys
        const targetVelocity = new THREE.Vector3();
        if (keyStates.forward) targetVelocity.z += moveSpeed;
        if (keyStates.backward) targetVelocity.z -= moveSpeed;
        if (keyStates.left) targetVelocity.x -= moveSpeed;
        if (keyStates.right) targetVelocity.x += moveSpeed;

        // B. Normalize to prevent fast diagonals
        if (targetVelocity.lengthSq() > 0) {
            targetVelocity.normalize().multiplyScalar(moveSpeed);
        }

        // C. Smoothly interpolate current velocity to target (10.0 = responsiveness)
        // FIX: Clamp smoothing factor to prevent overshoot/explosion
        const smoothing = Math.min(1.0, 15.0 * delta);
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

// --- Toggle Day/Night Button ---
const toggleDayNightBtn = document.getElementById('toggleDayNight');
if (toggleDayNightBtn) {
    toggleDayNightBtn.addEventListener('click', toggleDayNight);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

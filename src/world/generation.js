// src/world/generation.js

import * as THREE from 'three';
import { getGroundHeight } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createMelodyLake, createFireflies, initFallingBerries,
    initGrassSystem, addGrassInstance
} from '../foliage/index.js';
import { CONFIG } from '../core/config.js';
import {
    animatedFoliage, obstacles, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, vineSwings
} from './state.js';

// --- Scene Setup ---

export function initWorld(scene, weatherSystem) {
    // Sky
    const sky = createSky();
    scene.add(sky);

    // Stars
    const stars = createStars();
    scene.add(stars);

    // Moon
    const moon = createMoon();
    moon.position.set(-50, 60, -30); // High up
    scene.add(moon);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(2000, 2000, 128, 128);
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

    // Initialize Vegetation Systems
    initGrassSystem(scene, 8000);

    // Fireflies (Deep Night)
    const fireflies = createFireflies(150, 100);
    scene.add(fireflies);

    // Melody Lake
    const melodyLake = createMelodyLake(100, 100);
    melodyLake.position.set(0, 2.5, 0);
    scene.add(melodyLake);

    // Falling Berries
    initFallingBerries(scene);

    // Generate Map
    generateMap(weatherSystem);

    return { sky, stars, moon, ground, fireflies };
}

export function safeAddFoliage(obj, isObstacle = false, radius = 1.0, weatherSystem = null) {
    if (animatedFoliage.length > 2500) return;
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });

    // Optimization
    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);

    // Register with weather system
    if (weatherSystem) {
        if (obj.userData.type === 'tree') {
            weatherSystem.registerTree(obj);
        } else if (obj.userData.type === 'shrub') {
            weatherSystem.registerShrub(obj);
        } else if (obj.userData.type === 'mushroom') {
            weatherSystem.registerMushroom(obj);
        }
    }
}

// --- CLUSTERING SPAWNER ---

function spawnCluster(cx, cz, type, weatherSystem) {
    // 1. Mushroom Forest
    if (type === 'mushroom_forest') {
        const count = 25 + Math.random() * 10;
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 30;
            const z = cz + (Math.random() - 0.5) * 30;
            const y = getGroundHeight(x, z);

            const isGiant = Math.random() < 0.15;
            const size = isGiant ? 'giant' : 'regular';
            const m = createMushroom({ size: size, scale: 0.8 + Math.random() * 0.5 });

            m.position.set(x, y, z);
            m.rotation.y = Math.random() * Math.PI * 2;
            m.rotation.z = (Math.random() - 0.5) * 0.2;

            safeAddFoliage(m, true, isGiant ? 2.0 : 0.5, weatherSystem);

            if (isGiant) {
                const underCount = 3 + Math.floor(Math.random() * 3);
                for (let k = 0; k < underCount; k++) {
                    const gx = x + (Math.random() - 0.5) * 4;
                    const gz = z + (Math.random() - 0.5) * 4;
                    const gy = getGroundHeight(gx, gz);
                    const gf = createGlowingFlower({ intensity: 2.0, color: 0x00FFFF });
                    gf.position.set(gx, gy, gz);
                    safeAddFoliage(gf, false, 1.0, weatherSystem);
                }
            }
        }
    }

    // 2. Glowing Flower Field
    else if (type === 'flower_field') {
        const count = 30 + Math.random() * 10;
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 35;
            const z = cz + (Math.random() - 0.5) * 35;
            const y = getGroundHeight(x, z);

            if (Math.random() > 0.5) {
                addGrassInstance(x, y, z);
            }

            if (Math.random() > 0.3) {
                const isGlowing = Math.random() < 0.3;
                const f = isGlowing ? createGlowingFlower() : createFlower({ shape: 'layered' });
                f.position.set(x, y, z);
                safeAddFoliage(f, false, 1.0, weatherSystem);
            }
        }
    }

    // 3. Weird Jungle
    else if (type === 'weird_jungle') {
        const count = 12;
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
            safeAddFoliage(plant, true, 1.0, weatherSystem);

            if (Math.random() < 0.3) {
                 const fruit = createFloatingOrb({ size: 0.2, color: 0xFF00FF });
                 fruit.position.set(x + (Math.random()-0.5)*1.5, y + 2 + Math.random(), z + (Math.random()-0.5)*1.5);
                 safeAddFoliage(fruit, false, 1.0, weatherSystem);
            }
        }

        // Add Swingable Vines
        const vineCount = 3;
        for (let i = 0; i < vineCount; i++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z) + 15 + Math.random() * 5;

            const vine = createSwingableVine({ length: 12 + Math.random() * 4 });
            vine.position.set(x, y, z);
            safeAddFoliage(vine, false, 1.0, weatherSystem); // Vines are not obstacles usually

            const swingManager = new VineSwing(vine, vine.userData.vineLength);
            vineSwings.push(swingManager);
        }
    }

    // 4. Crystal Grove
    else if (type === 'crystal_grove') {
        const count = 20;
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            const plant = r < 0.5 ? createPrismRoseBush() : createStarflower();
            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 0.8, weatherSystem);
        }
    }

    // 5. Musical Meadow
    else if (type === 'musical_meadow') {
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
            safeAddFoliage(violet, false, 0.3, weatherSystem);
        }

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
            safeAddFoliage(tulip, false, 0.4, weatherSystem);
        }

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
            safeAddFoliage(geyser, true, 0.5, weatherSystem);
        }

        for (let i = 0; i < 15; i++) {
            const x = cx + (Math.random() - 0.5) * 30;
            const z = cz + (Math.random() - 0.5) * 30;
            const y = getGroundHeight(x, z);
            addGrassInstance(x, y, z);
        }
    }
}

function generateMap(weatherSystem) {
    const SCENE_GRID_SIZE = 40;
    const SCENE_ROWS = 4;
    const SCENE_COLS = 4;
    const SCENE_TYPES = ['mushroom_forest', 'flower_field', 'weird_jungle', 'crystal_grove', 'musical_meadow'];

    for (let r = -SCENE_ROWS / 2; r < SCENE_ROWS / 2; r++) {
        for (let c = -SCENE_COLS / 2; c < SCENE_COLS / 2; c++) {
            const cx = r * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;
            const cz = c * SCENE_GRID_SIZE + (Math.random() - 0.5) * 10;

            const typeIndex = Math.floor(Math.random() * SCENE_TYPES.length);
            spawnCluster(cx, cz, SCENE_TYPES[typeIndex], weatherSystem);

            for (let k = 0; k < 10; k++) {
                const gx = cx + (Math.random() - 0.5) * 40;
                const gz = cz + (Math.random() - 0.5) * 40;
                const gy = getGroundHeight(gx, gz);
                addGrassInstance(gx, gy, gz);
            }
        }
    }

    // Rain Clouds
    const cloudCount = 25;
    for (let i = 0; i < cloudCount; i++) {
        const isTier1 = Math.random() < 0.3;
        const height = isTier1 ? 40 + Math.random() * 15 : 25 + Math.random() * 10;

        const cloud = createRainingCloud({
            rainIntensity: isTier1 ? 50 : 20,
            size: isTier1 ? 2.0 : 1.2
        });

        cloud.position.set((Math.random() - 0.5) * 200, height, (Math.random() - 0.5) * 200);

        if (isTier1) {
            cloud.userData.isWalkable = true;
            cloud.userData.tier = 1;
            cloud.scale.multiplyScalar(1.5);
        } else {
            cloud.userData.tier = 2;
        }

        // Add cloud directly to groups (clouds are handled specially in physics)
        foliageGroup.add(cloud);
        animatedFoliage.push(cloud);
        foliageClouds.push(cloud);
    }
}

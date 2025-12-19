// src/world/generation.js

import * as THREE from 'three';
import { getGroundHeight } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createWaterfall, createMelodyLake, createFireflies, initFallingBerries,
    initGrassSystem, addGrassInstance
} from '../foliage/index.js';
import { CONFIG } from '../core/config.js';
import {
    animatedFoliage, obstacles, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, vineSwings
} from './state.js';
import mapData from '../../assets/map.json';

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

    // Ground - SHRUNK from 2000 to 400 for tighter feel
    const groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
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

    // 2. OVERRIDE FOG for Compact World
    // 0.002 was for 2000u world. 0.012 is for 400u world.
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xFFC5D3);
    scene.fog = new THREE.FogExp2(fogColor, 0.012);
    scene.background = fogColor;

    // Initialize Vegetation Systems
    // High count (20k) on small map = Very Lush Grass
    initGrassSystem(scene, 20000);
    scene.add(createFireflies(150, 100));

    // Melody Lake
    const melodyLake = createMelodyLake(80, 80);
    melodyLake.position.set(0, 2.5, 0);
    scene.add(melodyLake);

    // Falling Berries
    initFallingBerries(scene);

    // Generate Content
    generateMap(weatherSystem);

    return { sky, moon, ground };
}

export function safeAddFoliage(obj, isObstacle = false, radius = 1.0, weatherSystem = null) {
    if (animatedFoliage.length > 1000) return; // Reduced limit to prevent WASM/JS hang
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

// --- MAP GENERATION ---

function generateMap(weatherSystem) {
    console.log(`[World] Loading map with ${mapData.length} entities...`);

    mapData.forEach(item => {
        const [x, yInput, z] = item.position;
        // Recalculate Y based on ground height for most objects to ensure they sit on terrain
        const groundY = getGroundHeight(x, z);

        // Use provided Y if it's significantly different (e.g. cloud), otherwise snap to ground
        let y = groundY;
        if (item.type === 'cloud') {
            y = yInput; // Clouds float
        }

        try {
            if (item.type === 'mushroom') {
                const isGiant = item.variant === 'giant';
                const scale = item.scale || 1.0;
                const m = createMushroom({ size: isGiant ? 'giant' : 'regular', scale });
                m.position.set(x, y, z);
                // Rotate randomly for variety
                m.rotation.y = Math.random() * Math.PI * 2;
                safeAddFoliage(m, true, isGiant ? 2 : 0.5, weatherSystem);
            }
            else if (item.type === 'flower') {
                const isGlowing = item.variant === 'glowing';
                const f = isGlowing ? createGlowingFlower() : createFlower();
                f.position.set(x, y, z);
                f.scale.setScalar(item.scale || 1.0);
                f.rotation.y = Math.random() * Math.PI * 2;
                safeAddFoliage(f, false, 0.5, weatherSystem);
            }
            else if (item.type === 'cloud') {
                const cloud = createRainingCloud({ size: item.size || 1.5 });
                cloud.position.set(x, y, z);
                safeAddFoliage(cloud);
            }
            else if (item.type === 'grass') {
                // Grass system handles its own instances, no need to add to foliageGroup
                addGrassInstance(x, y, z);
            }
        } catch (e) {
            console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
        }
    });
}

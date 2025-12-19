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
    if (animatedFoliage.length > 3000) return; // Bumped limit slightly
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
    const SPREAD = 30; // Radius of cluster
    let count = 0;
    
    // mushroom forest
    if (type === 'mushroom_forest') {
        count = 12;
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random()-0.5)*SPREAD;
            const z = cz + (Math.random()-0.5)*SPREAD;
            const y = getGroundHeight(x, z);
            const isGiant = Math.random() < 0.25; // 25% Giant
            
            const m = createMushroom({ size: isGiant ? 'giant' : 'regular', scale: 0.8+Math.random() });
            m.position.set(x, y, z);
            safeAddFoliage(m, true, isGiant?2:0.5, weatherSystem);
        }
    } 

    // flower field
    else if (type === 'flower_field') {
        count = 25;
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random()-0.5)*SPREAD;
            const z = cz + (Math.random()-0.5)*SPREAD;
            const f = Math.random()>0.3 ? createGlowingFlower() : createFlower();
            f.position.set(x, getGroundHeight(x,z), z);
            safeAddFoliage(f, false, 0.5, weatherSystem);
        }
    }
    // other types currently no-op; generateMap focuses on the two above
}

function generateMap(weatherSystem) {
    // TIGHT GRID: Overlap ensures no gaps
    const GRID = 25; 
    const ROWS = 10; // Covers 250 units (matches fog)
    const COLS = 10;
    
    const TYPES = ['mushroom_forest', 'flower_field']; // Focus on these for now to test density

    for (let r = -ROWS/2; r < ROWS/2; r++) {
        for (let c = -COLS/2; c < COLS/2; c++) {
            const cx = r * GRID + (Math.random()-0.5)*10;
            const cz = c * GRID + (Math.random()-0.5)*10;
            
            // 1. Spawn Main Objects
            const type = TYPES[Math.floor(Math.random()*TYPES.length)];
            spawnCluster(cx, cz, type, weatherSystem);

            // 2. FILLER GRASS (The Glue)
            // Fills the area between objects so it's not "Just Patches"
            for(let k=0; k<25; k++) {
                const gx = cx + (Math.random()-0.5)*GRID;
                const gz = cz + (Math.random()-0.5)*GRID;
                addGrassInstance(gx, getGroundHeight(gx, gz), gz);
            }
        }
    }

    // Clouds
    for (let i = 0; i < 30; i++) {
        const cloud = createRainingCloud({ size: 1.5 });
        cloud.position.set((Math.random()-0.5)*300, 40 + Math.random()*20, (Math.random()-0.5)*300);
        safeAddFoliage(cloud);
    }
}

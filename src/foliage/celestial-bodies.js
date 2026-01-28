// src/foliage/celestial-bodies.js

import * as THREE from 'three';
import { attachReactivity } from './common.ts';

// Helper to place objects on a distant sky sphere
function getRandomSkyPosition(radius) {
    const phi = Math.acos((Math.random() * 2) - 1); // 0 to PI
    const theta = Math.random() * Math.PI * 2;       // 0 to 2PI

    // Convert spherical to cartesian
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = Math.abs(radius * Math.cos(phi)); // Ensure mostly upper hemisphere (positive Y)
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, Math.max(100, y), z);
}

// --- 1. THE PULSAR (High Freq / Sky Reactivity) ---
function createPulsar() {
    const group = new THREE.Group();

    // Core Star
    const geo = new THREE.SphereGeometry(4, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xAAFFFF });
    const core = new THREE.Mesh(geo, mat);
    group.add(core);

    // Glow Halo (Billboard Sprite logic or simple transparent sphere)
    const glowGeo = new THREE.SphereGeometry(8, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00FFFF,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    // Reactivity Config
    group.userData.type = 'pulsar';
    group.userData.reactivityType = 'sky'; // Reacts to Drums
    // Pulsars are visible even in day, but best at night
    group.userData.minLight = 0.0;
    group.userData.maxLight = 1.0;

    return attachReactivity(group);
}

// --- 2. THE BASS PLANET (Low Freq / Flora Reactivity) ---
function createBassPlanet() {
    const group = new THREE.Group();

    // Planet Body
    const planetGeo = new THREE.IcosahedronGeometry(15, 2);
    const planetMat = new THREE.MeshStandardMaterial({
        color: 0xFF4444,
        flatShading: true,
        roughness: 0.8
    });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    group.add(planet);

    // Rings
    const ringGeo = new THREE.RingGeometry(20, 35, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xFFAA88,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.5; // Tilt the ring
    group.add(ring);

    // Reactivity Config
    group.userData.type = 'planet';
    group.userData.reactivityType = 'flora';
    group.userData.reactivityId = 0; // Lock to Kick/Bass channel

    return attachReactivity(group);
}

// --- 3. THE SPIRAL GALAXY (Melody Reactivity) ---
function createGalaxy() {
    const particles = 1000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particles * 3);
    const colors = new Float32Array(particles * 3);
    const sizes = new Float32Array(particles);

    const colorInside = new THREE.Color(0xff6030);
    const colorOutside = new THREE.Color(0x1b3984);

    for (let i = 0; i < particles; i++) {
        // Logarithmic Spiral Math
        const radius = Math.random() * 40;
        const spinAngle = radius * 0.5; // Tighter spiral near center
        const branchAngle = (i % 3) * ((Math.PI * 2) / 3); // 3 Arms

        const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1);
        const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1);
        const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1);

        const x = Math.cos(spinAngle + branchAngle) * radius + randomX;
        const y = Math.random() * 2 + randomY; // Flattened disk
        const z = Math.sin(spinAngle + branchAngle) * radius + randomZ;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Color Mix
        const mixedColor = colorInside.clone();
        mixedColor.lerp(colorOutside, radius / 40);

        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;

        sizes[i] = Math.random() * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // TSL Compatibility: Add dummy normals
    const normals = new Float32Array(particles * 3);
    for(let i=0; i<particles*3; i+=3) { normals[i] = 0; normals[i+1] = 1; normals[i+2] = 0; }
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1)); // For shader if used, or size attenuation

    const mat = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true
    });

    const galaxy = new THREE.Points(geo, mat);

    // Reactivity Config
    galaxy.userData.type = 'galaxy';
    galaxy.userData.reactivityType = 'flora'; // Melody channels
    galaxy.userData.baseRotationSpeed = 0.0005;

    return attachReactivity(galaxy);
}

export function initCelestialBodies(scene) {
    const bodies = [];

    // Create 1 Galaxy
    const galaxy = createGalaxy();
    galaxy.position.copy(getRandomSkyPosition(900));
    galaxy.lookAt(0, 0, 0); // Face the world
    scene.add(galaxy);
    bodies.push(galaxy);

    // Create 2 Pulsars
    for (let i = 0; i < 2; i++) {
        const pulsar = createPulsar();
        pulsar.position.copy(getRandomSkyPosition(950));
        scene.add(pulsar);
        bodies.push(pulsar);
    }

    // Create 1 Bass Planet
    const planet = createBassPlanet();
    planet.position.copy(getRandomSkyPosition(800));
    scene.add(planet);
    bodies.push(planet);

    return bodies;
}

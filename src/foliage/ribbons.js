
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, Fn, uniform, mix,
    positionLocal, normalWorld,
    cameraPosition, sin, abs, smoothstep, uv,
    mx_noise_float
} from 'three/tsl';
import { createUnifiedMaterial } from './common.js';

/**
 * Melody Ribbon System
 *
 * Creates a dynamic trail that follows a virtual "head" position.
 * The Y position of the head is driven by the pitch of the melody channel.
 * The geometry is updated every frame in JavaScript to create the ribbon path,
 * while TSL handles the material appearance (fading, glowing, sparkling).
 */

const MAX_SEGMENTS = 200; // Number of segments in the ribbon
const SEGMENT_WIDTH = 0.8;
const RIBBON_SPEED = 0.2; // Forward speed in world units per frame
const MIN_PITCH_HEIGHT = 2.0;
const MAX_PITCH_HEIGHT = 15.0;
const SEGMENT_LENGTH = 1.0; // Distance between segments updates if we were distance-based

// Global Uniforms for the ribbon material
const uRibbonTime = uniform(0.0);
const uRibbonColor = uniform(vec3(0.0, 1.0, 1.0)); // Default cyan

export function createMelodyRibbon(scene) {
    const group = new THREE.Group();
    group.name = 'MelodyRibbonSystem';

    // 1. Create BufferGeometry
    // We use a Triangle Strip-like structure but built with indexed triangles for better control
    const vertexCount = (MAX_SEGMENTS + 1) * 2;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = [];

    // Initialize flat strip along Z
    for (let i = 0; i <= MAX_SEGMENTS; i++) {
        // Left point
        positions[i * 6 + 0] = -SEGMENT_WIDTH / 2;
        positions[i * 6 + 1] = 0;
        positions[i * 6 + 2] = i * SEGMENT_LENGTH;

        uvs[i * 4 + 0] = 0;
        uvs[i * 4 + 1] = i / MAX_SEGMENTS;

        // Right point
        positions[i * 6 + 3] = SEGMENT_WIDTH / 2;
        positions[i * 6 + 4] = 0;
        positions[i * 6 + 5] = i * SEGMENT_LENGTH;

        uvs[i * 4 + 2] = 1;
        uvs[i * 4 + 3] = i / MAX_SEGMENTS;

        if (i < MAX_SEGMENTS) {
            const base = i * 2;
            // Triangle 1
            indices.push(base, base + 1, base + 2);
            // Triangle 2
            indices.push(base + 1, base + 3, base + 2);
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertexCount * 3).fill(0), 3)); // Dummy normals for TSL
    geometry.setIndex(indices);

    // 2. Create TSL Material
    const material = createUnifiedMaterial(0x00FFFF, {
        roughness: 0.2,
        metalness: 0.1,
        transmission: 0.5,
        thickness: 0.1,
        ior: 1.2,
        side: THREE.DoubleSide
    });

    // Custom TSL logic for the ribbon
    const vUv = uv();

    // Sparkle effect
    const sparkleNoise = mx_noise_float(positionLocal.mul(10.0).add(uRibbonTime));
    const sparkle = smoothstep(0.8, 1.0, sparkleNoise);

    // Gradient Color: mix between Color1 (Low Pitch) and Color2 (High Pitch)?
    // For now, simple glowing cyan/pink gradient
    const gradientColor = mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 0.2, 0.8), sin(vUv.y.mul(10.0).add(uRibbonTime)).mul(0.5).add(0.5));

    // Opacity: Fade at the tail (UV.y near 0)
    const fade = smoothstep(0.0, 0.2, vUv.y);

    material.colorNode = gradientColor;
    material.emissiveNode = gradientColor.mul(sparkle.mul(2.0).add(0.5)); // Base glow + sparkle
    material.opacityNode = fade;
    material.transparent = true;

    // Create Mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // Always render, it moves a lot
    group.add(mesh);

    // Initial State
    const pathHistory = [];
    for (let i = 0; i <= MAX_SEGMENTS; i++) {
        pathHistory.push({ x: 0, y: -100, z: 0, width: 0 }); // Start hidden
    }

    // Attach state to group userdata
    group.userData = {
        mesh,
        pathHistory,
        headPosition: new THREE.Vector3(0, 5, 0), // Start somewhere visible
        headDirection: new THREE.Vector3(0, 0, 1),
        currentPitchHeight: 5.0,
        targetPitchHeight: 5.0,
        isActive: false
    };

    scene.add(group);
    return group;
}

export function updateMelodyRibbons(group, deltaTime, audioData) {
    if (!group || !group.userData.mesh) return;

    const { mesh, pathHistory, headPosition, headDirection } = group.userData;

    // Update Uniforms
    uRibbonTime.value += deltaTime;

    // 1. Get Audio Data (Melody Channel - usually Channel 2)
    // FIX: Access channelData safely
    let volume = 0;
    let note = 0;

    if (audioData && audioData.channelData) {
        // Use Channel 2 (Melody) or fallback to active channels
        const ch = audioData.channelData[2];
        if (ch) {
            volume = ch.trigger || 0; // 'trigger' is the volume/intensity value
            note = ch.note || 0;
        }
    }

    const hasNote = volume > 0.05;

    // 2. Update Head Logic

    // Move forward (Circle path)
    const time = uRibbonTime.value;
    const radius = 30.0;
    const speed = 0.5;

    const targetX = Math.sin(time * speed) * radius;
    const targetZ = Math.cos(time * speed) * radius;

    // Smoothly interpolate X/Z
    headPosition.x += (targetX - headPosition.x) * deltaTime * 2.0;
    headPosition.z += (targetZ - headPosition.z) * deltaTime * 2.0;

    // Calculate Pitch Height
    if (hasNote) {
        // Map MIDI note (e.g. 48 to 84) to height
        // Standard range approx C3 to C6
        const n = note;
        const normalizedPitch = (n % 24) / 24.0; // simple modulation
        group.userData.targetPitchHeight = MIN_PITCH_HEIGHT + normalizedPitch * (MAX_PITCH_HEIGHT - MIN_PITCH_HEIGHT);
    } else {
        // Return to base height
        group.userData.targetPitchHeight = MIN_PITCH_HEIGHT + (MAX_PITCH_HEIGHT - MIN_PITCH_HEIGHT) * 0.5;
    }

    // Lerp height
    headPosition.y += (group.userData.targetPitchHeight - headPosition.y) * deltaTime * 5.0;

    // 3. Update Path History
    // Shift everything down
    pathHistory.shift();
    pathHistory.push({
        x: headPosition.x,
        y: headPosition.y,
        z: headPosition.z,
        width: SEGMENT_WIDTH + volume * 2.0 // Modulate width by volume
    });

    // 4. Update Geometry
    const positions = mesh.geometry.attributes.position.array;

    for (let i = 0; i <= MAX_SEGMENTS; i++) {
        const point = pathHistory[i];

        let dirX = 0, dirZ = 1;
        if (i < MAX_SEGMENTS) {
            const next = pathHistory[i+1];
            const dx = next.x - point.x;
            const dz = next.z - point.z;
            const len = Math.sqrt(dx*dx + dz*dz);
            if (len > 0.001) {
                dirX = dx / len;
                dirZ = dz / len;
            }
        }

        // Perpendicular vector (-dirZ, dirX)
        const perpX = -dirZ;
        const perpZ = dirX;

        const w = point.width / 2;

        // Left Vertex
        positions[i * 6 + 0] = point.x - perpX * w;
        positions[i * 6 + 1] = point.y;
        positions[i * 6 + 2] = point.z - perpZ * w;

        // Right Vertex
        positions[i * 6 + 3] = point.x + perpX * w;
        positions[i * 6 + 4] = point.y;
        positions[i * 6 + 5] = point.z + perpZ * w;
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
}

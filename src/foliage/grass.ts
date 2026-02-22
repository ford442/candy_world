// src/foliage/grass.ts

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { time, positionLocal, positionWorld, sin, vec3, color, normalView, dot, float, max, sign, smoothstep, normalize } from 'three/tsl';
import { uWindSpeed, uWindDirection, createClayMaterial, uAudioLow, uAudioHigh, uPlayerPosition } from './common.ts';
import { uSkyDarkness } from './sky.ts';

let grassMeshes: THREE.InstancedMesh[] = [];
const dummy = new THREE.Object3D();
const MAX_PER_MESH = 1000;

export function initGrassSystem(scene: THREE.Scene, count = 5000): THREE.InstancedMesh[] {
    grassMeshes = [];
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);
    // Ensure normals exist for TSL
    geo.computeVertexNormals();

    const mat = new MeshStandardNodeMaterial({
        color: 0x7CFC00,
        roughness: 0.8,
        metalness: 0.0
    });

    // --- PALETTE UPDATE: Dancing Grass ---
    // 1. Wind (Base Layer) - Slow, sweeping waves across the world
    // We use positionWorld to make the wind field continuous across instances
    const windTime = time.mul(uWindSpeed.max(0.5));
    const windFreq = float(0.1); // Scale of wind waves
    const windPhase = positionWorld.x.mul(windFreq).add(positionWorld.z.mul(windFreq)).add(windTime);
    const windSway = sin(windPhase).mul(positionLocal.y).mul(0.3);

    // 2. Dance (Audio Layer) - Fast, twitchy reaction to Hi-Hats/Melody
    const dancePhase = time.mul(15.0).add(positionWorld.x.mul(0.5)).add(positionWorld.z.mul(0.5));
    // "Shiver" effect: High frequency shake, scaled by uAudioHigh
    const danceSway = sin(dancePhase).mul(uAudioHigh).mul(0.15).mul(positionLocal.y);

    // Combine Sway
    const totalSway = windSway.add(danceSway);

    // Apply Direction
    const swayX = totalSway.mul(uWindDirection.x);
    const swayZ = totalSway.mul(uWindDirection.z);

    // 3. Bounce (Kick Drum) - Squash the grass vertically on the beat
    // When uAudioLow is high, scale Y down and X/Z up slightly (volume preservation)
    const squashFactor = uAudioLow.mul(0.2); // Max 20% squash
    const scaleY = float(1.0).sub(squashFactor);
    // Apply squash relative to pivot (y=0)
    const newY = positionLocal.y.mul(scaleY);

    // PALETTE JUICE: Squash & Stretch Volume Preservation
    // When Y squashes (scaleY < 1), X and Z must bulge (scaleXZ > 1)
    // scaleXZ = 1.0 + squashFactor * 0.1 (Simple approximation)
    const scaleXZ = float(1.0).add(squashFactor.mul(0.1));

    // Apply sway AND bulge
    // Bulge scales the local X/Z relative to center (0,0)
    let newX = positionLocal.x.mul(scaleXZ).add(swayX);
    let newZ = positionLocal.z.mul(scaleXZ).add(swayZ);

    // --- PALETTE UPDATE: Player Interaction (Bending) ---
    // Push grass away from uPlayerPosition
    const playerDistVector = positionWorld.sub(uPlayerPosition);
    // We only care about X/Z distance (cylinder interaction)
    const playerDistH = vec3(playerDistVector.x, float(0.0), playerDistVector.z);
    const distSq = dot(playerDistH, playerDistH);

    // Interaction Radius = 2.0
    const interactRadiusSq = float(4.0);

    // Force falls off with distance
    // smoothstep(radiusSq, 0, distSq) -> 1 at center, 0 at edge
    const pushStrength = smoothstep(interactRadiusSq, float(0.0), distSq);

    // Direction to push (away from player)
    const pushDir = normalize(playerDistH);

    // Only affect the top of the grass (positionLocal.y)
    // Bending factor increases with height
    const bendAmount = pushStrength.mul(2.0).mul(positionLocal.y); // Max push 2.0 units at tip

    newX = newX.add(pushDir.x.mul(bendAmount));
    newZ = newZ.add(pushDir.z.mul(bendAmount));

    // Also push Y down slightly to simulate bending over?
    // For simple shear, X/Z is enough, but physically it should lower.
    // Let's keep it simple for now to avoid ground clipping issues.

    mat.positionNode = vec3(newX, newY, newZ);

    // --- Material Colors ---
    // Rim Light Logic
    const viewDir = vec3(0, 0, 1); // Approximation for simple rim
    const NdotV = max(0.0, dot(normalView, viewDir));
    const rimFactor = float(1.0).sub(NdotV).pow(3.0).mul(0.6);

    // Base Colors
    const baseColor = color(0x7CFC00);
    const rimColor = color(0xAAFFAA);

    // 4. Night Glow (Bioluminescence)
    // Grass tips glow Cyan/Green when it's dark AND there is high-freq audio
    // Glow Strength = Darkness * AudioHigh * Height (tips only)
    const tipFactor = positionLocal.y.div(float(height)); // 0 at bottom, 1 at top
    const glowStrength = uSkyDarkness.mul(uAudioHigh).mul(tipFactor).mul(2.0); // Boost intensity
    const glowColor = color(0x00FFAA); // Cyan-Green Magic

    // PALETTE JUICE: Touch Glow (Player Interaction)
    // When player pushes grass, it glows Neon Pink
    const touchGlowColor = color(0xFF00FF);
    const touchGlowStrength = pushStrength.mul(2.0); // Bright flash on touch

    // Mix: Base + Rim + NightGlow
    // We add NightGlow to Emissive for bloom, or just mix it into color
    const mixedColor = baseColor.add(rimColor.mul(rimFactor));

    mat.colorNode = mixedColor;

    // Add Glow to Emissive Node (so it blooms)
    // Combine Audio Glow + Touch Glow
    const totalEmissive = glowColor.mul(glowStrength).add(touchGlowColor.mul(touchGlowStrength));
    mat.emissiveNode = totalEmissive;

    const meshCount = Math.ceil(count / MAX_PER_MESH);

    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.receiveShadow = true;
        scene.add(mesh);
        grassMeshes.push(mesh);
    }

    return grassMeshes;
}

export function addGrassInstance(x: number, y: number, z: number) {
    const mesh = grassMeshes.find(m => m.count < m.instanceMatrix.count);
    if (!mesh) return;

    const index = mesh.count;

    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);

    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

export function createGrass(options: { color?: number | string | THREE.Color, shape?: 'tall' | 'bushy' } = {}) {
    const { color = 0x7CFC00, shape = 'tall' } = options;
    const material = createClayMaterial(color);
    let geo;
    if (shape === 'tall') {
        const height = 0.5 + Math.random();
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
        geo.translate(0, height / 2, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > height * 0.5) {
                const bendFactor = (y - height * 0.5) / (height * 0.5);
                pos.setX(i, pos.getX(i) + bendFactor * 0.1);
            }
        }
    } else if (shape === 'bushy') {
        const height = 0.2 + Math.random() * 0.3;
        geo = new THREE.CylinderGeometry(0.1, 0.05, height, 8);
        geo.translate(0, height / 2, 0);
    } else {
        // Fallback for types
        const height = 0.5;
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
    }

    geo.computeVertexNormals();

    const blade = new THREE.Mesh(geo, material);
    blade.castShadow = true;
    blade.userData.type = 'grass';
    blade.userData.animationType = shape === 'tall' ? 'sway' : 'shiver';
    blade.userData.animationOffset = Math.random() * 10;
    return blade;
}

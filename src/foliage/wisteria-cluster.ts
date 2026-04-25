import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    time, positionLocal, sin, cos, positionWorld, color, vec3, mix, float, smoothstep
} from 'three/tsl';
import { CandyPresets, uAudioHigh, createJuicyRimLight } from './material-core.ts';
import { attachReactivity } from './foliage-reactivity.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { discoverySystem } from '../systems/discovery.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spawnImpact } from './impacts.ts';

export interface WisteriaClusterOptions {
    scale?: number;
    color?: number;
}

/**
 * Creates a cluster of hanging musical vines (Wisteria) that respond to high frequencies.
 */
export function createWisteriaCluster(options: WisteriaClusterOptions = {}) {
    const { scale = 1.0, color: baseHexColor = 0x9B6A9C } = options; // Soft purple clay by default
    const group = new THREE.Group();

    // Aesthetic: "Cute Clay"
    // Use the generic Clay preset and apply audio-reactive TSL deformation.
    const material = CandyPresets.Clay(baseHexColor, {
        roughness: 0.9,
        bumpStrength: 0.1
    });

    // --- TSL Audio-Reactive Sway ---
    // Make it sway organically based on world position and uTime.
    // High frequency audio (uAudioHigh) acts as an impulse/energy multiplier.

    const baseSwayFreq = float(2.0);
    const audioEnergy = uAudioHigh.mul(0.5).add(1.0); // Base 1.0, up to 1.5

    // Offset based on positionWorld so multiple clusters aren't perfectly synced
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3));

    // Calculate sway amount. The top of the vine (y > 0) shouldn't move as much as the bottom (y < 0).
    // Assuming the geometry is created such that it hangs down from y=0.
    // If geometry goes from y=0 to y=-length, then normalizedHeight goes from 0 to 1.
    // Let's use positionLocal.y.
    // Assume cluster is about 4 units long, so positionLocal.y goes from 0 down to -4.
    const normalizedHeight = positionLocal.y.div(-4.0).clamp(0.0, 1.0);

    // X and Z sway
    const swayX = sin(time.mul(baseSwayFreq).add(swayPhase)).mul(0.5).mul(audioEnergy).mul(normalizedHeight);
    const swayZ = cos(time.mul(baseSwayFreq.mul(0.8)).add(swayPhase)).mul(0.5).mul(audioEnergy).mul(normalizedHeight);

    // Apply sway to vertex position
    material.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));

    // Glow Effect based on audio
    const baseColorNode = color(baseHexColor);
    const glowColor = color(0xFF66FF); // Neon pink glow
    // Emissive boost driven by uAudioHigh, fading in smoothly
    material.emissiveNode = glowColor.mul(uAudioHigh.mul(0.8));

    // 🎨 PALETTE: Juicy Rim Light for volumetric glow
    const rimLight = createJuicyRimLight(color(0xFFFFFF), float(1.5), float(3.0), null);
    material.emissiveNode = material.emissiveNode.add(rimLight);

    // --- Geometry Construction ---
    // We create a central hanging stem and several rounded clusters ("grapes" / "petals") hanging off it.

    // We'll build a single merged buffer geometry or just use multiple meshes in a group.
    // For optimization, creating a single geometry is better, but since it's procedural:

    // We build a single merged buffer geometry.
    // For optimization and proper TSL positionLocal scaling, merging is necessary.
    const geometries: THREE.BufferGeometry[] = [];

    const vineGeo = new THREE.CylinderGeometry(0.1, 0.05, 4, 8);
    // Shift geometry so the top is at y=0, bottom is at y=-4
    vineGeo.translate(0, -2, 0);
    geometries.push(vineGeo);

    // Add rounded "clusters" (flowers) along the vine
    const clusterGeoBase = new THREE.SphereGeometry(0.4, 16, 16);

    for (let i = 0; i < 5; i++) {
        const clusterGeo = clusterGeoBase.clone();

        // Position them down the vine
        const yPos = -0.5 - (i * 0.7);
        // Offset slightly in x/z for organic look
        const xOffset = (Math.random() - 0.5) * 0.5;
        const zOffset = (Math.random() - 0.5) * 0.5;

        // Vary size
        const s = 1.0 - (i * 0.1); // smaller towards the bottom

        clusterGeo.scale(s, s, s);
        clusterGeo.translate(xOffset, yPos, zOffset);

        geometries.push(clusterGeo);
    }

    const mergedGeo = mergeGeometries(geometries);

    const mainMesh = new THREE.Mesh(mergedGeo, material);
    group.add(mainMesh);

    // Add an invisible hitbox for interaction since the visual mesh hangs down
    const hitGeo = new THREE.CylinderGeometry(1.0, 1.0, 4);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = -2;
    group.add(hitMesh);

    group.scale.setScalar(scale);

    group.userData.type = 'wisteria_cluster';
    group.userData.interactionText = "Commune";

    // Interaction
    group.userData.onInteract = () => {
        // Just trigger a discovery if not already discovered, and visual feedback
        discoverySystem.discover('wisteria_cluster', 'Wisteria Cluster', '🍇');

        // Visual feedback (Particles)
        spawnImpact(group.position, 'spore', baseHexColor);

        // Audio variation
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('impact', { position: group.position, pitch: Math.random() * 0.2 + 0.9 });
        }

        // Visual pop
        group.scale.setScalar(scale * 1.2);
        setTimeout(() => {
            group.scale.setScalar(scale);
        }, 150);
    };

    const interactive = makeInteractive(group);

    // Ensure reactivity flag is attached
    return attachReactivity(interactive);
}

// src/foliage/mirrors.ts

import * as THREE from 'three';
import {
    float, vec3, vec2, color, positionWorld, normalWorld, cameraPosition, normalize,
    reflect, sin, abs, dot,
    texture, uniform
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attachReactivity, createRimLight, getDreamEnvTexture, uAudioHigh, uTime } from './index.ts';

// The "Dream Reflection" sky. Generated once in material-core and shared with
// every preset that opts into `useDreamEnv`, so the mirrors and the candy
// highlights are demonstrably the same sky. See material-core/env-map.ts.

export interface MirrorOptions {
    scale?: number;
    shards?: number;
}

/**
 * Creates a "Melody Mirror" - A floating shard that reflects a dream world.
 * The reflection distorts based on audio pitch (Channel 2 Note).
 *
 * @param {MirrorOptions} options
 * @param {number} options.scale - Size of the mirror
 * @param {number} options.shards - Number of shards in the cluster (1 = single mirror)
 */
export function createMelodyMirror(options: MirrorOptions = {}): THREE.Group {
    const scale = options.scale || 1.0;
    const shardCount = options.shards || 3;

    const group = new THREE.Group();
    group.userData.type = 'melody_mirror';

    // Shared material for all shards
    // We use a custom TSL material to simulate the reflection

    const envMap = getDreamEnvTexture();

    // Create the material
    const material = new MeshStandardNodeMaterial();
    material.roughnessNode = float(0.1);
    material.metalnessNode = float(1.0);

    // --- TSL Reflection Logic ---

    // 1. Calculate View Vector and Reflection Vector
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const N = normalWorld;

    // Base Reflection Vector
    const R = reflect(viewDir.negate(), N);

    // 2. Audio Distortion
    // We want the mirror surface to ripple based on melody
    // Channel 2 Note determines the ripple frequency/pattern
    // Volume (trigger) determines intensity

    // Use uAudioHigh as a proxy for melody activity if specific channel data isn't easily bound globally without per-object uniforms
    // ideally we'd pass specific channel data, but for now we use global uniforms + time

    // Distort R based on noise and audio
    // We simulate a ripple by adding a perturbation to the reflection vector lookup

    // "Melody" warp:
    // Create a time-varying signal
    const warpTime = uTime.mul(2.0);
    const warpSignal = sin(positionWorld.y.mul(5.0).add(warpTime));

    // Intensity driven by audio
    const warpIntensity = uAudioHigh.mul(0.2).add(0.05); // Base warping + audio kick

    // Apply distortion to the UV lookup for the environment map
    // Map spherical coordinates (approx) to UV
    // Simple planar mapping for the fake environment:
    const uvReflect = vec2(
        R.x.mul(0.5).add(0.5),
        R.y.mul(0.5).add(0.5)
    );

    // Add distortion
    const distortedUV = uvReflect.add(vec2(warpSignal, warpSignal).mul(warpIntensity));

    // Sample the environment map
    // We use a texture node with explicit UVs
    const reflectionColor = texture(envMap, distortedUV).rgb;

    // 3. Fresnel / Rim (Using Helper)
    // Create a blue-ish rim light
    const rimColor = color(0xCCDDFF);
    const rimEffect = createRimLight(rimColor, float(2.0), float(3.0), N);

    // 4. Combine
    // Base color is dark (mirror), emission carries the reflection + rim
    material.colorNode = color(0x111111);
    material.emissiveNode = reflectionColor.add(rimEffect);

    // 5. Geometry
    // We create jagged "Shard" geometries
    const shardGeo = new THREE.CylinderGeometry(0, 1, 3, 4, 1); // Pyramid/Diamond like
    shardGeo.translate(0, 0, 0);

    // Create Shards
    for (let i = 0; i < shardCount; i++) {
        const mesh = new THREE.Mesh(shardGeo, material);

        // Randomize shard shape/pos
        const s = scale * (0.5 + Math.random() * 0.5);
        mesh.scale.set(s, s * (1.5 + Math.random()), s * 0.2); // Flat shards

        // Position in cluster
        mesh.position.set(
            (Math.random() - 0.5) * scale,
            (Math.random() - 0.5) * scale,
            (Math.random() - 0.5) * scale
        );

        // Random rotation
        mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        // Add animation data
        mesh.userData.rotSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
        );

        group.add(mesh);
    }

    // Make reactive
    // We attach reactivity so it can optionally change color or size,
    // though the material handles the main effect.
    attachReactivity(group, { type: 'sky', lightPreference: { min: 0.0, max: 1.0 } });

    // Custom update method for rotation
    group.userData.onUpdate = (delta: number, audioData: any) => {
        // Slowly rotate shards
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            child.rotation.x += child.userData.rotSpeed.x * delta;
            child.rotation.y += child.userData.rotSpeed.y * delta;
            child.rotation.z += child.userData.rotSpeed.z * delta;
        }

        // Bobbing
        group.position.y += Math.sin(uTime.value + group.id) * 0.005;
    };

    return group;
}

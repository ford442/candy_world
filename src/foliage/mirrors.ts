// src/foliage/mirrors.ts

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    float, vec3, vec2, color, positionWorld, normalWorld, cameraPosition, normalize,
    reflect, sin, abs, dot,
    texture, uniform
} from 'three/tsl';
// @ts-ignore: common.ts is not yet migrated
import { attachReactivity, createRimLight, uAudioHigh, uTime } from './common.ts';

// Global texture for the "Dream Reflection"
// Since we don't have a real cubemap, we generate a static noise/gradient texture
let _dreamEnvTexture: THREE.DataTexture | null = null;

function getDreamEnvTexture(): THREE.DataTexture {
    if (_dreamEnvTexture) return _dreamEnvTexture;

    const size = 512;
    const data = new Uint8Array(size * size * 4);

    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const idx = (i * size + j) * 4;

            // Normalized coords
            const u = j / size;
            const v = i / size;

            // Sky gradient (top is blue/purple, bottom is pink/orange)
            const skyColor = new THREE.Color().setHSL(0.6 + u * 0.1, 0.8, 0.2 + v * 0.6);

            // Add some "cloud" noise
            const noise = Math.sin(u * 20.0 + v * 15.0) * 0.5 + 0.5;
            const cloudColor = new THREE.Color(0xFFFFFF);

            skyColor.lerp(cloudColor, noise * 0.3 * (1.0 - v)); // More clouds at bottom

            data[idx] = Math.floor(skyColor.r * 255);
            data[idx + 1] = Math.floor(skyColor.g * 255);
            data[idx + 2] = Math.floor(skyColor.b * 255);
            data[idx + 3] = 255;
        }
    }

    _dreamEnvTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    _dreamEnvTexture.wrapS = THREE.RepeatWrapping;
    _dreamEnvTexture.wrapT = THREE.RepeatWrapping;
    _dreamEnvTexture.minFilter = THREE.LinearFilter;
    _dreamEnvTexture.magFilter = THREE.LinearFilter;
    _dreamEnvTexture.needsUpdate = true;

    return _dreamEnvTexture;
}

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
        group.children.forEach(child => {
            child.rotation.x += child.userData.rotSpeed.x * delta;
            child.rotation.y += child.userData.rotSpeed.y * delta;
            child.rotation.z += child.userData.rotSpeed.z * delta;
        });

        // Bobbing
        group.position.y += Math.sin(uTime.value + group.id) * 0.005;
    };

    return group;
}

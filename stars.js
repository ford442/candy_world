import * as THREE from 'three';
import { color, float, vec3, time, positionLocal, attribute, uniform, mix, length, sin, cos } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

// Global uniform for star pulse (driven by music)
// We export this so we can update it in main.js
export const uStarPulse = uniform(0.0); // 0 to 1
export const uStarColor = uniform(color(0xFFFFFF)); // Current pulse color

export function createStars(count = 3000) { // Increased count for more detail
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3); // Individual star colors
    const brightness = new Float32Array(count); // Star brightness variation

    const radius = 400; // Sky dome radius (smaller than sky mesh)

    for (let i = 0; i < count; i++) {
        // Random point on sphere
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        const r = radius * (0.9 + Math.random() * 0.2); // slight depth variance
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = Math.abs(y); // Keep above horizon mostly
        positions[i * 3 + 2] = z;

        // Varied star sizes (some brighter/larger)
        const starType = Math.random();
        if (starType > 0.95) {
            sizes[i] = Math.random() * 2.5 + 2.0; // Large bright stars
            brightness[i] = 1.5 + Math.random() * 0.5;
        } else if (starType > 0.8) {
            sizes[i] = Math.random() * 1.5 + 1.0; // Medium stars
            brightness[i] = 1.0 + Math.random() * 0.3;
        } else {
            sizes[i] = Math.random() * 0.8 + 0.3; // Small stars
            brightness[i] = 0.5 + Math.random() * 0.5;
        }

        offsets[i] = Math.random() * 100;

        // Star colors (white, blue-white, yellow-white)
        const colorType = Math.random();
        if (colorType > 0.7) {
            // Blue-white (hot stars)
            colors[i * 3] = 0.8 + Math.random() * 0.2;
            colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
            colors[i * 3 + 2] = 1.0;
        } else if (colorType > 0.3) {
            // Pure white
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 1.0;
            colors[i * 3 + 2] = 1.0;
        } else {
            // Yellow-white (warm stars)
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
            colors[i * 3 + 2] = 0.7 + Math.random() * 0.2;
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('brightness', new THREE.BufferAttribute(brightness, 1));

    const mat = new PointsNodeMaterial({
        size: 1.0, // base size
        transparent: true,
        opacity: 0.0, // Hidden by default (Day)
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // TSL Logic
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aStarColor = attribute('starColor', 'vec3');
    const aBrightness = attribute('brightness', 'float');

    // Enhanced twinkle effect (random sine based on time and offset)
    const twinkle = time.add(aOffset).sin().mul(0.5).add(0.5); // 0..1
    const fastTwinkle = time.mul(3.0).add(aOffset.mul(0.5)).sin().mul(0.2).add(0.8); // Faster variation

    // Music Pulse effect: uStarPulse (0..1) adds intensity
    const intensity = twinkle.mul(fastTwinkle).mul(aBrightness).add(uStarPulse);

    // Color: Mix individual star color with pulse color
    const baseStarColor = vec3(aStarColor.x, aStarColor.y, aStarColor.z);
    const pulseInfluence = uStarPulse.mul(0.6);
    const finalColor = mix(baseStarColor, uStarColor.xyz, pulseInfluence);

    mat.colorNode = vec3(finalColor.x, finalColor.y, finalColor.z);
    // Size attenuation manually or using built-in?
    // PointsNodeMaterial handles size if we set sizeNode
    mat.sizeNode = aSize.mul(intensity.max(0.2)); // Minimum size 0.2

    // --- TSL Star Warp (Idea 2) ---
    // 1. Warp Effect: Push stars outward based on pulse
    const pos = positionLocal;
    const warpFactor = uStarPulse.mul(50.0); // Push out by 50 units on beat
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    // 2. Rotation Effect: Rotate around Y axis based on time
    // We can drive this speed via a uniform updated by audioState.bpm if needed, or just time
    const angle = time.mul(0.1);
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    // Position
    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}

import * as THREE from 'three';
import { color, float, vec3, vec4, time, positionLocal, attribute, uniform, mix, length, sin, cos } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

// Global uniform for star pulse (driven by music)
// We export this so we can update it in main.js
export const uStarPulse = uniform(0.0); // 0 to 1
export const uStarColor = uniform(color(0xFFFFFF)); // Current pulse color
export const uStarOpacity = uniform(0.0); // Controls visibility (Day/Night)

export function createStars(count = 1500) { // Increased from 1000 for better night sky
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3); // NEW: Individual star colors

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

        // Vary star sizes more dramatically
        sizes[i] = Math.random() * 2.5 + 0.3;
        offsets[i] = Math.random() * 100;
        
        // NEW: Assign star colors (mostly white, some blue-white, some yellow-orange)
        const colorType = Math.random();
        if (colorType < 0.7) {
            // White stars (70% - range 0.0 to 0.7)
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 1.0;
            colors[i * 3 + 2] = 1.0;
        } else if (colorType < 0.85) {
            // Blue-white stars (15% - range 0.7 to 0.85)
            colors[i * 3] = 0.8;
            colors[i * 3 + 1] = 0.9;
            colors[i * 3 + 2] = 1.0;
        } else {
            // Yellow-orange stars (15% - range 0.85 to 1.0)
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.9;
            colors[i * 3 + 2] = 0.7;
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3)); // NEW

    const mat = new PointsNodeMaterial({
        size: 1.5, // Increased base size for better visibility
        transparent: true,
        opacity: 0.0, // Hidden by default (Day)
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false // CRITICAL FIX: Stars are far away, so we must ignore scene fog
    });

    // TSL Logic
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aStarColor = attribute('starColor', 'vec3'); // NEW

    // Enhanced twinkle effect with multiple frequencies for more natural variation
    const twinkle1 = time.add(aOffset).sin().mul(0.3).add(0.5); // Base twinkle
    const twinkle2 = time.mul(2.3).add(aOffset.mul(0.7)).sin().mul(0.2).add(0.5); // Faster variation
    const twinkle = twinkle1.mul(twinkle2); // Combined effect

    // Music Pulse effect: uStarPulse (0..1) adds intensity
    const intensity = twinkle.add(uStarPulse.mul(0.5));

    // Color: Mix star's natural color with music color based on pulse
    const baseStarColor = vec3(aStarColor.x, aStarColor.y, aStarColor.z);
    const musicColorVec3 = vec3(uStarColor.r, uStarColor.g, uStarColor.b);
    const finalRGB = mix(baseStarColor, musicColorVec3, uStarPulse.mul(0.6));

    // Combine RGB with the Opacity Uniform into a vec4
    mat.colorNode = vec4(finalRGB, uStarOpacity).mul(mat.color);

    // Size attenuation with enhanced brightness for better visibility
    mat.sizeNode = aSize.mul(intensity.max(0.3)); // Increased minimum size from 0.2 to 0.3

    // --- TSL Star Warp (Idea 2) ---
    // 1. Warp Effect: Push stars outward based on pulse
    const pos = positionLocal;
    const warpFactor = uStarPulse.mul(30.0); // Reduced from 50 for subtler effect
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    // 2. Rotation Effect: Rotate around Y axis based on time (very slow)
    const angle = time.mul(0.05); // Reduced from 0.1 for slower, more majestic rotation
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    // Position
    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}

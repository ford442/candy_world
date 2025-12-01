import * as THREE from 'three';
import { color, float, vec3, time, positionLocal, attribute, uniform, mix } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

// Global uniform for star pulse (driven by music)
// We export this so we can update it in main.js
export const uStarPulse = uniform(0.0); // 0 to 1
export const uStarColor = uniform(color(0xFFFFFF)); // Current pulse color

export function createStars(count = 2000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);

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
        positions[i * 3 + 1] = Math.abs(y); // Keep above horizon mostly? Or full sphere?
        // Let's do full sphere but mask in shader if needed.
        // Actually for sky, full sphere is fine, but ground covers bottom.
        positions[i * 3 + 2] = z;

        sizes[i] = Math.random() * 1.5 + 0.5;
        offsets[i] = Math.random() * 100;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

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

    // Twinkle effect (random sine based on time and offset)
    const twinkle = time.add(aOffset).sin().mul(0.5).add(0.5); // 0..1

    // Music Pulse effect: uStarPulse (0..1) adds intensity
    const intensity = twinkle.add(uStarPulse);

    // Color: Mix white with uStarColor based on pulse
    const finalColor = mix(color(0xFFFFFF), uStarColor, uStarPulse.mul(0.8));

    mat.colorNode = finalColor;
    // Size attenuation manually or using built-in?
    // PointsNodeMaterial handles size if we set sizeNode
    mat.sizeNode = aSize.mul(intensity.max(0.2)); // Minimum size 0.2

    // Position
    mat.positionNode = positionLocal;

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}

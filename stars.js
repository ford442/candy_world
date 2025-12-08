import * as THREE from 'three';
import { color, float, vec3, vec4, time, positionLocal, attribute, uniform, mix, length, sin, cos } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

// Global uniform for star pulse (driven by music)
export const uStarPulse = uniform(0.0); // 0 to 1
export const uStarColor = uniform(color(0xFFFFFF)); // Current pulse color
export const uStarOpacity = uniform(0.0); // <--- NEW: Opacity control

export function createStars(count = 2000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);

    const radius = 400;

    for (let i = 0; i < count; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        const r = radius * (0.9 + Math.random() * 0.2);
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = Math.abs(y); // Keep mostly above horizon? Or full sphere? Logic says abs(y) keeps it dome-like if y is up.
        positions[i * 3 + 2] = z;

        sizes[i] = Math.random() * 1.5 + 0.5;
        offsets[i] = Math.random() * 100;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

    const mat = new PointsNodeMaterial({
        size: 1.0,
        transparent: true,
        opacity: 1.0, // Set base to 1, we control via node now
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
    });

    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');

    // Twinkle effect
    const twinkle = time.add(aOffset).sin().mul(0.5).add(0.5);
    const intensity = twinkle.add(uStarPulse);

    // Color mixing
    const finalRGB = mix(color(0xFFFFFF), uStarColor, uStarPulse.mul(0.8));

    // --- FIX: Combine RGB with the Opacity Uniform into a vec4 ---
    mat.colorNode = vec4(finalRGB, uStarOpacity).mul(mat.color);

    mat.sizeNode = aSize.mul(intensity.max(0.2));

    // Star Warp / Rotation Logic
    const pos = positionLocal;
    const warpFactor = uStarPulse.mul(50.0);
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    const angle = time.mul(0.1);
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}

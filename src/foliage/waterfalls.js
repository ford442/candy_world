import * as THREE from 'three';
import { color, time, uv, texture, float, positionLocal, vec2, mix, sin } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { foliageMaterials, registerReactiveMaterial, attachReactivity } from './common.js';

/**
 * Creates a bioluminescent waterfall connecting two points.
 * @param {THREE.Vector3} startPos - Top position
 * @param {THREE.Vector3} endPos - Bottom position
 * @param {number} width - Width of the waterfall
 */
export function createWaterfall(startPos, endPos, width = 5.0) {
    const group = new THREE.Group();
    group.name = 'Waterfall';

    const height = startPos.y - endPos.y;
    const midY = (startPos.y + endPos.y) / 2;

    // Geometry: Vertical plane bent slightly? Simple plane for now.
    // We align it to face roughly Z or camera, but for 3D world, a cylinder segment or curved plane is better.
    // Let's use a CylinderGeometry with open ends, scaled flat.
    const geo = new THREE.CylinderGeometry(width, width * 1.5, height, 16, 8, true);
    // Cylinder is Y-up by default.
    // We need to position it at midY.

    // Custom TSL Material for "Viscous Neon"
    const mat = new MeshStandardNodeMaterial({
        color: 0x00FFFF,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        side: THREE.DoubleSide
    });

    // Flow Logic
    const speed = 2.0;
    const flowUV = uv().add(vec2(0, time.mul(speed).negate())); // Scroll UV Y

    // Noise/Texture approximation using sin/cos for ripples
    // Since we don't have a noise texture loaded here easily without async, we use procedural noise.
    // Simple ripple pattern:
    const ripple = sin(flowUV.y.mul(20.0).add(flowUV.x.mul(10.0))).mul(0.5).add(0.5);
    const pulse = sin(time.mul(3.0)).mul(0.2).add(0.8);

    // Color Gradient: Cyan at top -> Purple at bottom
    // We use uv().y (0 at bottom, 1 at top) ? Cylinder UVs: y goes 0 to 1? Check Three.js docs.
    // Usually y=0 is bottom.
    const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

    mat.colorNode = gradient;
    mat.opacityNode = float(0.7).mul(ripple.add(0.5)); // Semitransparent with ripples
    mat.emissiveNode = gradient.mul(pulse).mul(ripple);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startPos.x, midY, startPos.z);

    // Register for reactivity (optional, waterfalls could flash)
    registerReactiveMaterial(mat);

    group.add(mesh);

    // Add Splash Particles at bottom
    // For now, simple spheres or sprites could represent splash, but let's keep it geometry based.
    const splashCount = 5;
    for (let i = 0; i < splashCount; i++) {
        const splashGeo = new THREE.SphereGeometry(width * 0.2, 8, 8);
        const splashMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.5 });
        const splash = new THREE.Mesh(splashGeo, splashMat);
        // Randomize
        splash.position.set(startPos.x + (Math.random()-0.5)*width, endPos.y, startPos.z + (Math.random()-0.5)*width);
        splash.userData = {
            velocity: new THREE.Vector3((Math.random()-0.5), Math.random()*5, (Math.random()-0.5)),
            originalY: endPos.y
        };
        group.add(splash);
    }

    // Attach custom animation for splashes
    group.userData.type = 'waterfall';
    group.userData.splashes = group.children.slice(1);

    // Custom animate function
    group.onAnimate = (delta, time) => {
        group.userData.splashes.forEach(s => {
            s.position.addScaledVector(s.userData.velocity, delta);
            s.userData.velocity.y -= 9.8 * delta; // Gravity
            if (s.position.y < s.userData.originalY - 1) {
                // Reset
                s.position.y = s.userData.originalY;
                s.userData.velocity.y = Math.random() * 5 + 2;
                s.position.x = startPos.x + (Math.random()-0.5)*width;
                s.position.z = startPos.z + (Math.random()-0.5)*width;
            }
        });
    };

    return group;
}

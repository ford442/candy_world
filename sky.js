import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform, sin, cos, pow } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms so main.js can drive them
export const uSkyTopColor = uniform(color(0x87CEEB));
export const uSkyBottomColor = uniform(color(0xFFB6C1));

function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 64, 32); // Increased detail

    // TSL Gradient with more atmospheric effects
    const offset = float(33.0);
    const exponent = float(0.6);

    // positionWorld is vec3 (x, y, z)
    const h = positionWorld.add(offset).normalize().y;
    const mixFactor = h.max(0.0).pow(exponent).max(0.0);

    // Add atmospheric color bands for more depth
    const horizonBand = h.max(0.0).oneMinus().pow(float(3.0)); // Strong at horizon
    const zenithBand = h.max(0.0).pow(float(4.0)); // Strong at top

    // Horizon glow (peachy/golden band)
    const horizonColor = color(0xFFDAB9); // PeachPuff

    // Enhanced gradient with multiple color zones
    const bottomToMid = mix(uSkyBottomColor, horizonColor, horizonBand.mul(0.5));
    const finalSkyColor = mix(bottomToMid, uSkyTopColor, mixFactor);

    // Add subtle atmospheric texture
    const pos = positionWorld;
    const atmosphericNoise = pos.x.mul(0.01).sin()
        .mul(pos.z.mul(0.01).cos())
        .mul(0.05)
        .add(1.0);

    const skyColor = finalSkyColor.mul(atmosphericNoise);

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = skyColor;
    skyMat.side = THREE.BackSide;

    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

export { createSky };

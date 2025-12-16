import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms so main.js can drive them
// Enhanced candy-world sky colors with richer pastel tones
export const uSkyTopColor = uniform(color(0x7EC8E3));     // Soft sky blue with more depth
export const uSkyBottomColor = uniform(color(0xFFC5D3)); // Warmer pastel pink horizon

function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 24, 12); // Slightly increased for smoother gradient

    // TSL Gradient - refined for candy aesthetic
    const offset = float(40.0);   // Adjusted for better horizon transition
    const exponent = float(0.5);  // Smoother gradient falloff

    // positionWorld is vec3 (x, y, z)
    // h = normalize( vWorldPosition + offset ).y;
    // Note: positionWorld is absolute world position.
    // In original shader: vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    // positionWorld node gives exactly that.

    // TSL math:
    // We need to be careful with types. positionWorld is a node.
    // add, normalize, y are methods on nodes.

    const h = positionWorld.add(offset).normalize().y;
    const mixFactor = h.max(0.0).pow(exponent).max(0.0);

    const skyColor = mix(uSkyBottomColor, uSkyTopColor, mixFactor);

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = skyColor;
    skyMat.side = THREE.BackSide;

    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

export { createSky };

import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms so main.js can animate them
export const uSkyTopColor = uniform(color(0x87CEEB));
export const uSkyBottomColor = uniform(color(0xFFB6C1));

function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 32, 15);

    // TSL Gradient
    // gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );

    const offset = float(33.0);
    const exponent = float(0.6);

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

import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export const uSkyTopColor = uniform(color(0x87CEEB));
export const uSkyBottomColor = uniform(color(0xFFB6C1));

export function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 32, 15);
    const offset = float(33.0);
    const exponent = float(0.6);
    const h = positionWorld.add(offset).normalize().y;
    const mixFactor = h.max(0.0).pow(exponent).max(0.0);
    const skyColor = mix(uSkyBottomColor, uSkyTopColor, mixFactor);
    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = skyColor;
    skyMat.side = THREE.BackSide;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

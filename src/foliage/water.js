import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec2, Fn, uniform, sin, cos, time, positionLocal,
    uv, normalize, smoothstep, mix, abs, max, positionWorld, mul, add, sub
} from 'three/tsl';
import { CandyPresets } from './common.js';

export const uAudioLow = uniform(0.0);   
export const uAudioHigh = uniform(0.0);  
export const uWaveHeight = uniform(1.0); 

export function createWaveformWater(width = 400, depth = 400) {
    const geometry = new THREE.PlaneGeometry(width, depth, 128, 128);
    geometry.rotateX(-Math.PI / 2); 

    const waterDisplacement = Fn((pos) => {
        const bigWave = sin(pos.x.mul(0.05).add(time.mul(0.5))).mul(2.0);
        const bassWave = cos(pos.z.mul(0.1).sub(time.mul(1.0)))
            .mul(uAudioLow.mul(3.0).add(0.5)); 

        const rippleX = sin(pos.x.mul(0.5).add(time.mul(2.0)));
        const rippleZ = cos(pos.z.mul(0.4).sub(time.mul(2.5)));
        const trebleRipples = rippleX.mul(rippleZ).mul(uAudioHigh.mul(1.5));

        return bigWave.add(bassWave).add(trebleRipples).mul(uWaveHeight);
    });

    const material = CandyPresets.SeaJelly(0x44AAFF, {
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.9,
        ior: 1.33,
        thickness: 2.0,
        animateMoisture: true 
    });

    const pos = positionLocal;
    const displacement = waterDisplacement(pos);

    const newPos = vec3(pos.x, pos.y.add(displacement), pos.z);
    material.positionNode = newPos;

    const heightFactor = smoothstep(2.0, 5.0, displacement); 
    const foamColor = color(0xFFFFFF);
    const waterColor = material.colorNode; 

    material.colorNode = mix(waterColor, foamColor, heightFactor.mul(0.5));

    // FIX: Wrap numbers in float() to prevent TSL crash
    const beatGlow = uAudioLow.mul(0.2); 
    material.emissiveNode = vec3(float(0.1), float(0.3), float(0.6)).mul(beatGlow);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'water';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    return mesh;
}

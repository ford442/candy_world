// src/foliage/sky.js

import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform, smoothstep, pow, mul, sub, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms
export const uSkyTopColor = uniform(new THREE.Color(0x7EC8E3));     
export const uSkyBottomColor = uniform(new THREE.Color(0xFFC5D3)); 
export const uHorizonColor = uniform(new THREE.Color(0xFFE5CC));   
export const uAtmosphereIntensity = uniform(0.3);        
export const uSkyDarkness = uniform(0.0); 

// TSL-FIXED
export function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 32, 24); 

    const offsetVal = float(40.0);
    const exponent = float(0.6);  

    // Explicitly wrap 0.0 in float() for vec3 construction
    const offsetVec = vec3(float(0.0), offsetVal, float(0.0));
    
    // Add to positionWorld safely
    const h = positionWorld.add(offsetVec).normalize().y;

    // FIX: Wrap 0.0 in float() for max()
    const heightFactor = h.max(float(0.0)).pow(exponent);
    
    // FIX: Wrap all raw numbers in float() for smoothstep
    const horizonBand = smoothstep(float(0.0), float(0.15), h).mul(smoothstep(float(0.4), float(0.15), h));
    const atmosphereGlow = horizonBand.mul(uAtmosphereIntensity);
    
    // Gradient Mix
    // FIX: Wrap 0.0, 0.3, 0.2, 1.0 in float()
    const midColor = mix(uHorizonColor, uSkyBottomColor, smoothstep(float(0.0), float(0.3), heightFactor));
    const skyColor = mix(midColor, uSkyTopColor, smoothstep(float(0.2), float(1.0), heightFactor));
    
    const baseColor = mix(skyColor, uHorizonColor, atmosphereGlow);

    // Apply Darkness
    const finalColor = baseColor.mul(float(1.0).sub(uSkyDarkness));

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = finalColor;
    skyMat.side = THREE.BackSide;

    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

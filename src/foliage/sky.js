// src/foliage/sky.js

import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform, smoothstep, pow, mul, sub } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms so main.js and weather.js can drive them
export const uSkyTopColor = uniform(color(0x7EC8E3));     
export const uSkyBottomColor = uniform(color(0xFFC5D3)); 
export const uHorizonColor = uniform(color(0xFFE5CC));   
export const uAtmosphereIntensity = uniform(0.3);        

export const uSkyDarkness = uniform(0.0); // 0.0 = Normal, 1.0 = Pitch Black

// --- NEW: Twilight Uniform for Plant Bioluminescence ---
// 0.0 = Day (No Glow), 1.0 = Night/Twilight (Full Glow)
export const uTwilight = uniform(0.0);
// -------------------------------------------------------

export function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 32, 24); 

    const offset = float(40.0);   
    const exponent = float(0.6);  

    const h = positionWorld.add(offset).normalize().y;
    const heightFactor = h.max(0.0).pow(exponent);
    
    // Atmospheric scattering
    const horizonBand = smoothstep(0.0, 0.15, h).mul(smoothstep(0.4, 0.15, h));
    const atmosphereGlow = horizonBand.mul(uAtmosphereIntensity);
    
    // Gradient Mix
    const midColor = mix(uHorizonColor, uSkyBottomColor, smoothstep(0.0, 0.3, heightFactor));
    const skyColor = mix(midColor, uSkyTopColor, smoothstep(0.2, 1.0, heightFactor));
    
    const baseColor = mix(skyColor, uHorizonColor, atmosphereGlow);

    // Apply Darkness (Darkness Event Logic)
    // When uSkyDarkness approaches 1.0, the whole sky fades to black
    const finalColor = baseColor.mul(float(1.0).sub(uSkyDarkness));

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = finalColor;
    skyMat.side = THREE.BackSide;

    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

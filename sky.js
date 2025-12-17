import * as THREE from 'three';
import { color, mix, positionWorld, float, uniform, smoothstep, pow, mul, add } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Export uniforms so main.js can drive them
// Enhanced candy-world sky colors with richer pastel tones
export const uSkyTopColor = uniform(color(0x7EC8E3));     // Soft sky blue with more depth
export const uSkyBottomColor = uniform(color(0xFFC5D3)); // Warmer pastel pink horizon
export const uHorizonColor = uniform(color(0xFFE5CC));   // NEW: Dedicated horizon glow color
export const uAtmosphereIntensity = uniform(0.3);        // NEW: Atmospheric scattering intensity

function createSky() {
    const skyGeo = new THREE.SphereGeometry(1000, 32, 24); // Increased segments for smoother gradient

    // TSL Gradient - Enhanced with multi-band atmospheric scattering
    const offset = float(40.0);   // Adjusted for better horizon transition
    const exponent = float(0.6);  // Slightly stronger gradient for more depth

    // Calculate vertical position factor (0 at horizon, 1 at zenith)
    const h = positionWorld.add(offset).normalize().y;
    const heightFactor = h.max(0.0).pow(exponent);
    
    // NEW: Create atmospheric scattering near horizon
    // This creates a warm glow band near the horizon line
    // Using inverted smoothstep creates a bell curve: peaks at h=0.15, fades by h=0.4
    const horizonBand = smoothstep(0.0, 0.15, h).mul(smoothstep(0.4, 0.15, h));
    const atmosphereGlow = horizonBand.mul(uAtmosphereIntensity);
    
    // Three-way color mix for richer gradient:
    // 1. Bottom (horizon glow) -> 2. Mid (bottom color) -> 3. Top (sky color)
    const midColor = mix(uHorizonColor, uSkyBottomColor, smoothstep(0.0, 0.3, heightFactor));
    const skyColor = mix(midColor, uSkyTopColor, smoothstep(0.2, 1.0, heightFactor));
    
    // Add subtle atmospheric glow enhancement
    const finalColor = mix(skyColor, uHorizonColor, atmosphereGlow);

    const skyMat = new MeshBasicNodeMaterial();
    skyMat.colorNode = finalColor;
    skyMat.side = THREE.BackSide;

    const sky = new THREE.Mesh(skyGeo, skyMat);
    return sky;
}

export { createSky };

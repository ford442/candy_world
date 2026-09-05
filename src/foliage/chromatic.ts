
import * as THREE from 'three';
import {
    Fn,
    vec3,
    vec4,
    float,
    uniform,
    viewportSharedTexture,
    screenUV,
    time,
    sin,
    cos,
    vec2,
    max,
    mix
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';

// Global uniform for Candy Impact / Glow Pulse intensity.
// Driven by dashes, impacts, strong beats, etc.
export const uChromaticIntensity = uniform(0.0);

type UvNode = ReturnType<typeof vec2>;

/**
 * Zoom / shake / barrel UV warp for the candy glow pulse.
 * Identity when `uChromaticIntensity` is 0.
 */
export function candyPulseWarpUv(baseUV: UvNode): UvNode {
    const centeredUV = baseUV.sub(0.5);
    const shakePhase = time.mul(42.0);
    const shakeAmount = uChromaticIntensity.mul(0.007);
    const shakeX = sin(shakePhase).mul(shakeAmount);
    const shakeY = cos(shakePhase.mul(1.15)).mul(shakeAmount);
    const shakeOffset = vec2(shakeX, shakeY);
    const zoomFactor = float(1.0).sub(uChromaticIntensity.mul(0.12));
    const zoomedUV = centeredUV.mul(zoomFactor).add(shakeOffset);
    const dist = zoomedUV.length();
    const distortionStrength = uChromaticIntensity.mul(0.35);
    const distortion = float(1.0).add(dist.mul(dist).mul(distortionStrength));
    return zoomedUV.mul(distortion).add(0.5) as UvNode;
}

/**
 * Grade a scene sample into the candy glow pulse look.
 * `sample` must read the scene color at a UV — post-FX uses `scenePass.getTextureNode().uv`,
 * not `viewportSharedTexture` (that copy is rgba8unorm vs HDR rgba16float on WebGPU).
 */
export function gradeCandyGlowPulse(
    sample: (coords: UvNode) => ReturnType<typeof vec3>,
    warpedUV: UvNode,
    distFromCenter: ReturnType<typeof float>
): ReturnType<typeof vec3> {
    const baseColor = sample(warpedUV);
    const glowOffset = uChromaticIntensity.mul(0.004);
    const glow1 = sample(warpedUV.add(vec2(glowOffset, 0.0)) as UvNode);
    const glow2 = sample(
        warpedUV.add(vec2(glowOffset.mul(-0.7), glowOffset.mul(1.1))) as UvNode
    );
    const glow3 = sample(warpedUV.add(vec2(0.0, glowOffset.mul(-0.9))) as UvNode);

    const glowA = max(baseColor, glow1);
    const glowB = max(glowA, glow2);
    const glow = max(glowB, glow3);

    const brightness = glow.x.mul(0.3).add(glow.y.mul(0.59)).add(glow.z.mul(0.11));
    const highlightBoost = max(brightness.sub(0.6), 0.0).mul(uChromaticIntensity.mul(1.8));
    const glowed = glow.add(vec3(highlightBoost).mul(0.6));

    // 🎨 PALETTE: Soft candy color shift (pastel pink/magenta bias on impact)
    const candyPink = vec3(1.08, 0.88, 0.98);
    const candyShift = mix(vec3(1.0), candyPink, uChromaticIntensity.mul(0.35));
    const finalColor = glowed.mul(candyShift);

    const satAmount = uChromaticIntensity.mul(0.25).add(1.0);
    const lum = finalColor.dot(vec3(0.299, 0.587, 0.114));
    const saturated = mix(vec3(lum), finalColor, satAmount);

    const edgeVig = max(float(1.0).sub(distFromCenter.mul(0.9)), 0.0);
    const vigBoost = edgeVig.mul(uChromaticIntensity).mul(0.25);
    const withVig = saturated.add(vec3(vigBoost).mul(0.4));

    // Music Impact: global noteColor tint on high chromatic intensity
    const globalUniforms = getBiomeUniforms('global');
    const musicTint = globalUniforms.noteColor
        .mul(globalUniforms.shimmer)
        .mul(uChromaticIntensity)
        .mul(0.15);
    return withVig.add(musicTint) as ReturnType<typeof vec3>;
}

/**
 * Creates a full-screen "Candy Glow Pulse" overlay.
 *
 * WebGL / GLSL-node path only. WebGPU composites this in the TSL post graph
 * (`post-processing-webgpu.ts`) so we never `copyFramebufferToTexture` from
 * an HDR rgba16float pass into Three's default rgba8unorm FramebufferTexture.
 *
 * @returns {THREE.Mesh} The full-screen quad mesh (attach to camera).
 */
export function createChromaticPulse(): THREE.Mesh {
    // Create a full-screen quad geometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    const chromaticEffect = Fn(() => {
        const baseUV = screenUV;
        const warpedUV = candyPulseWarpUv(baseUV as UvNode);
        const centered = warpedUV.sub(0.5);
        const dist = centered.length();
        const sample = (coords: UvNode) => viewportSharedTexture(coords).rgb;
        const withMusic = gradeCandyGlowPulse(sample, warpedUV, dist);
        return vec4(withMusic, 1.0);
    });

    // Use MeshBasicNodeMaterial to ensure the overlay is unlit and displays exactly as calculated
    const material = new MeshBasicNodeMaterial();
    material.colorNode = chromaticEffect();

    // The effect is intentionally named "Chromatic Pulse" in the API for backward compatibility
    // with all the gameplay systems that drive uChromaticIntensity, but the visual is now a
    // soft, juicy "Candy Glow Pulse" that matches the pastel aesthetic.

    // Ensure it renders on top of everything else (Post-Processing simulation)
    // We set depthTest/depthWrite to false so it doesn't mess with depth buffer
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true; // Technically opaque output, but good for overlay behavior

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // Always render
    mesh.renderOrder = 9999; // Render last
    mesh.userData.isFullScreenEffect = true;

    // Position in front of camera (assuming attached to camera)
    // z = -1.0 is comfortably inside the frustum (near usually 0.1)
    mesh.position.set(0, 0, -1.0);

    // Scale up to cover screen even at ultra-wide aspect ratios
    // At z=-1, height coverage is ~1.5 (for FOV 75).
    // Width coverage for 32:9 aspect (super ultrawide) is ~5.3.
    // Scale by 10 is excessively safe.
    mesh.scale.set(10, 10, 1);

    return mesh;
}

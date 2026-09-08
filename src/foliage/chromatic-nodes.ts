import { vec3, float, uniform, time, sin, cos, vec2, max, mix } from 'three/tsl';

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
    distFromCenter: ReturnType<typeof float>,
    noteColorNode: ReturnType<typeof vec3>,
    shimmerNode: ReturnType<typeof float>
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
    const musicTint = noteColorNode
        .mul(shimmerNode)
        .mul(uChromaticIntensity)
        .mul(0.15);
    return withVig.add(musicTint) as ReturnType<typeof vec3>;
}

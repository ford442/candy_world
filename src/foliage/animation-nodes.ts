import { positionLocal, time, float, sin, cos, vec3, attribute, select, positionWorld, normalLocal } from 'three/tsl';
import { uAudioLow, uAudioHigh } from './material-core.ts';


// Enum-like IDs for animation types
export const ANIMATION_TYPES = {
    STATIC: 0,
    GENTLE_SWAY: 1,
    BOUNCE: 2,
    SHIVER: 3,
    HOP: 4,
    VINE_SWAY: 5,
    SPIRAL_WAVE: 6,
    SPRING: 7,
    WOBBLE: 8,
    ACCORDION: 9,
    ACCORDION_STRETCH: 10,
    FIBER_WHIP: 11
};

/**
 * Shared TSL animation nodes
 */

// Gentle Sway: Slow, subtle rotation on Z and X
export const gentleSwayNode = (animOffset: any) => {
    const t = time.add(animOffset);
    const swayZ = sin(t).mul(0.05);
    const swayX = cos(t.mul(0.8)).mul(0.05);
    return vec3(swayX.mul(positionLocal.y), float(0), swayZ.mul(positionLocal.y));
};

// Bounce: Scale Y up and down
export const bounceNode = (animOffset: any) => {
    const t = time.mul(4).add(animOffset);
    const bounce = sin(t).mul(0.1).add(uAudioLow.mul(0.2));
    return vec3(positionLocal.x, positionLocal.y.mul(bounce.add(1.0)), positionLocal.z).sub(positionLocal);
};

// Shiver: Fast vibration
export const shiverNode = (animOffset: any) => {
    const t = time.mul(20).add(animOffset);
    const shiverZ = sin(t).mul(0.05).add(uAudioLow.mul(0.1));
    const shiverX = shiverZ.mul(0.5);
    return vec3(shiverX.mul(positionLocal.y), float(0), shiverZ.mul(positionLocal.y));
};

// Spring: Scale Y inverse to X/Z
export const springNode = (animOffset: any) => {
    const t = time.mul(5).add(animOffset);
    const sy = sin(t).mul(0.1).add(1.0);
    const sxz = float(1.0).sub(sin(t).mul(0.05));
    return vec3(positionLocal.x.mul(sxz), positionLocal.y.mul(sy), positionLocal.z.mul(sxz)).sub(positionLocal);
};

// Vine Sway: Like sway but faster
export const vineSwayNode = (animOffset: any) => {
    const t = time.mul(1.5).add(animOffset);
    const swayZ = sin(t).mul(0.2);
    const swayX = cos(t.mul(1.2).add(animOffset)).mul(0.1);
    return vec3(swayX.mul(positionLocal.y), float(0), swayZ.mul(positionLocal.y));
};

// Hop: Upward bob
export const hopNode = (animOffset: any) => {
    const t = time.mul(6).add(animOffset);
    const hopY = sin(t).mul(0.1);
    return vec3(float(0), hopY, float(0));
};

// Wobble: Bending side to side
export const wobbleNode = (animOffset: any) => {
    const t = time.mul(3).add(animOffset);
    const wobbleZ = sin(t).mul(0.1);
    return vec3(float(0), float(0), wobbleZ.mul(positionLocal.y));
};

// Accordion / Stretch: Scale Y heavily
export const accordionNode = (animOffset: any) => {
    const t = time.mul(3).add(animOffset);
    const stretch = sin(t).mul(0.2);
    return vec3(positionLocal.x, positionLocal.y.mul(stretch.add(1.0)), positionLocal.z).sub(positionLocal);
};

// Spiral Wave: Rotate around Y axis while swaying
export const spiralWaveNode = (animOffset: any) => {
    const t = time.mul(2).add(animOffset);
    const swayX = sin(t.add(positionLocal.y)).mul(0.1);
    const swayZ = cos(t.add(positionLocal.y)).mul(0.1);
    return vec3(swayX.mul(positionLocal.y), float(0), swayZ.mul(positionLocal.y));
};

// Fiber Whip: Like grass waving fast
export const fiberWhipNode = (animOffset: any) => {
    const t = time.mul(4).add(animOffset);
    const whipZ = sin(t.add(positionLocal.y.mul(2))).mul(0.15);
    return vec3(float(0), float(0), whipZ.mul(positionLocal.y));
};

/**
 * Main switch node for instance animation.
 * Evaluates the `instanceAnimType` and `instanceAnimOffset` attributes.
 * Returns the positional offset to ADD to positionLocal.
 */
export const applyInstanceAnimation = () => {
    const animType = attribute('instanceAnimType', 'float');
    const animOffset = attribute('instanceAnimOffset', 'float');

    // Default: return zero offset
    let offset = vec3(0, 0, 0);

    offset = select(animType.equal(ANIMATION_TYPES.GENTLE_SWAY), gentleSwayNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.BOUNCE), bounceNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.SHIVER), shiverNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.SPRING), springNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.VINE_SWAY), vineSwayNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.HOP), hopNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.WOBBLE), wobbleNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.ACCORDION), accordionNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.ACCORDION_STRETCH), accordionNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.SPIRAL_WAVE), spiralWaveNode(animOffset), offset);
    offset = select(animType.equal(ANIMATION_TYPES.FIBER_WHIP), fiberWhipNode(animOffset), offset);

    return offset;
};

/**
 * Optional function to compute the normal map rotation
 */
export const applyInstanceNormalAnimation = () => {
    const animType = attribute('instanceAnimType', 'float');
    const animOffset = attribute('instanceAnimOffset', 'float');
    const t = time.mul(1.5).add(animOffset);
    const swayZ = sin(t).mul(0.2);
    const swayX = cos(t.mul(1.2).add(animOffset)).mul(0.1);

    // Crude approximation of normal rotation for intense sway
    const n = normalLocal;
    // We would rotate the normal if it was Vine Sway.
    // Given the TSL complexity of quaternions, we can do a simplified normal shift.
    const shiftedNormal = vec3(n.x.add(swayX), n.y, n.z.add(swayZ)).normalize();
    return select(animType.equal(ANIMATION_TYPES.VINE_SWAY), shiftedNormal, n);
};

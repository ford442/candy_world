// src/utils/tsl-safe.js
import { float, vec3, add, mul, sub, mix, color } from 'three/tsl';

/**
 * Helper: Auto-wraps numbers in float()
 */
const _f = (v) => (typeof v === 'number' ? float(v) : v);

/**
 * Safe Vector3 Constructor
 * Prevents "TypeError: i.getNodeType is not a function"
 */
export const safeVec3 = (x, y, z) => {
    // If x is a Color object, convert to vec3 node
    if (x && x.isColor) return vec3(x.r, x.g, x.b); 
    // Handle single argument (scalar to vector)
    if (y === undefined && z === undefined) return vec3(_f(x));
    // Handle normal case
    return vec3(_f(x), _f(y), _f(z));
};

/**
 * Safe Math Operations
 * Wraps operands in float() if they are numbers
 */
export const safeAdd = (a, b) => add(_f(a), _f(b));
export const safeSub = (a, b) => sub(_f(a), _f(b));
export const safeMul = (a, b) => mul(_f(a), _f(b));

/**
 * Safe Mix
 */
export const safeMix = (a, b, t) => mix(_f(a), _f(b), _f(t));

// Export others as pass-through
export { float, color, positionLocal, positionWorld, normalWorld, uv, time } from 'three/tsl';

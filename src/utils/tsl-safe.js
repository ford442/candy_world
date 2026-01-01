import { float, vec3, add, mul, sub, mix, color } from 'three/tsl';

// Helper: Auto-wrap numbers
const _f = (v) => (typeof v === 'number' ? float(v) : v);

// Safe Vector3: Handles (x, y, z), (scalar), or (Color) inputs safely
export const safeVec3 = (x, y, z) => {
    if (x && x.isColor) return vec3(x.r, x.g, x.b); 
    if (y === undefined && z === undefined) return vec3(_f(x));
    return vec3(_f(x), _f(y), _f(z));
};

// Safe Math
export const safeAdd = (a, b) => add(_f(a), _f(b));
export const safeSub = (a, b) => sub(_f(a), _f(b));
export const safeMul = (a, b) => mul(_f(a), _f(b));
export const safeMix = (a, b, t) => mix(_f(a), _f(b), _f(t));

// Passthrough exports
export { float, color, positionLocal, positionWorld, normalWorld, uv, time } from 'three/tsl';

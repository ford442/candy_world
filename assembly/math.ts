// Pure math helpers

export function lerp(a: f32, b: f32, t: f32): f32 {
  return a + (b - a) * t;
}

export function clamp(value: f32, minVal: f32, maxVal: f32): f32 {
  return Mathf.max(minVal, Mathf.min(maxVal, value));
}

// =============================================================================
// COLOR SPACE CONVERSIONS (for audio-reactive materials)
// =============================================================================

/**
 * Convert HSL to RGB and pack into u32 (0xRRGGBB format)
 * @param h - Hue in range [0, 1]
 * @param s - Saturation in range [0, 1]
 * @param l - Lightness in range [0, 1]
 * @returns Packed RGB color as u32
 */
export function hslToRgb(h: f32, s: f32, l: f32): u32 {
  if (s == 0.0) {
    const gray = <u32>(l * 255.0);
    return (gray << 16) | (gray << 8) | gray;
  }

  const q: f32 = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  const p: f32 = 2.0 * l - q;

  const r: f32 = hueToRgb(p, q, h + <f32>(1.0 / 3.0));
  const g: f32 = hueToRgb(p, q, h);
  const b: f32 = hueToRgb(p, q, h - <f32>(1.0 / 3.0));

  return (<u32>(r * 255.0) << 16) | (<u32>(g * 255.0) << 8) | <u32>(b * 255.0);
}

function hueToRgb(p: f32, q: f32, t: f32): f32 {
  let t2: f32 = t;
  if (t2 < 0.0) t2 += 1.0;
  if (t2 > 1.0) t2 -= 1.0;
  if (t2 < <f32>(1.0 / 6.0)) return p + (q - p) * <f32>6.0 * t2;
  if (t2 < <f32>0.5) return q;
  if (t2 < <f32>(2.0 / 3.0)) return p + (q - p) * (<f32>(2.0 / 3.0) - t2) * <f32>6.0;
  return p;
}

/**
 * Convert RGB to HSL and pack into u32 (0xHHSSLL format, each component scaled to 0-255)
 * @param r - Red in range [0, 1]
 * @param g - Green in range [0, 1]
 * @param b - Blue in range [0, 1]
 * @returns Packed HSL result as u32
 */
export function rgbToHsl(r: f32, g: f32, b: f32): u32 {
  const max = Mathf.max(r, Mathf.max(g, b));
  const min = Mathf.min(r, Mathf.min(g, b));
  const l = (max + min) / 2.0;

  if (max == min) {
    // Achromatic
    return <u32>(l * 255.0);
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);

  let h: f32 = 0.0;
  if (max == r) {
    h = (g - b) / d + (g < b ? 6.0 : 0.0);
  } else if (max == g) {
    h = (b - r) / d + 2.0;
  } else {
    h = (r - g) / d + 4.0;
  }
  h /= 6.0;

  return (<u32>(h * 255.0) << 16) | (<u32>(s * 255.0) << 8) | <u32>(l * 255.0);
}

// =============================================================================
// NOISE FUNCTIONS (for procedural generation)
// =============================================================================

/**
 * 2D hash function for pseudo-random values
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Hash value in range [0, 1]
 */
export function hash2D(x: f32, y: f32): f32 {
  const n = Mathf.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Mathf.floor(n);
}

/**
 * 2D value noise with bilinear interpolation
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Noise value in range [0, 1]
 */
export function valueNoise2D(x: f32, y: f32): f32 {
  const ix = Mathf.floor(x);
  const iy = Mathf.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const u = fx * fx * (3.0 - 2.0 * fx);
  const v = fy * fy * (3.0 - 2.0 * fy);

  const n00 = hash2D(ix, iy);
  const n10 = hash2D(ix + 1.0, iy);
  const n01 = hash2D(ix, iy + 1.0);
  const n11 = hash2D(ix + 1.0, iy + 1.0);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/**
 * Fractal Brownian Motion 2D - layered noise for more detail
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param octaves - Number of noise layers (typically 2-8)
 * @returns FBM value in range [0, 1]
 */
export function fbm2D(x: f32, y: f32, octaves: i32): f32 {
  let total: f32 = 0.0;
  let amplitude: f32 = 1.0;
  let frequency: f32 = 1.0;
  let maxValue: f32 = 0.0;

  const n = clamp(<f32>octaves, 1.0, 8.0);

  for (let i: i32 = 0; i < <i32>n; i++) {
    total += valueNoise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }

  return total / maxValue;
}

// =============================================================================
// DISTANCE CALCULATIONS
// =============================================================================

/**
 * Calculate squared distance between two 2D points
 * @param ax - Point A X coordinate
 * @param ay - Point A Y coordinate
 * @param bx - Point B X coordinate
 * @param by - Point B Y coordinate
 * @returns Squared distance (avoid sqrt for comparisons)
 */
export function distSq2D(ax: f32, ay: f32, bx: f32, by: f32): f32 {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/**
 * Calculate squared distance between two 3D points
 * @param ax - Point A X coordinate
 * @param ay - Point A Y coordinate
 * @param az - Point A Z coordinate
 * @param bx - Point B X coordinate
 * @param by - Point B Y coordinate
 * @param bz - Point B Z coordinate
 * @returns Squared distance (avoid sqrt for comparisons)
 */
export function distSq3D(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32): f32 {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return dx * dx + dy * dy + dz * dz;
}

// =============================================================================
// SMOOTHING FUNCTIONS
// =============================================================================

/**
 * Standard smoothstep function - Hermite interpolation
 * @param t - Input value in range [0, 1]
 * @returns Smoothed value in range [0, 1]
 */
export function smoothstep(t: f32): f32 {
  const c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

/**
 * Smootherstep function - higher order Hermite interpolation
 * @param t - Input value in range [0, 1]
 * @returns Smoothed value in range [0, 1] with zero 2nd derivative at edges
 */
export function smootherstep(t: f32): f32 {
  const c = clamp(t, 0.0, 1.0);
  return c * c * c * (c * (c * 6.0 - 15.0) + 10.0);
}

/**
 * Inverse lerp - find the interpolation factor between two values
 * @param a - Start value
 * @param b - End value
 * @param value - Current value
 * @returns Interpolation factor t where value = lerp(a, b, t)
 */
export function inverseLerp(a: f32, b: f32, value: f32): f32 {
  if (a == b) return 0.0;
  return clamp((value - a) / (b - a), 0.0, 1.0);
}

export function getGroundHeight(x: f32, z: f32): f32 {
  // Simple rolling hills matching the shader logic
  // y = sin(x * 0.05) * 2.0 + cos(z * 0.05) * 2.0
  // + details: sin(x * 0.2) * 0.3 + cos(z * 0.15) * 0.3

  if (isNaN(x) || isNaN(z)) return 0.0;

  const hills = Mathf.sin(x * 0.05) * 2.0 + Mathf.cos(z * 0.05) * 2.0;
  const detail = Mathf.sin(x * 0.2) * 0.3 + Mathf.cos(z * 0.15) * 0.3;

  return hills + detail;
}

export function freqToHue(freq: f32): f32 {
  // Map frequency (20Hz - 2000Hz) to hue (0.0 - 1.0)
  // Low freq = Red/Orange, Mid = Green/Blue, High = Purple
  if (freq < 50.0) return 0.0;
  const logF = Mathf.log2(freq / 55.0); // A1 reference
  return (logF * 0.1) % 1.0;
}

export function lerpColor(color1: u32, color2: u32, t: f32): u32 {
  const r1 = <f32>((color1 >> 16) & 0xFF);
  const g1 = <f32>((color1 >> 8) & 0xFF);
  const b1 = <f32>(color1 & 0xFF);

  const r2 = <f32>((color2 >> 16) & 0xFF);
  const g2 = <f32>((color2 >> 8) & 0xFF);
  const b2 = <f32>(color2 & 0xFF);

  const r = <u32>(r1 + (r2 - r1) * t);
  const g = <u32>(g1 + (g2 - g1) * t);
  const b = <u32>(b1 + (b2 - b1) * t);

  return (r << 16) | (g << 8) | b;
}

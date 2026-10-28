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

// =============================================================================
// NOISE FUNCTIONS (for procedural generation)
// =============================================================================

// =============================================================================
// DISTANCE CALCULATIONS
// =============================================================================

// =============================================================================
// SMOOTHING FUNCTIONS
// =============================================================================

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


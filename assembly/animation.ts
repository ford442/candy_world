// Specific animation calculators (Speaker, Fiber Whip, etc.)

/**
 * Calculate single bounce Y offset (convenience function)
 */
export function calcBounceY(
  time: f32,
  offset: f32,
  intensity: f32,
  kick: f32
): f32 {
  const animTime = time + offset;
  let yOffset = Mathf.sin(animTime * 3.0) * 0.1 * intensity;
  if (kick > 0.1) yOffset += kick * 0.2;
  return yOffset;
}

/**
 * Calculate sway rotation Z
 */
export function calcSwayRotZ(time: f32, offset: f32, intensity: f32): f32 {
  return Mathf.sin(time + offset) * 0.1 * intensity;
}

/**
 * Calculate wobble rotations (returns rotX, rotZ packed)
 * Use getWobbleX/getWobbleZ to extract values
 */
let wobbleResultX: f32 = 0.0;
let wobbleResultZ: f32 = 0.0;

export function calcWobble(time: f32, offset: f32, intensity: f32): void {
  const animTime = time + offset;
  wobbleResultX = Mathf.sin(animTime * 3.0) * 0.15 * intensity;
  wobbleResultZ = Mathf.cos(animTime * 3.0) * 0.15 * intensity;
}

export function getWobbleX(): f32 { return wobbleResultX; }
export function getWobbleZ(): f32 { return wobbleResultZ; }

// =============================================================================
// ADVANCED ANIMATION FUNCTIONS (foliage.js animations)
// =============================================================================

/**
 * Speaker Pulse animation (Subwoofer Lotus)
 * Returns values via getter functions
 */
let speakerYOffset: f32 = 0.0;
let speakerScaleX: f32 = 1.0;
let speakerScaleY: f32 = 1.0;
let speakerScaleZ: f32 = 1.0;

export function calcSpeakerPulse(time: f32, offset: f32, kick: f32): void {
  speakerYOffset = Mathf.sin(time + offset) * 0.2;
  const pump = kick * 0.5;
  speakerScaleX = 1.0 + pump * 0.2;
  speakerScaleY = 1.0 - pump * 0.5;
  speakerScaleZ = 1.0 + pump * 0.2;
}

export function getSpeakerYOffset(): f32 { return speakerYOffset; }
export function getSpeakerScaleX(): f32 { return speakerScaleX; }
export function getSpeakerScaleY(): f32 { return speakerScaleY; }
export function getSpeakerScaleZ(): f32 { return speakerScaleZ; }

/**
 * Accordion Stretch animation (Accordion Palm)
 */
let accordionStretchY: f32 = 1.0;
let accordionWidthXZ: f32 = 1.0;

export function calcAccordionStretch(animTime: f32, offset: f32, intensity: f32): void {
  const rawStretch = Mathf.sin(animTime * 10.0 + offset);
  accordionStretchY = 1.0 + Mathf.max(0.0, rawStretch) * 0.3 * intensity;
  accordionWidthXZ = 1.0 / Mathf.sqrt(accordionStretchY);
}

export function getAccordionStretchY(): f32 { return accordionStretchY; }
export function getAccordionWidthXZ(): f32 { return accordionWidthXZ; }

/**
 * Fiber Whip animation (Willow branches)
 */
let fiberBaseRotY: f32 = 0.0;
let fiberBranchRotZ: f32 = 0.0;

export function calcFiberWhip(time: f32, offset: f32, leadVol: f32, isActive: i32, branchIndex: i32): void {
  fiberBaseRotY = Mathf.sin(time * 0.5 + offset) * 0.1;
  const whip = leadVol * 2.0;
  const childOffset = <f32>branchIndex * 0.5;
  fiberBranchRotZ = 0.785398 + Mathf.sin(time * 2.0 + childOffset) * 0.1; // PI/4
  if (isActive != 0) {
    fiberBranchRotZ += Mathf.sin(time * 10.0 + childOffset) * whip;
  }
}

export function getFiberBaseRotY(): f32 { return fiberBaseRotY; }
export function getFiberBranchRotZ(): f32 { return fiberBranchRotZ; }

/**
 * Hop animation with squash/stretch
 */
export function calcHopY(time: f32, offset: f32, intensity: f32, kick: f32): f32 {
  const animTime = time + offset;
  const hopVal = Mathf.sin(animTime * 4.0);
  let bounce = Mathf.max(0.0, hopVal) * 0.3 * intensity;
  if (kick > 0.1) bounce += kick * 0.15;
  return bounce;
}

/**
 * Shiver animation (small rapid vibration)
 */
let shiverRotX: f32 = 0.0;
let shiverRotZ: f32 = 0.0;

export function calcShiver(time: f32, offset: f32, intensity: f32): void {
  const animTime = time + offset;
  shiverRotX = Mathf.sin(animTime * 20.0) * 0.02 * intensity;
  shiverRotZ = Mathf.cos(animTime * 20.0) * 0.02 * intensity;
}

export function getShiverRotX(): f32 { return shiverRotX; }
export function getShiverRotZ(): f32 { return shiverRotZ; }

/**
 * Spiral Wave animation
 */
let spiralRotY: f32 = 0.0;
let spiralYOffset: f32 = 0.0;
let spiralScale: f32 = 1.0;

export function calcSpiralWave(time: f32, offset: f32, intensity: f32, groove: f32): void {
  const animTime = time + offset;
  spiralRotY = Mathf.sin(animTime * 2.0) * 0.2 * intensity;
  spiralYOffset = Mathf.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
  spiralScale = 1.0 + Mathf.sin(animTime * 4.0) * 0.05 * intensity;
}

export function getSpiralRotY(): f32 { return spiralRotY; }
export function getSpiralYOffset(): f32 { return spiralYOffset; }
export function getSpiralScale(): f32 { return spiralScale; }

/**
 * Prism Rose animation
 */
let prismUnfurl: f32 = 0.0;
let prismSpin: f32 = 0.0;
let prismPulse: f32 = 1.0;
let prismHue: f32 = 0.0;

export function calcPrismRose(time: f32, offset: f32, kick: f32, groove: f32, isActive: i32): void {
  const animTime = time + offset;
  const intensity: f32 = isActive != 0 ? (1.0 + groove * 3.0) : 0.3;
  prismUnfurl = Mathf.sin(animTime * 2.0) * 0.1 * intensity;
  prismSpin = animTime * 0.5 + groove * 2.0;
  prismPulse = 1.0 + kick * 0.3;
  prismHue = (animTime * 0.1) % 1.0;
}

export function getPrismUnfurl(): f32 { return prismUnfurl; }
export function getPrismSpin(): f32 { return prismSpin; }
export function getPrismPulse(): f32 { return prismPulse; }
export function getPrismHue(): f32 { return prismHue; }

// =============================================================================
// PARTICLE / RAIN FUNCTIONS
// =============================================================================

/** Calculate rain droplet Y position (cycles back to top) */
export function calcRainDropY(startY: f32, time: f32, speed: f32, cycleHeight: f32): f32 {
  const totalDrop = time * speed;
  const cycled = totalDrop % cycleHeight;
  return startY - cycled;
}

/** Calculate floating particle position */
let particleX: f32 = 0.0;
let particleY: f32 = 0.0;
let particleZ: f32 = 0.0;

export function calcFloatingParticle(baseX: f32, baseY: f32, baseZ: f32, time: f32, offset: f32, amplitude: f32): void {
  const t = time + offset;
  particleX = baseX + Mathf.sin(t * 0.5) * amplitude;
  particleY = baseY + Mathf.sin(t * 0.7) * amplitude * 0.5;
  particleZ = baseZ + Mathf.cos(t * 0.6) * amplitude;
}

export function getParticleX(): f32 { return particleX; }
export function getParticleY(): f32 { return particleY; }
export function getParticleZ(): f32 { return particleZ; }

// Generic calcFloatingY for compatibility if needed, or remove if unused in original
export function calcFloatingY(time: f32, offset: f32, baseHeight: f32): f32 {
    return baseHeight + Mathf.sin(time + offset) * 0.5;
}

// =============================================================================
// ARPEGGIO FUNCTIONS (Batch Processing Step)
// =============================================================================

let arpeggioUnfurlStep: f32 = 0.0;
let arpeggioTargetStep: f32 = 0.0;

/**
 * Calculates the Arpeggio State Machine logic
 * returns nothing (uses global getters to retrieve multiple values)
 *
 * Logic:
 * if (arpeggioActive) {
 *    if (noteTrigger && !lastTrigger) targetStep++
 * } else {
 *    targetStep = 0
 * }
 * lerp unfurlStep -> targetStep
 */
export function calcArpeggioStep(
    currentUnfurl: f32,
    currentTarget: f32,
    lastTrigger: i32,     // bool 0/1
    arpeggioActive: i32,  // bool 0/1
    noteTrigger: i32,     // bool 0/1
    maxSteps: f32
): void {
    let nextTarget = currentTarget;

    if (arpeggioActive != 0) {
        // Rising edge check
        if ((noteTrigger != 0) && (lastTrigger == 0)) {
            nextTarget = nextTarget + 1.0;
            if (nextTarget > maxSteps) nextTarget = maxSteps;
        }
    } else {
        nextTarget = 0.0;
    }

    // Smooth animate
    const speed: f32 = (nextTarget > currentUnfurl) ? 0.3 : 0.05;

    // Lerp
    const diff = nextTarget - currentUnfurl;
    const nextUnfurl = currentUnfurl + (diff * speed);

    // Store results
    arpeggioTargetStep = nextTarget;
    arpeggioUnfurlStep = nextUnfurl;
}

export function getArpeggioTargetStep(): f32 { return arpeggioTargetStep; }
export function getArpeggioUnfurlStep(): f32 { return arpeggioUnfurlStep; }

// =============================================================================
// BATCH FOLIAGE UPDATE (New Migration)
// =============================================================================

// Stride: 16 floats (64 bytes)
// 0: posX (in/out)
// 1: posY (in/out)
// 2: posZ (in/out)
// 3: rotX (in/out)
// 4: rotY (in/out)
// 5: rotZ (in/out)
// 6: scaleX (in/out)
// 7: scaleY (in/out)
// 8: scaleZ (in/out)
// 9: originalY (in)
// 10: animationType (in, int cast to float)
// 11: animationOffset (in)
// 12: intensity (in)
// 13: param1 (in/out - e.g. wobbleCurrent)
// 14: param2 (in/out)
// 15: param3 (in/out)

export function updateFoliageBatch(
    ptr: usize,
    count: i32,
    time: f32,
    beatPhase: f32,
    kick: f32,
    groove: f32,
    isDay: i32
): void {
    for (let i = 0; i < count; i++) {
        let offset = ptr + (<usize>i * 64);

        // Load Input Data
        let posX = load<f32>(offset + 0);
        let posY = load<f32>(offset + 4);
        let posZ = load<f32>(offset + 8);
        let rotX = load<f32>(offset + 12);
        let rotY = load<f32>(offset + 16);
        let rotZ = load<f32>(offset + 20);
        let scaleX = load<f32>(offset + 24);
        let scaleY = load<f32>(offset + 28);
        let scaleZ = load<f32>(offset + 32);

        let originalY = load<f32>(offset + 36);
        let animType = <i32>load<f32>(offset + 40);
        let animOffset = load<f32>(offset + 44);
        let intensity = load<f32>(offset + 48);
        let param1 = load<f32>(offset + 52); // wobbleCurrent or snapState

        let animTime = time + beatPhase;

        // Apply Logic based on Animation Type
        // 1: gentleSway
        // 2: bounce
        // 3: wobble
        // 4: hop
        // 5: shiver
        // 6: spring
        // 7: vineSway
        // 8: spiralWave
        // 9: float
        // 10: spin
        // 11: glowPulse
        // 12: cloudBob
        // 13: snareSnap
        // 14: accordionStretch

        if (animType == 1) { // gentleSway
             rotZ = Mathf.sin(time * 0.5 + animOffset) * 0.05 * intensity;
        }
        else if (animType == 2) { // bounce
             posY = originalY + Mathf.sin(animTime * 3.0 + animOffset) * 0.12 * intensity;
             if (isDay == 0 && kick > 0.12) posY += kick * 0.21;
        }
        else if (animType == 3) { // wobble
             // param1 is wobbleCurrent (smoothed median velocity) - usually passed in already smoothed
             let boost = param1;
             rotX = Mathf.sin(animTime * 3.0 + animOffset) * 0.15 * intensity * (1.0 + boost);
             rotZ = Mathf.cos(animTime * 3.0 + animOffset) * 0.16 * intensity * (1.0 + boost);
        }
        else if (animType == 4) { // hop
             let hopTime = animTime * 4.0 + animOffset;
             let bounce = Mathf.max(0.0, Mathf.sin(hopTime)) * 0.3 * intensity;
             posY = originalY + bounce;
             if (isDay == 0 && kick > 0.1) posY += kick * 0.15;
        }
        else if (animType == 5) { // shiver
             let shiver = Mathf.sin(animTime * 20.0 + animOffset) * 0.05 * intensity;
             rotZ = shiver;
             rotX = shiver * 0.5;
        }
        else if (animType == 6) { // spring
             let springTime = animTime * 5.0 + animOffset;
             scaleY = 1.0 + Mathf.sin(springTime) * 0.1 * intensity;
             scaleX = 1.0 - Mathf.sin(springTime) * 0.05 * intensity;
             scaleZ = 1.0 - Mathf.sin(springTime) * 0.05 * intensity;
        }
        else if (animType == 7) { // vineSway
             rotZ = Mathf.sin(time * 1.5 + animOffset) * 0.2 * intensity;
             rotX = Mathf.cos(time * 1.2 + animOffset) * 0.1 * intensity;
        }
        else if (animType == 9) { // float
             posY = originalY + Mathf.sin(time * 2.0 + animOffset) * 0.5 * intensity;
        }
        else if (animType == 10) { // spin
             rotY += 0.01 * intensity;
        }
        else if (animType == 11) { // glowPulse
             posY = originalY + Mathf.sin(time * 2.0 + animOffset) * 0.1;
        }
        else if (animType == 12) { // cloudBob
             posY = originalY + Mathf.sin(time * 0.5 + animOffset) * 0.3;
             rotY = Mathf.sin(time * 0.2 + animOffset * 0.5) * 0.05;
        }

        // Store Outputs
        store<f32>(offset + 0, posX);
        store<f32>(offset + 4, posY);
        store<f32>(offset + 8, posZ);
        store<f32>(offset + 12, rotX);
        store<f32>(offset + 16, rotY);
        store<f32>(offset + 20, rotZ);
        store<f32>(offset + 24, scaleX);
        store<f32>(offset + 28, scaleY);
        store<f32>(offset + 32, scaleZ);
    }
}

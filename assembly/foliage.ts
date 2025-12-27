
// assembly/foliage.ts

export function computeSway(count: i32, time: f32, offsets: usize, intensities: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // foliageObject.rotation.z = Math.sin(time + offset) * 0.11 * intensity;
    let val = Math.sin(time + offset) * 0.11 * intensity;

    store<f32>(outRotZ + (<usize>i << 2), val as f32);
  }
}

export function computeBounce(count: i32, time: f32, originalYs: usize, offsets: usize, intensities: usize, kick: f32, outPosY: usize): void {
  for (let i = 0; i < count; i++) {
    let originalY = load<f32>(originalYs + (<usize>i << 2));
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // Restore original logic: kick only applies if > 0.12
    let kickAmt = 0.0;
    if (kick > 0.12) {
       kickAmt = kick * 0.21;
    }

    // foliageObject.position.y = y + Math.sin(animTime * 3 + offset) * 0.12 * intensity;
    let bounce = Math.sin(time * 3.0 + offset) * 0.12 * intensity;
    let val = originalY + bounce + kickAmt;

    store<f32>(outPosY + (<usize>i << 2), val as f32);
  }
}

export function computeWobble(count: i32, time: f32, offsets: usize, intensities: usize, wobbleBoosts: usize, outRotX: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));
    let boost = load<f32>(wobbleBoosts + (<usize>i << 2));

    // rotX = sin(time * 3 + offset) * 0.15 * intensity * (1 + boost)
    // rotZ = cos(time * 3 + offset) * 0.16 * intensity * (1 + boost)

    let factor = intensity * (1.0 + boost);
    let valX = Math.sin(time * 3.0 + offset) * 0.15 * factor;
    let valZ = Math.cos(time * 3.0 + offset) * 0.16 * factor;

    store<f32>(outRotX + (<usize>i << 2), valX as f32);
    store<f32>(outRotZ + (<usize>i << 2), valZ as f32);
  }
}

export function computeSpiralWave(count: i32, time: f32, offsets: usize, intensities: usize, childCount: i32, outRotY: usize): void {
    // Skipping for now
}

export function computeGentleSway(count: i32, time: f32, offsets: usize, intensities: usize, outRotZ: usize): void {
  for (let i = 0; i < count; i++) {
    let offset = load<f32>(offsets + (<usize>i << 2));
    let intensity = load<f32>(intensities + (<usize>i << 2));

    // rotZ = sin(time * 0.5 + offset) * 0.05 * intensity
    let val = Math.sin(time * 0.5 + offset) * 0.05 * intensity;

    store<f32>(outRotZ + (<usize>i << 2), val as f32);
  }
}

export function computeHop(count: i32, time: f32, originalYs: usize, offsets: usize, intensities: usize, kick: f32, outPosY: usize): void {
  for (let i = 0; i < count; i++) {
     let originalY = load<f32>(originalYs + (<usize>i << 2));
     let offset = load<f32>(offsets + (<usize>i << 2));
     let intensity = load<f32>(intensities + (<usize>i << 2));

     // Restore original logic: kick only applies if > 0.1
     let kickAmt = 0.0;
     if (kick > 0.1) {
        kickAmt = kick * 0.15;
     }

     // hopTime = time * 4 + offset
     // bounce = max(0, sin(hopTime)) * 0.3 * intensity
     let hopTime = time * 4.0 + offset;
     let bounce = Math.sin(hopTime);
     if (bounce < 0) bounce = 0;
     bounce = bounce * 0.3 * intensity;

     let val = originalY + bounce + kickAmt;
     store<f32>(outPosY + (<usize>i << 2), val as f32);
  }
}

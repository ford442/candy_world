// assembly/particles.ts
import { calcRainDropY } from './animation';

// Constants for strides
const STRIDE_F32 = 4;

// Math.random() is available in AssemblyScript
// but we might want a seeded random if we want determinism,
// for now standard random is fine as it maps to JS Math.random

// updateRainBatch
// positionsPtr: pointer to Float32Array of positions (x, y, z)
// velocitiesPtr: pointer to Float32Array of velocities
// offsetsPtr: pointer to Float32Array of offsets
// count: number of particles
// time: current time
// bassIntensity: current bass intensity
// weatherState: 0=clear, 1=rain, 2=storm (used for logic if needed, currently unused in math)
// intensity: current weather intensity (0.0 - 1.0)
export function updateRainBatch(
    positionsPtr: usize,
    velocitiesPtr: usize,
    offsetsPtr: usize,
    count: i32,
    time: f32,
    bassIntensity: f32
): void {
    for (let i = 0; i < count; i++) {
        // Load offset
        let offsetVal = load<f32>(offsetsPtr + <usize>(i * STRIDE_F32));

        // Load velocity
        let velocityVal = load<f32>(velocitiesPtr + <usize>(i * STRIDE_F32));

        // Load position Y (index 1)
        let posIndex = <usize>(i * 3 * STRIDE_F32);
        let currentY = load<f32>(positionsPtr + posIndex + STRIDE_F32); // y is at +4 bytes

        let startY = 50.0 + offsetVal;
        let speed = velocityVal * (1.0 + bassIntensity);

        let cycleHeight = 50.0;
        let totalDrop = time * speed;
        let cycled = totalDrop % cycleHeight;
        let newY = startY - cycled;

        store<f32>(positionsPtr + posIndex + STRIDE_F32, <f32>newY);

        if (newY < 0.0) {
             let rx = (Math.random() - 0.5) * 100.0;
             let rz = (Math.random() - 0.5) * 100.0;
             store<f32>(positionsPtr + posIndex, <f32>rx);
             store<f32>(positionsPtr + posIndex + (2 * STRIDE_F32), <f32>rz);
        }
    }
}

// updateMelodicMistBatch
// positionsPtr: pointer to positions
// count: number of particles
// time: current time
// melodyVol: melody volume
export function updateMelodicMistBatch(
    positionsPtr: usize,
    count: i32,
    time: f32,
    melodyVol: f32
): void {
    let volFactor = Math.max(melodyVol, 0.3) * 2.0;

    for (let i = 0; i < count; i++) {
        let offset = <f32>i * 0.1;

        let yVal = 1.0 + Math.sin(time + offset) * volFactor;

        let posIndex = <usize>(i * 3 * STRIDE_F32);

        // Read current X and Z to add to them
        let currentX = load<f32>(positionsPtr + posIndex);
        let currentZ = load<f32>(positionsPtr + posIndex + (2 * STRIDE_F32));

        let dx = Math.sin(time * 0.5 + offset) * 0.01;
        let dz = Math.cos(time * 0.4 + offset) * 0.01;

        store<f32>(positionsPtr + posIndex, currentX + <f32>dx);
        store<f32>(positionsPtr + posIndex + STRIDE_F32, <f32>yVal);
        store<f32>(positionsPtr + posIndex + (2 * STRIDE_F32), currentZ + <f32>dz);
    }
}

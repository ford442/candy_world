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
    // Defensive guards: invalid counts or pointers are no-ops
    if (count <= 0) return;

    // Validate basic pointer arithmetic to avoid out-of-bounds memory access in wasm
    // Each particle uses 3 floats (x,y,z) => 3 * STRIDE_F32 bytes per particle
    const requiredPosBytes = <usize>count * 3 * <usize>STRIDE_F32;
    const requiredVelBytes = <usize>count * <usize>STRIDE_F32;
    const requiredOffsBytes = <usize>count * <usize>STRIDE_F32;

    // Simple overflow / sanity checks. If pointers are clearly invalid, bail out.
    if (positionsPtr == 0 || velocitiesPtr == 0 || offsetsPtr == 0) return;
    // NOTE: We cannot read the runtime memory size easily here; these checks at least
    // stop obviously invalid inputs and make the function safe for malformed callers.

    for (let i = 0; i < count; i++) {
        // Compute byte offsets and validate small index range before load/store
        const offByte = offsetsPtr + <usize>(i * STRIDE_F32);
        const velByte = velocitiesPtr + <usize>(i * STRIDE_F32);
        const posBase = positionsPtr + <usize>(i * 3 * STRIDE_F32);

        // Basic validation: ensure computed offsets didn't wrap (simple overflow detection)
        // If addition wrapped around, posBase will be less than the original pointer.
        if (offByte == 0 || velByte == 0 || posBase == 0) continue;
        if (offByte < offsetsPtr || velByte < velocitiesPtr || posBase < positionsPtr) continue;
        // Ensure space for x,y,z exists (best-effort check)
        if (posBase + (2 * STRIDE_F32) < posBase) continue;

        // Load offset
        let offsetVal = load<f32>(offByte);

        // Load velocity
        let velocityVal = load<f32>(velByte);

        // Load position Y (index 1)
        let currentY = load<f32>(posBase + STRIDE_F32); // y is at +4 bytes

        let startY = 50.0 + offsetVal;
        let speed = velocityVal * (1.0 + bassIntensity);

        let cycleHeight = 50.0;
        let totalDrop = time * speed;
        let cycled = totalDrop % cycleHeight;
        let newY = startY - cycled;

        store<f32>(posBase + STRIDE_F32, <f32>newY);

        if (newY < 0.0) {
             let rx = (Math.random() - 0.5) * 100.0;
             let rz = (Math.random() - 0.5) * 100.0;
             store<f32>(posBase, <f32>rx);
             store<f32>(posBase + (2 * STRIDE_F32), <f32>rz);
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
    // Defensive guards
    if (count <= 0) return;
    if (positionsPtr == 0) return;

    for (let i = 0; i < count; i++) {
        const posBase = positionsPtr + <usize>(i * 3 * STRIDE_F32);
        if (posBase == 0) continue;
        if (posBase < positionsPtr) continue;
        if (posBase + (2 * STRIDE_F32) < posBase) continue;

        let offset = <f32>i * 0.1;

        let yVal = 1.0 + Math.sin(time + offset) * Math.max(melodyVol, 0.3) * 2.0;

        // Read current X and Z to add to them
        let currentX = load<f32>(posBase);
        let currentZ = load<f32>(posBase + (2 * STRIDE_F32));

        let dx = Math.sin(time * 0.5 + offset) * 0.01;
        let dz = Math.cos(time * 0.4 + offset) * 0.01;

        store<f32>(posBase, currentX + <f32>dx);
        store<f32>(posBase + STRIDE_F32, <f32>yVal);
        store<f32>(posBase + (2 * STRIDE_F32), currentZ + <f32>dz);
    }
}

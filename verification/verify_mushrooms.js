
import { createMushroom, getMaterialCacheSize } from '../src/foliage/mushrooms.js';

export function runMushroomVerification() {
    console.log("🍄 Starting Mushroom Verification...");

    const initialCacheSize = getMaterialCacheSize();
    console.log(`Initial Cache Size: ${initialCacheSize}`);

    // Create 50 C-major mushrooms (Regular)
    console.log("Creating 50 C-Regular mushrooms...");
    for (let i = 0; i < 50; i++) {
        createMushroom({ noteIndex: 0, size: 'regular' });
    }
    console.log(`Cache Size after 50 C-Reg: ${getMaterialCacheSize()}`);

    // Create 50 C-major mushrooms (Giant)
    console.log("Creating 50 C-Giant mushrooms...");
    for (let i = 0; i < 50; i++) {
        createMushroom({ noteIndex: 0, size: 'giant' });
    }
    console.log(`Cache Size after 50 C-Giant: ${getMaterialCacheSize()}`);

    // Create 1 of each note (Regular)
    console.log("Creating 1 of each note (Regular)...");
    for (let i = 0; i < 12; i++) {
        createMushroom({ noteIndex: i, size: 'regular' });
    }

    // Create 1 of each note (Giant)
    console.log("Creating 1 of each note (Giant)...");
    for (let i = 0; i < 12; i++) {
        createMushroom({ noteIndex: i, size: 'giant' });
    }

    const finalSize = getMaterialCacheSize();
    console.log(`Final Cache Size: ${finalSize}`);

    // Expected:
    // Caps: 12 notes * 2 sizes = 24
    // Gills: 12 notes = 12
    // Total: 36

    if (finalSize <= 36) {
        console.log("✅ VERIFICATION PASSED: Material cache is within expected limits.");
    } else {
        console.error(`❌ VERIFICATION FAILED: Cache size ${finalSize} exceeds expected limit (36).`);
    }
}

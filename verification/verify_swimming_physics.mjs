/**
 * verify_swimming_physics.mjs
 * Validates swimming physics correctness in physics.ts:
 * 1. Gravity is subtracted (pulls player down), not added
 * 2. Drag multiplier is clamped to prevent velocity reversal on large delta
 * 3. Gravity direction is consistent with the rest of the physics system
 */

import fs from 'fs';
import path from 'path';

const physicsFile = path.join(process.cwd(), 'src/systems/physics.ts');

console.log('=== Swimming Physics Verification ===\n');
console.log(`Reading: ${physicsFile}`);

let content;
try {
    content = fs.readFileSync(physicsFile, 'utf-8');
} catch (err) {
    console.error(`Failed to read file: ${err.message}`);
    process.exit(1);
}

let allPassed = true;

function check(name, pass, detail) {
    if (pass) {
        console.log(`  PASS: ${name}`);
    } else {
        console.error(`  FAIL: ${name} - ${detail}`);
        allPassed = false;
    }
}

// --- Test 1: Swimming gravity direction ---
// The swimming state must subtract gravity (velocity.y -= ...) not add it.
// Adding gravity would push the player upward instead of pulling them down.

const swimmingSection = content.match(
    /function updateSwimmingState[\s\S]*?^}/m
);

if (!swimmingSection) {
    console.error('FAIL: Could not find updateSwimmingState function');
    process.exit(1);
}

const swimmingCode = swimmingSection[0];

// Gravity must be subtracted
const hasCorrectGravity = /velocity\.y\s*-=\s*\(?SWIMMING_GRAVITY/.test(swimmingCode);
const hasInvertedGravity = /velocity\.y\s*\+=\s*\(?SWIMMING_GRAVITY/.test(swimmingCode);

check(
    'Swimming gravity is subtracted (pulls player down)',
    hasCorrectGravity && !hasInvertedGravity,
    hasInvertedGravity
        ? 'Gravity is ADDED to velocity.y, which pushes the player upward'
        : 'Could not find SWIMMING_GRAVITY application in updateSwimmingState'
);

// --- Test 2: Drag multiplier is clamped ---
// Without clamping, (1.0 - SWIMMING_DRAG * delta) can go negative on large
// delta values (e.g., after a browser tab switch), reversing velocity direction.

const hasDragClamp = /Math\.max\s*\(\s*0\s*,\s*1\.0\s*-\s*\(?SWIMMING_DRAG\s*\*\s*delta\)?/.test(swimmingCode);
const hasUnclampedDrag = /multiplyScalar\s*\(\s*1\.0\s*-\s*\(?SWIMMING_DRAG\s*\*\s*delta\)?\s*\)/.test(swimmingCode);

check(
    'Swimming drag multiplier is clamped to prevent velocity reversal',
    hasDragClamp && !hasUnclampedDrag,
    hasUnclampedDrag
        ? 'Drag factor is not clamped - can go negative on large delta'
        : 'Could not find drag application in updateSwimmingState'
);

// --- Test 3: Gravity direction consistency ---
// All gravity applications in the file should subtract from velocity.y.
// This catches any future regressions where gravity is accidentally added.

const gravityAdds = content.match(/velocity\.y\s*\+=\s*.*(?:GRAVITY|gravity)/gi) || [];
const gravitySubtracts = content.match(/velocity\.y\s*-=\s*.*(?:GRAVITY|gravity)/gi) || [];

// Filter out false positives (jump forces, swim up/down controls)
const suspiciousAdds = gravityAdds.filter(line =>
    !line.includes('jump') && !line.includes('Jump')
);

check(
    'No gravity additions found (all gravity subtracts from velocity.y)',
    suspiciousAdds.length === 0,
    `Found ${suspiciousAdds.length} gravity addition(s): ${suspiciousAdds.join(', ')}`
);

check(
    'At least one gravity subtraction exists',
    gravitySubtracts.length > 0,
    'No gravity subtractions found - physics may be broken'
);

// --- Test 4: SWIMMING_GRAVITY constant is positive ---
// The constant should be positive; the subtraction operator handles direction.

const gravityConstMatch = content.match(/const\s+SWIMMING_GRAVITY\s*=\s*([\d.]+)/);
if (gravityConstMatch) {
    const value = parseFloat(gravityConstMatch[1]);
    check(
        'SWIMMING_GRAVITY constant is positive',
        value > 0,
        `SWIMMING_GRAVITY = ${value} (should be positive, direction handled by -= operator)`
    );
} else {
    check('SWIMMING_GRAVITY constant exists', false, 'Could not find SWIMMING_GRAVITY constant');
}

// --- Summary ---
console.log('');
if (allPassed) {
    console.log('All swimming physics checks passed.');
    process.exit(0);
} else {
    console.error('Some swimming physics checks FAILED.');
    process.exit(1);
}


import fs from 'fs';
import path from 'path';

function verifyFileContent(filePath, checks) {
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    let allPassed = true;
    for (const check of checks) {
        if (!content.includes(check)) {
            console.error(`❌ Missing in ${filePath}: "${check}"`);
            allPassed = false;
        } else {
            console.log(`✅ Found in ${filePath}: "${check.substring(0, 50)}..."`);
        }
    }
    return allPassed;
}

const checks = [
    {
        file: 'src/systems/unlocks.ts',
        patterns: [
            'public consume(itemId: string, amount: number = 1): boolean',
            'this.inventory[itemId] -= amount;'
        ]
    },
    {
        file: 'src/foliage/flowers.ts',
        patterns: [
            'group.userData.interactionText = "Harvest Tremolo Bulb"',
            'unlockSystem.harvest(\'tremolo_bulb\', 1, \'Tremolo Bulb\')'
        ]
    },
    {
        file: 'src/core/input.ts',
        patterns: [
            'phase: boolean;',
            'case \'KeyZ\': keyStates.phase = true;'
        ]
    },
    {
        file: 'src/systems/physics.ts',
        patterns: [
            'isPhasing: boolean;',
            'if (unlockSystem.consume(\'tremolo_bulb\', 1))',
            'player.isPhasing = true;',
            'showToast("Phase Shift Active! 👻", "👻");'
        ]
    }
];

let success = true;
for (const check of checks) {
    if (!verifyFileContent(check.file, check.patterns)) {
        success = false;
    }
}

if (success) {
    console.log("🎉 All checks passed!");
    process.exit(0);
} else {
    console.error("❌ Verification failed.");
    process.exit(1);
}

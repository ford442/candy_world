import fs from 'fs';
import path from 'path';

const unlocksPath = path.join(process.cwd(), 'src/systems/unlocks.ts');
const floraPath = path.join(process.cwd(), 'src/foliage/musical_flora.ts');

console.log(`Checking implementation...`);

let allPassed = true;

function checkFile(filePath, checks) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        allPassed = false;
        return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            console.log(`✅ ${check.name} passed.`);
        } else {
            console.error(`❌ ${check.name} failed: ${check.error}`);
            allPassed = false;
        }
    });
}

// 1. Verify UnlockSystem
checkFile(unlocksPath, [
    {
        name: "UnlockSystem Class Definition",
        pattern: /class UnlockSystem/,
        error: "UnlockSystem class not defined."
    },
    {
        name: "Harvest Method",
        pattern: /public harvest\(itemId: string/,
        error: "harvest() method missing."
    },
    {
        name: "Persistence Logic",
        pattern: /localStorage\.setItem/,
        error: "localStorage saving logic missing."
    },
    {
        name: "Unlock Check Logic",
        pattern: /checkUnlocks\(\)/,
        error: "checkUnlocks() method missing."
    },
    {
        name: "Definition Export",
        pattern: /export const UNLOCK_DEFINITIONS/,
        error: "UNLOCK_DEFINITIONS not exported."
    }
]);

// 2. Verify Integration in Musical Flora
checkFile(floraPath, [
    {
        name: "UnlockSystem Import",
        pattern: /import \{ unlockSystem \} from '\.\.\/systems\/unlocks\.js'/,
        error: "UnlockSystem not imported in musical_flora.ts"
    },
    {
        name: "Harvest Call in Arpeggio Fern",
        pattern: /unlockSystem\.harvest\('fern_core'/,
        error: "harvest('fern_core') call missing in createArpeggioFern"
    },
    {
        name: "Unfurl Condition",
        pattern: /unfurl > 0\.8/,
        error: "Unfurl condition (> 0.8) missing."
    },
    {
        name: "Harvested Flag Check",
        pattern: /!group\.userData\.harvested/,
        error: "Harvested flag check missing."
    }
]);

if (allPassed) {
    console.log("\n🎉 All unlock system checks passed!");
    process.exit(0);
} else {
    console.error("\n💥 Some checks failed.");
    process.exit(1);
}

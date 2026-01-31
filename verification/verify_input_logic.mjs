import fs from 'fs';
import path from 'path';

const inputFilePath = path.join(process.cwd(), 'src/core/input.ts');

console.log(`Checking ${inputFilePath}...`);

try {
    const content = fs.readFileSync(inputFilePath, 'utf-8');

    const checks = [
        {
            name: "Variable Definition",
            pattern: /let wasPausedBeforePlaylist = false;/,
            error: "Missing 'wasPausedBeforePlaylist' definition."
        },
        {
            name: "State Capture Logic",
            // Allow for JS (&&) or TS (ternary with null check) styles
            pattern: /wasPausedBeforePlaylist = instructions.*display !== 'none'/,
            error: "Missing logic to capture pause state."
        },
        {
            name: "Conditional Restoration Logic",
            pattern: /if \(wasPausedBeforePlaylist\) \{[\s\S]*?instructions\.style\.display = 'flex';/,
            error: "Missing logic to restore pause menu."
        },
        {
            name: "Focus Restoration",
            // Allow for TS casting (lastFocusedElement as HTMLElement).focus()
            pattern: /if \(lastFocusedElement\) \{[\s\S]*?(\(lastFocusedElement as HTMLElement\)|lastFocusedElement)\.focus\(\);/,
            error: "Missing logic to restore focus."
        }
    ];

    let allPassed = true;

    checks.forEach(check => {
        if (check.pattern.test(content)) {
            console.log(`✅ ${check.name} passed.`);
        } else {
            console.error(`❌ ${check.name} failed: ${check.error}`);
            allPassed = false;
        }
    });

    if (allPassed) {
        console.log("\n🎉 All logic checks passed!");
        process.exit(0);
    } else {
        console.error("\n💥 Some checks failed.");
        process.exit(1);
    }

} catch (err) {
    console.error(`Error reading file: ${err.message}`);
    process.exit(1);
}

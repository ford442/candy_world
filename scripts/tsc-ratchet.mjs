import { execSync } from 'child_process';
import * as fs from 'fs';

const BASELINE_FILE = 'scripts/tsc-baseline.json';

function runTypeCheck() {
    try {
        const output = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
        return { success: true, count: 0, output };
    } catch (error) {
        const output = error.stdout.toString();
        // Count lines that start with "src/" and have ": error TS"
        const count = output.split('\n').filter(line => line.match(/^src\/.*: error TS/)).length;
        return { success: false, count, output };
    }
}

function updateBaseline(count) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ errors: count }, null, 2));
    console.log(`Updated baseline to ${count} errors.`);
}

function main() {
    let baseline = { errors: 1000000 };
    if (fs.existsSync(BASELINE_FILE)) {
        baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    } else {
        updateBaseline(587); // Baseline from #1347 issue
        baseline = { errors: 587 };
    }

    console.log(`Running type check...`);
    const { success, count, output } = runTypeCheck();

    console.log(`Current errors: ${count}`);
    console.log(`Baseline errors: ${baseline.errors}`);

    if (count > baseline.errors) {
        console.error(`\n❌ Type check error count (${count}) exceeds the baseline (${baseline.errors}).`);
        console.error(`Please fix the new TypeScript errors you introduced:\n`);
        console.error(output);
        process.exit(1);
    } else if (count < baseline.errors) {
        console.log(`\n🎉 You reduced the number of TypeScript errors! Ratcheting down...`);
        updateBaseline(count);
    } else {
        console.log(`\n✅ Type check error count matches the baseline.`);
    }

    if (success) {
        console.log(`\n✨ Perfect type check! No errors found.`);
    }
}

main();

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(__dirname, 'raw-keys-baseline.json');
const update = process.argv.includes('--update');

const reportFile = join(tmpdir(), `candy-eslint-raw-keys-${process.pid}.json`);
let results = [];
try {
    try {
        execSync(`npx eslint src --format json -o ${JSON.stringify(reportFile)}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch {
        // ESLint exits non-zero when problems exist; JSON is still written to -o path.
    }
    results = JSON.parse(readFileSync(reportFile, 'utf8') || '[]');
} catch (err) {
    console.error('Failed to run or parse ESLint:', err);
    process.exit(1);
} finally {
    try {
        unlinkSync(reportFile);
    } catch {
        /* ignore */
    }
}

let count = 0;
let filesWithIssues = [];
results.forEach(f => {
    let hits = f.messages.filter(m => m.ruleId === 'no-restricted-syntax' && m.message.includes('Global key listeners belong'));
    if (hits.length > 0) {
        count += hits.length;
        filesWithIssues.push(f.filePath.replace(process.cwd() + '/', ''));
    }
});
filesWithIssues.sort();

let baseline = { maxProblems: 26, files: [] };
if (existsSync(baselinePath)) {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
}

if (update) {
    if (count > baseline.maxProblems && existsSync(baselinePath)) {
        console.error('Refusing to raise the baseline with --update.');
        process.exit(1);
    }
    writeFileSync(
        baselinePath,
        JSON.stringify({ maxProblems: count, updatedAt: new Date().toISOString().slice(0, 10), files: filesWithIssues }, null, 2) + '\n'
    );
    console.log(`Baseline written: ${count}.`);
    process.exit(0);
}

const delta = count - baseline.maxProblems;
console.log(`Raw key listeners: ${count} — baseline: ${baseline.maxProblems}, delta: ${delta >= 0 ? '+' : ''}${delta}`);

if (count > baseline.maxProblems) {
    console.error(`\n❌ Raw key listener ratchet FAILED: ${count} exceeds baseline of ${baseline.maxProblems} by ${delta}.`);
    console.error('Remove raw key listeners outside src/core/input/ to fix this.');
    process.exit(1);
} else if (count < baseline.maxProblems) {
    console.log(`\n🎉 Down ${-delta} from the baseline. Lock it in: npm run check:raw-keys -- --update, and commit scripts/raw-keys-baseline.json.`);
    process.exit(1); // Fail to force an update.
} else {
    // Check if the files match exactly to prevent allowing new files while fixing old ones
    let baselineFiles = baseline.files || [];
    let addedFiles = filesWithIssues.filter(f => !baselineFiles.includes(f));
    if (addedFiles.length > 0) {
        console.error(`\n❌ Raw key listener ratchet FAILED: New files with global key listeners added:`);
        addedFiles.forEach(f => console.error(`  - ${f}`));
        console.error('Remove raw key listeners outside src/core/input/ to fix this.');
        process.exit(1);
    }
    console.log('\n✅ Ratchet passed — count matches baseline.');
    process.exit(0);
}

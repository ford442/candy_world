#!/usr/bin/env node
/**
 * ESLint problem-count ratchet for candy_world.
 * Counts warnings + errors from `eslint --format json` and fails if count exceeds baseline.
 *
 * The baseline is only written on request, never as a side effect of a passing
 * run: a lower count passes and prints the command that locks it in. (It used
 * to rewrite scripts/eslint-baseline.json on every downward run, including in
 * CI where the write goes nowhere, and dirtied every local checkout.)
 *
 * Usage:
 *   npm run lint                           gate
 *   npm run lint -- --update               lower the baseline to the current count
 *   npm run lint -- --set-baseline <n>     write <n> without running ESLint
 *   npm run lint -- --report-only          never fail (CI artifacts)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(__dirname, 'eslint-baseline.json');
const reportOnly = process.argv.includes('--report-only');
const update = process.argv.includes('--update');

function writeBaseline(maxProblems) {
    writeFileSync(
        baselinePath,
        JSON.stringify({ maxProblems, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2) +
            '\n'
    );
    console.log(`Baseline written: ${maxProblems}.`);
}

// Explicit write: handled before the gate so it cannot be skipped by a failing run.
if (process.argv.includes('--set-baseline')) {
    const idx = process.argv.indexOf('--set-baseline');
    const newCount = parseInt(process.argv[idx + 1], 10);
    if (!Number.isFinite(newCount) || newCount < 0) {
        console.error('Usage: node scripts/eslint-ratchet.mjs --set-baseline <count>');
        process.exit(1);
    }
    writeBaseline(newCount);
    process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const maxProblems = baseline.maxProblems;

const reportFile = join(tmpdir(), `candy-eslint-${process.pid}.json`);
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
    process.exit(reportOnly ? 0 : 1);
} finally {
    try {
        unlinkSync(reportFile);
    } catch {
        /* ignore */
    }
}

const count = results.reduce(
    (sum, file) => sum + (file.errorCount ?? 0) + (file.warningCount ?? 0),
    0
);
const errors = results.reduce((sum, file) => sum + (file.errorCount ?? 0), 0);
const warnings = results.reduce((sum, file) => sum + (file.warningCount ?? 0), 0);
const delta = count - maxProblems;

console.log(
    `ESLint problems: ${count} (${errors} errors, ${warnings} warnings) — baseline: ${maxProblems}, delta: ${delta >= 0 ? '+' : ''}${delta}`
);

if (update) {
    if (count > maxProblems) {
        console.error('Refusing to raise the baseline with --update; use --set-baseline <n>.');
        process.exit(1);
    }
    writeBaseline(count);
    process.exit(0);
}

if (count > maxProblems) {
    const msg = `\n❌ ESLint ratchet FAILED: ${count} problems exceeds baseline of ${maxProblems} by ${delta}.`;
    if (reportOnly) {
        console.warn(msg);
        console.warn('(report-only mode — not failing CI)');
    } else {
        console.error(msg);
        console.error('Fix new lint issues or revert the regression before merging.');
        process.exit(1);
    }
} else if (count < maxProblems) {
    console.log(
        `\n🎉 Down ${-delta} from the baseline. Lock it in: npm run lint -- --update, and commit scripts/eslint-baseline.json.`
    );
} else {
    console.log('\n✅ Ratchet passed — count matches baseline.');
}

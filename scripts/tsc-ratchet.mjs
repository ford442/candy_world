#!/usr/bin/env node
/**
 * TypeScript error-count ratchet. Fails if `tsc --noEmit` reports more errors
 * than scripts/tsc-baseline.json.
 *
 * Every `error TSnnnn` line counts, wherever it points: a tsconfig error
 * (`tsconfig.json(3,5): error TS5023`) or a global one (`error TS6053`) stops
 * the program from being checked at all, so it must never read as zero. A
 * non-zero tsc exit with no parseable error line fails too.
 *
 * The baseline is only written by `--update`; a lower count passes and says
 * how to lock it in, so a local run never dirties the tree.
 *
 * Usage:
 *   npm run typecheck                 gate
 *   npm run typecheck -- --update     lower the baseline to the current count
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(rootDir, 'scripts', 'tsc-baseline.json');
const update = process.argv.includes('--update');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

console.log('Running tsc --noEmit...');
const tsc = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
});
if (tsc.error) {
    console.error('typecheck: could not run tsc:', tsc.error);
    process.exit(1);
}
const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
const errorLines = output.split('\n').filter((line) => /\berror TS\d+:/.test(line));
const count = errorLines.length;

if (tsc.status !== 0 && count === 0) {
    console.error(`typecheck: tsc exited ${tsc.status} without a parseable error:\n${output}`);
    process.exit(1);
}

console.log(`TypeScript errors: ${count} (baseline ${baseline.errors})`);

if (update) {
    if (count > baseline.errors) {
        console.error('typecheck: refusing to raise the baseline. Fix the new errors.');
        process.exit(1);
    }
    writeFileSync(baselinePath, JSON.stringify({ errors: count }, null, 2) + '\n');
    console.log(`Baseline written: ${count}.`);
    process.exit(0);
}

if (count > baseline.errors) {
    console.error(`\n❌ ${count} TypeScript errors exceeds the baseline of ${baseline.errors}:\n`);
    console.error(errorLines.join('\n'));
    process.exit(1);
}
if (count < baseline.errors) {
    console.log(
        `\n🎉 Down from ${baseline.errors}. Lock it in: npm run typecheck -- --update, and commit scripts/tsc-baseline.json.`
    );
} else {
    console.log('\n✅ Type check error count matches the baseline.');
}

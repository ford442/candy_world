#!/usr/bin/env node
/**
 * TypeScript error-count ratchet for candy_world.
 * Runs `tsc --noEmit`, counts `error TS####` lines, and fails if count exceeds baseline.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(__dirname, 'tsc-baseline.json');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const maxErrors = baseline.maxErrors;

let output = '';
try {
  execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (err) {
  output = (err.stdout ?? '') + (err.stderr ?? '');
}

const errorLines = output.split('\n').filter((line) => /error TS\d+/.test(line));
const count = errorLines.length;
const delta = count - maxErrors;

console.log(`TypeScript errors: ${count} (baseline: ${maxErrors}, delta: ${delta >= 0 ? '+' : ''}${delta})`);

if (count > maxErrors) {
  console.error(`\n❌ Ratchet FAILED: ${count} errors exceeds baseline of ${maxErrors} by ${delta}.`);
  console.error('Fix the new errors or revert the regression before merging.');
  process.exit(1);
}

if (count < maxErrors) {
  const lowered = maxErrors - count;
  console.log(`\n✅ Ratchet passed — count is ${lowered} below baseline.`);
  console.log(`To lower the baseline, run:`);
  console.log(`  node scripts/tsc-ratchet.mjs --set-baseline ${count}`);
  console.log(`Then commit scripts/tsc-baseline.json with the new maxErrors value.`);
} else {
  console.log('\n✅ Ratchet passed — count matches baseline.');
}

if (process.argv.includes('--set-baseline')) {
  const idx = process.argv.indexOf('--set-baseline');
  const newCount = parseInt(process.argv[idx + 1], 10);
  if (!Number.isFinite(newCount) || newCount < 0) {
    console.error('Usage: node scripts/tsc-ratchet.mjs --set-baseline <count>');
    process.exit(1);
  }
  writeFileSync(
    baselinePath,
    JSON.stringify({ maxErrors: newCount, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'
  );
  console.log(`Baseline updated to ${newCount}.`);
  process.exit(0);
}
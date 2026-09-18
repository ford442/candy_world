#!/usr/bin/env node
/**
 * Circular dependency ratchet for candy_world.
 * Counts runtime circular dependency chains reachable from src/core/main.ts
 * (via madge, ignoring type-only imports) and fails if the count exceeds baseline.
 *
 * Report-only mode (--report-only): always exits 0, prints summary for CI artifacts.
 */
import madge from 'madge';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const baselinePath = join(__dirname, 'cycles-baseline.json');
const reportOnly = process.argv.includes('--report-only');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const maxCycles = baseline.maxCycles;

const res = await madge(join(rootDir, 'src/core/main.ts'), {
    tsConfig: join(rootDir, 'tsconfig.json'),
    fileExtensions: ['ts', 'tsx'],
    detectiveOptions: {
        ts: { skipTypeImports: true },
    },
});

const cycles = res.circular();
const count = cycles.length;
const delta = count - maxCycles;

console.log(
    `Circular dependencies: ${count} — baseline: ${maxCycles}, delta: ${delta >= 0 ? '+' : ''}${delta}`
);

if (count > maxCycles) {
    const msg = `\n❌ Circular dependency ratchet FAILED: ${count} cycles exceeds baseline of ${maxCycles} by ${delta}.`;
    if (reportOnly) {
        console.warn(msg);
        console.warn('(report-only mode — not failing CI)');
    } else {
        console.error(msg);
        console.error(
            'New circular dependencies were introduced. Break the cycle instead of widening the baseline:\n'
        );
        cycles.forEach((cycle, i) => console.error(`  ${i + 1}. ${cycle.join(' -> ')}`));
        process.exit(1);
    }
} else if (count < maxCycles) {
    console.log(
        `\n🎉 You reduced circular dependencies! Ratcheting down ${maxCycles} -> ${count}...`
    );
    writeFileSync(
        baselinePath,
        JSON.stringify(
            { maxCycles: count, updatedAt: new Date().toISOString().slice(0, 10) },
            null,
            2
        ) + '\n'
    );
    console.log(`Baseline updated to ${count}.`);
} else {
    console.log('\n✅ Ratchet passed — count matches baseline.');
}

if (process.argv.includes('--set-baseline')) {
    const idx = process.argv.indexOf('--set-baseline');
    const newCount = parseInt(process.argv[idx + 1], 10);
    if (!Number.isFinite(newCount) || newCount < 0) {
        console.error('Usage: node scripts/cycles-ratchet.mjs --set-baseline <count>');
        process.exit(1);
    }
    writeFileSync(
        baselinePath,
        JSON.stringify(
            { maxCycles: newCount, updatedAt: new Date().toISOString().slice(0, 10) },
            null,
            2
        ) + '\n'
    );
    console.log(`Baseline updated to ${newCount}.`);
    process.exit(0);
}

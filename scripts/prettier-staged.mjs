#!/usr/bin/env node
/** Format only staged files (pre-commit hook helper). */
import { execSync } from 'node:child_process';

const files = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f && /\.(ts|tsx|js|mjs|cjs|json|css|md|yml|yaml)$/.test(f));

if (files.length === 0) process.exit(0);

execSync(`pnpm exec prettier --write ${files.map((f) => JSON.stringify(f)).join(' ')}`, {
    stdio: 'inherit',
});

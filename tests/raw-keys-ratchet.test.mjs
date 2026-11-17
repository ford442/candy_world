/**
 * scripts/check-raw-keys.mjs: lower passes (like eslint-ratchet), equal passes,
 * higher fails, a file outside the baseline fails even when the count is lower,
 * and --update never raises the baseline.
 *
 * Run: pnpm run test:gate-fixes
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/check-raw-keys.mjs');
const dir = mkdtempSync(join(tmpdir(), 'raw-keys-'));
const MSG = 'Global key listeners belong in src/core/input/';
const report = (files) =>
    files.map((f) => ({
        filePath: join(process.cwd(), f),
        messages: [{ ruleId: 'no-restricted-syntax', message: MSG }],
    }));

function run(name, baselineFiles, reportFiles, extra = []) {
    const b = join(dir, `${name}-baseline.json`);
    const r = join(dir, `${name}-report.json`);
    writeFileSync(b, JSON.stringify({ maxProblems: baselineFiles.length, files: baselineFiles }));
    writeFileSync(r, JSON.stringify(report(reportFiles)));
    const res = spawnSync('node', [SCRIPT, '--baseline', b, '--report', r, ...extra], {
        encoding: 'utf8',
    });
    return { ...res, baseline: JSON.parse(readFileSync(b, 'utf8')) };
}

const A = 'src/a.ts',
    B = 'src/b.ts',
    C = 'src/c.ts';
let n = 0;
const ok = (m) => console.log(`  ok ${++n} - ${m}`);

assert.equal(run('equal', [A, B], [A, B]).status, 0);
ok('equal passes');
const down = run('down', [A, B], [A]);
assert.equal(down.status, 0, down.stdout + down.stderr);
assert.match(down.stdout, /Lock it in/);
ok('improvement passes and prints the lock-in command');
assert.equal(run('up', [A], [A, B]).status, 1);
ok('higher fails');
assert.equal(run('swap', [A, B], [A, C]).status, 1);
ok('new file at equal count fails');
assert.equal(run('swap-down', [A, B], [C]).status, 1);
ok('new file at lower count fails');
const upd = run('update-up', [A], [A, B], ['--update']);
assert.equal(upd.status, 1);
assert.equal(upd.baseline.maxProblems, 1);
ok('--update refuses to raise');
const updDown = run('update-down', [A, B], [A], ['--update']);
assert.equal(updDown.status, 0);
assert.equal(updDown.baseline.maxProblems, 1);
ok('--update lowers');
console.log(`raw-keys-ratchet: ${n} passed`);

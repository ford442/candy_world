#!/usr/bin/env node
// Promote the current main commit to a known-good "stable" build.
//
//   npm run release:stable -- [label] [--skip-smoke] [--no-upload] [--dry-run]
//
// Gates: clean tree on main, WASM test, full build, smoke test (boot +
// population thresholds in tests/smoke-runner.mjs). Then: annotated tag
// stable-YYYY-MM-DD[-label], GitHub Release with the dist zip, and uploads to
// storage.noahcohn.com under releases/<tag>/ and stable/. See docs/RELEASES.md.

import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const label = args.find((a) => !a.startsWith('--'));
const dryRun = flag('--dry-run');
const skipSmoke = flag('--skip-smoke');
const noUpload = flag('--no-upload');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run = (cmd) => {
    console.log(`\n$ ${cmd}`);
    if (!dryRun) execSync(cmd, { stdio: 'inherit' });
};
const fail = (msg) => {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
};

if (label && !/^[a-z0-9][a-z0-9-]*$/.test(label)) {
    fail(`label "${label}" must be lowercase letters, digits and dashes`);
}

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main' && !dryRun) fail(`must run on main (on ${branch})`);
if (sh('git status --porcelain') && !dryRun) fail('working tree is not clean');

const date = new Date().toISOString().slice(0, 10);
const tag = `stable-${date}${label ? `-${label}` : ''}`;
if (sh(`git tag -l ${tag}`)) fail(`tag ${tag} already exists`);

const commit = sh('git rev-parse HEAD');
const prevTag = sh("git tag -l 'stable-*' --sort=-creatordate | head -n1");
const changes = sh(`git log --oneline --no-merges ${prevTag ? `${prevTag}..HEAD` : '-20'}`);

run('npm run build:wasm');
run('npm run test:wasm');
run('npm run build');
if (skipSmoke) console.warn('\n! --skip-smoke: boot/population smoke test NOT run');
else run('npm run test');

const buildInfo = {
    tag,
    commit,
    date: new Date().toISOString(),
    smokeTest: skipSmoke ? 'skipped' : 'passed',
};
const zipName = `candy-world-${tag}.zip`;
const work = mkdtempSync(join(tmpdir(), 'candy-release-'));
const zipPath = join(work, zipName);
const notesPath = join(work, 'notes.md');

const notes = [
    `Known-good build of \`${commit.slice(0, 10)}\`.`,
    '',
    `- Smoke test (boot + population thresholds): **${buildInfo.smokeTest}**`,
    '- Run it: unzip, then `npx vite preview --outDir <dir>` (or any static server; WebGPU required)',
    '- Safe mode if the full world misbehaves: `?preset=minimal`',
    '',
    `## Changes since ${prevTag || 'last 20 commits'}`,
    '',
    ...changes.split('\n').map((l) => `- ${l}`),
].join('\n');

if (dryRun) {
    console.log(`\n[dry-run] tag: ${tag}\n[dry-run] BUILD_INFO: ${JSON.stringify(buildInfo)}`);
    console.log(`[dry-run] notes:\n${notes}`);
} else {
    writeFileSync('dist/BUILD_INFO.json', `${JSON.stringify(buildInfo, null, 2)}\n`);
    writeFileSync(notesPath, notes);
}

run(`cd dist && zip -qr ${zipPath} .`);
run(`git tag -a ${tag} -m "Known-good build (smoke: ${buildInfo.smokeTest})"`);
run(`git push origin ${tag}`);
run(`gh release create ${tag} ${zipPath} --title "${tag}" --notes-file ${notesPath}`);
if (noUpload) {
    console.log('\n--no-upload: skipping storage.noahcohn.com');
} else {
    run(`python3 deploy.py --prefix releases/${tag}`);
    run('python3 deploy.py --prefix stable');
}

rmSync(work, { recursive: true, force: true });
console.log(`\n✓ ${tag}${dryRun ? ' (dry run — nothing changed)' : ' promoted'}`);

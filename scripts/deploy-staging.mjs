#!/usr/bin/env node
// Deploy the current dist/ to a per-commit staging prefix.
//
//   npm run deploy:staging -- [--build] [--dry-run] [--allow-dirty]
//
// Uploads to test.1ink.us/candy-world/staging/<short-sha>/ (via the
// storage.noahcohn.com deploy API) through
// deploy.py (one zip, *.map skipped) after writing dist/BUILD_INFO.json, so the
// page at the URL names the commit and toolchain it was built from. It checks
// that dist/ is a full build (candy_native*.wasm + candy_dsp.wasm), not
// build:ci. --build runs `npm run build` first. See docs/RELEASES.md.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const dryRun = flag('--dry-run');
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run = (cmd) => {
    console.log(`\n$ ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
};
const fail = (msg) => {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
};

const dirty = sh('git status --porcelain --untracked-files=no');
if (dirty && !flag('--allow-dirty')) {
    fail('tracked files are modified; commit first (or pass --allow-dirty)');
}

if (flag('--build')) run('npm run build');

const FULL_BUILD = ['candy_native.wasm', 'candy_native_st.wasm', 'candy_dsp.wasm'];
for (const f of ['index.html', ...FULL_BUILD]) {
    if (!existsSync(`dist/${f}`)) fail(`dist/${f} missing: run the full \`npm run build\``);
}

const commit = sh('git rev-parse HEAD');
const shortSha = sh('git rev-parse --short=8 HEAD');
const prefix = `staging/${shortSha}`;
const emsdkPinned = readFileSync('.emsdk-version', 'utf8').trim();
let emcc = null;
try {
    emcc = sh('emcc --version').split('\n')[0];
} catch {
    // emcc not on PATH: the native wasm came from an earlier build.
}

const buildInfo = {
    channel: 'staging',
    commit,
    shortSha,
    dirty: Boolean(dirty),
    date: new Date().toISOString(),
    node: process.version,
    emsdkPinned,
    emcc,
    flags: {
        CANDY_STRICT_EMSDK: process.env.CANDY_STRICT_EMSDK === '1',
        nativeWasm: FULL_BUILD.filter((f) => existsSync(`dist/${f}`)),
    },
    // storage.noahcohn.com is only the deploy API; its SFTP target serves test.1ink.us.
    url: `https://test.1ink.us/candy-world/${prefix}/`,
};

writeFileSync('dist/BUILD_INFO.json', `${JSON.stringify(buildInfo, null, 2)}\n`);
console.log(`BUILD_INFO.json: ${JSON.stringify(buildInfo)}`);

run(`python3 deploy.py --prefix ${prefix}${dryRun ? ' --dry-run' : ''}`);
console.log(`\n${dryRun ? '[dry-run] would deploy to' : 'Deployed:'} ${buildInfo.url}`);

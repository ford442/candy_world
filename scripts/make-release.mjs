#!/usr/bin/env node
/**
 * scripts/make-release.mjs
 *
 * Creates a dated annotated git tag and a GitHub Release with the built dist/
 * folder attached as a zip archive.
 *
 * Usage:
 *   node scripts/make-release.mjs [tag]         # e.g. 2026-06-stable
 *   npm run release:tag                          # uses today's date
 *   npm run release:tag -- v1.0.0               # explicit tag
 *
 * Prerequisites:
 *   - dist/ must already exist (run `npm run build` first, or use `npm run release`)
 *   - `gh` CLI must be installed and authenticated (`gh auth login`)
 *   - Working tree must be clean (uncommitted changes will be warned about)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, createWriteStream, statSync } from 'fs';
import { join, resolve } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const DIST = join(ROOT, 'dist');
const RELEASES_META = join(ROOT, '.releases');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function tryRun(cmd) {
    try { return run(cmd); } catch { return ''; }
}

function die(msg) {
    console.error(`\n❌  ${msg}\n`);
    process.exit(1);
}

function ok(msg) { console.log(`✅  ${msg}`); }
function info(msg) { console.log(`   ${msg}`); }

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

// Check gh CLI
if (!tryRun('gh --version')) {
    die('`gh` CLI not found. Install it from https://cli.github.com and run `gh auth login`.');
}

// Check dist/ exists
if (!existsSync(DIST)) {
    die('dist/ not found. Run `npm run build` first (or use `npm run release` to build + tag in one step).');
}

// Warn on dirty working tree (don't block — snapshot of current state may be intentional)
const dirty = tryRun('git status --porcelain');
if (dirty) {
    console.warn(`⚠️  Working tree has uncommitted changes:\n${dirty}\n   The tag will point to HEAD which may not include them.\n`);
}

// ---------------------------------------------------------------------------
// Determine tag name
// ---------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const tag = process.argv[2] ?? `${today}-stable`;
const tagRegex = /^[a-zA-Z0-9._-]+$/;
if (!tagRegex.test(tag)) die(`Invalid tag name "${tag}". Use only letters, digits, dots, dashes, underscores.`);

// Check tag doesn't already exist
const existingTag = tryRun(`git tag -l ${tag}`);
if (existingTag === tag) die(`Tag "${tag}" already exists. Choose a different name or delete the existing tag first.`);

// ---------------------------------------------------------------------------
// Gather release metadata
// ---------------------------------------------------------------------------

const commitHash  = run('git rev-parse --short HEAD');
const commitMsg   = run('git log -1 --pretty=format:%s');
const branch      = tryRun('git rev-parse --abbrev-ref HEAD') || 'unknown';
const distSizeKB  = Math.round(
    parseInt(run(`du -sk ${DIST}`).split('\t')[0]) || 0
);

console.log(`\n🍭  Candy World Release: ${tag}`);
info(`Commit : ${commitHash}  (${branch})`);
info(`Message: ${commitMsg}`);
info(`dist/  : ~${distSizeKB} KB`);
console.log('');

// ---------------------------------------------------------------------------
// Create zip of dist/
// ---------------------------------------------------------------------------

const zipPath = join(ROOT, `candy-world-${tag}.zip`);

info(`Zipping dist/ → ${zipPath} ...`);

// Use the `zip` command if available (most systems), otherwise fall back to
// a pure-Node tar.gz (no extra deps).
const hasZip = !!tryRun('which zip 2>/dev/null || where zip 2>nul');
if (hasZip) {
    run(`zip -r "${zipPath}" dist/`, { stdio: 'inherit' });
} else {
    // Minimal tar fallback (Node 18+ has built-in tar via child_process)
    const tarPath = zipPath.replace('.zip', '.tar.gz');
    run(`tar -czf "${tarPath}" dist/`);
    // repoint zipPath variable for gh release step
    Object.defineProperty({ zipPath }, 'zipPath', { value: tarPath });
}
ok(`Archive created`);

// ---------------------------------------------------------------------------
// Annotated git tag
// ---------------------------------------------------------------------------

const tagMessage = [
    `Candy World snapshot: ${tag}`,
    ``,
    `Commit: ${commitHash}`,
    `Branch: ${branch}`,
    `Build:  ${new Date().toUTCString()}`,
    `Dist:   ~${distSizeKB} KB`,
    ``,
    commitMsg,
].join('\n');

info(`Creating annotated tag ${tag} ...`);
run(`git tag -a ${tag} -m ${JSON.stringify(tagMessage)}`);
ok(`Tag created`);

info(`Pushing tag to origin ...`);
run(`git push origin ${tag}`);
ok(`Tag pushed`);

// ---------------------------------------------------------------------------
// GitHub Release
// ---------------------------------------------------------------------------

const releaseNotes = [
    `## Candy World — ${tag}`,
    ``,
    `**Commit:** \`${commitHash}\` on \`${branch}\``,
    `**Built:** ${new Date().toUTCString()}`,
    ``,
    `### What's included`,
    `- \`dist/\` — complete production build (WebGPU renderer, WASM physics, all assets)`,
    `- To run locally: unzip, then \`npx serve dist\` or any static file server`,
    ``,
    `### Last commit`,
    `> ${commitMsg}`,
    ``,
    `### How to use this build`,
    `\`\`\`bash`,
    `# Download and serve the build`,
    `unzip candy-world-${tag}.zip`,
    `npx serve dist`,
    `# Open http://localhost:3000`,
    `\`\`\``,
    ``,
    `_Auto-generated by scripts/make-release.mjs_`,
].join('\n');

info(`Creating GitHub Release ${tag} ...`);
const ghResult = spawnSync('gh', [
    'release', 'create', tag,
    zipPath,
    '--title', `Candy World ${tag}`,
    '--notes', releaseNotes,
], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });

if (ghResult.status !== 0) {
    console.error(ghResult.stderr);
    die('GitHub Release creation failed. Check `gh auth status` and try again.');
}

const releaseUrl = ghResult.stdout.trim();
ok(`GitHub Release created: ${releaseUrl}`);

// ---------------------------------------------------------------------------
// Local release log
// ---------------------------------------------------------------------------

mkdirSync(RELEASES_META, { recursive: true });
const logEntry = JSON.stringify({
    tag,
    commit: commitHash,
    branch,
    date: new Date().toISOString(),
    releaseUrl,
    distSizeKB,
    commitMsg,
}, null, 2) + '\n';

import { writeFileSync, appendFileSync } from 'fs';
const logFile = join(RELEASES_META, 'releases.json');

let releases = [];
if (existsSync(logFile)) {
    try { releases = JSON.parse(run(`cat "${logFile}"`)); } catch { releases = []; }
}
releases.unshift(JSON.parse(logEntry.trim()));
writeFileSync(logFile, JSON.stringify(releases, null, 2) + '\n');

ok(`Release logged in .releases/releases.json`);

// ---------------------------------------------------------------------------
// Clean up archive
// ---------------------------------------------------------------------------

run(`rm -f "${zipPath}"`);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log(`\n🎉  Release complete!`);
console.log(`    Tag    : ${tag}`);
console.log(`    URL    : ${releaseUrl}`);
console.log(`    Commit : ${commitHash}\n`);

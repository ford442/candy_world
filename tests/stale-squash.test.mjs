/**
 * scripts/check-stale-squash.mjs push mode, and the issue filer it feeds.
 *
 * Push mode runs after a squash lands on main. It recovers the branch's fork
 * point from refs/pull/<N>/head and flags files the branch deleted lines from
 * that main changed after that fork. It never fails the run on a detection:
 * it writes `stale=<json>` to $GITHUB_OUTPUT, and scripts/stale-squash-issue.cjs
 * files one issue per squash sha.
 *
 * Each case builds a throwaway repo; the "remote" is the repo itself
 * (STALE_SQUASH_REMOTE=.), with a local refs/pull/<N>/head.
 *
 * Run: npm run test:stale-squash
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { makeRepo } from './support/tmp-git-repo.mjs';

const SCRIPT = resolve('scripts/check-stale-squash.mjs');
const fileIssue = createRequire(import.meta.url)('../scripts/stale-squash-issue.cjs');

const ORIGINAL = ['export function a() {', '    return 1;', '}', ''].join('\n');
const MAIN_FIX = [
    'export function a() {',
    '    // main fixed this after the branch forked',
    '    return 2;',
    '}',
    '',
].join('\n');
const STALE = ['export function a() {', '}', ''].join('\n');

/**
 * base ── mainFix ── squash(#pr)       ← main
 *   └── branch (deletes lines in a.ts)  ← refs/pull/<pr>/head
 *
 * With mergeMain, the branch then merges main in and resolves the conflict to
 * its own stale side, as #1917 did a minute before it was squashed. Its
 * merge-base with main is then main's tip, which hides the fork.
 */
function runPush({
    subject = 'feat: stale (#12) (#42)',
    pr = 42,
    staleFile = true,
    withPrRef = true,
    mergeMain = false,
}) {
    const repo = makeRepo('stale-squash');
    try {
        const base = repo.commit('base', { 'a.ts': ORIGINAL, 'b.ts': 'b\n' });
        repo.commit('main fix', { 'a.ts': MAIN_FIX });
        repo.git('switch', '-q', '-c', 'branch', base);
        const branchFiles = staleFile ? { 'a.ts': STALE } : { 'c.ts': 'new\n' };
        let prHead = repo.commit('branch work', branchFiles);
        if (mergeMain) {
            repo.git('merge', '-q', '-X', 'ours', '-m', "Merge branch 'main' into branch", 'main');
            prHead = repo.git('rev-parse', 'HEAD');
        }
        if (withPrRef) repo.git('update-ref', `refs/pull/${pr}/head`, prHead);
        repo.git('switch', '-q', 'main');
        // What a stale squash lands: the branch's copy of the file over main's.
        repo.commit(subject, branchFiles);
        const sha = repo.git('rev-parse', 'HEAD');

        const outputPath = join(repo.dir, '.git', 'gh-output');
        const r = repo.run(SCRIPT, {
            GITHUB_EVENT_NAME: 'push',
            GITHUB_REF: 'refs/heads/main',
            STALE_SQUASH_REMOTE: '.',
            GITHUB_OUTPUT: outputPath,
        });
        const output = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
        return { ...r, output, sha };
    } finally {
        repo.cleanup();
    }
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`);
    }
}

console.log('stale-squash (push mode)');

await test('stale squash: exit 0, $GITHUB_OUTPUT names the trailing PR (not the cited issue) and the file', () => {
    const r = runPush({});
    assert.equal(r.status, 0, r.out);
    const line = r.output.split('\n').find((l) => l.startsWith('stale='));
    assert.ok(line, `no stale= line in GITHUB_OUTPUT:\n${r.output}\n${r.out}`);
    const stale = JSON.parse(line.slice('stale='.length));
    assert.equal(stale.pr, 42);
    assert.deepEqual(stale.files, ['a.ts']);
    assert.equal(stale.sha, r.sha);
    assert.equal(stale.shortSha, r.sha.slice(0, 8));
    assert.match(r.out, /::warning title=Stale squash landed on main::#42/);
});

await test('stale branch that merged main before the squash (#1917 shape) is still caught', () => {
    const r = runPush({ mergeMain: true });
    assert.equal(r.status, 0, r.out);
    const line = r.output.split('\n').find((l) => l.startsWith('stale='));
    assert.ok(line, `no stale= line in GITHUB_OUTPUT:\n${r.output}\n${r.out}`);
    assert.deepEqual(JSON.parse(line.slice('stale='.length)).files, ['a.ts']);
});

await test('clean branch that merged main: no output', () => {
    const r = runPush({ staleFile: false, mergeMain: true });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.output, '');
});

await test('clean squash: exit 0, no output', () => {
    const r = runPush({ staleFile: false });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.output, '');
    assert.match(r.out, /No stale-squash patterns detected/);
});

await test('subject without a trailing (#N): skipped, exit 0', () => {
    const r = runPush({ subject: 'direct push to main' });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.output, '');
    assert.match(r.out, /has no trailing \(#N\)/);
});

await test('missing refs/pull/N/head: exit 1 (cannot compute is not a pass)', () => {
    const r = runPush({ withPrRef: false });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /Could not fetch refs\/pull\/42\/head/);
});

console.log('stale-squash-issue.cjs');

function fakeGithub() {
    const issues = [];
    const comments = [];
    const labels = new Set();
    const rest = {
        issues: {
            listForRepo: async ({ labels: label, state }) => ({
                data: issues.filter((i) => i.state === state && i.labels.includes(label)),
            }),
            createComment: async ({ issue_number, body }) => {
                comments.push({ issue_number, body });
                return { data: {} };
            },
            getLabel: async ({ name }) => {
                if (!labels.has(name)) throw Object.assign(new Error('Not Found'), { status: 404 });
                return { data: { name } };
            },
            createLabel: async ({ name }) => {
                labels.add(name);
                return { data: { name } };
            },
            create: async ({ title, body, labels: ls }) => {
                const issue = {
                    number: 100 + issues.length,
                    title,
                    body,
                    labels: ls,
                    state: 'open',
                };
                issues.push(issue);
                return { data: issue };
            },
        },
    };
    const github = { rest, paginate: async (fn, args) => (await fn(args)).data };
    return { github, issues, comments, labels };
}

const context = { repo: { owner: 'o', repo: 'r' }, serverUrl: 'https://github.com', runId: 7 };
const staleA = {
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaaa',
    pr: 42,
    forkPoint: 'b'.repeat(40),
    files: ['a.ts'],
};

await test('first detection creates one labelled issue (and the label)', async () => {
    const gh = fakeGithub();
    const res = await fileIssue({ github: gh.github, context, stale: staleA });
    assert.equal(res.action, 'created');
    assert.equal(gh.issues.length, 1);
    assert.equal(gh.issues[0].title, 'Stale squash landed on main: aaaaaaaa (#42)');
    assert.deepEqual(gh.issues[0].labels, ['stale-squash-landed']);
    assert.ok(gh.issues[0].body.includes(staleA.sha));
    assert.ok(gh.issues[0].body.includes('`a.ts`'));
    assert.ok(gh.labels.has('stale-squash-landed'));
});

await test('same sha again comments on the open issue instead of filing a second', async () => {
    const gh = fakeGithub();
    await fileIssue({ github: gh.github, context, stale: staleA });
    const res = await fileIssue({ github: gh.github, context, stale: staleA });
    assert.equal(res.action, 'commented');
    assert.equal(gh.issues.length, 1);
    assert.equal(gh.comments.length, 1);
    assert.equal(gh.comments[0].issue_number, gh.issues[0].number);
});

await test('a different sha files its own issue', async () => {
    const gh = fakeGithub();
    await fileIssue({ github: gh.github, context, stale: staleA });
    await fileIssue({
        github: gh.github,
        context,
        stale: { ...staleA, sha: 'c'.repeat(40), shortSha: 'cccccccc', pr: 43 },
    });
    assert.equal(gh.issues.length, 2);
    assert.equal(gh.comments.length, 0);
});

console.log(`stale-squash: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

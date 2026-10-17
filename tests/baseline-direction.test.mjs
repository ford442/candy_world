/**
 * scripts/check-baseline-direction.mjs: a PR may lower a ratchet baseline but
 * never raise it; ESLint alone may be re-based, and only with the
 * `ratchet-reset` label plus a rule-set change.
 *
 * Each case builds a throwaway repo with a fake origin/main, commits the PR
 * side on a branch, and runs the script as the pull_request job would.
 *
 * Run: npm run test:baseline-direction
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeRepo } from './support/tmp-git-repo.mjs';

const SCRIPT = resolve('scripts/check-baseline-direction.mjs');
const json = (o) => JSON.stringify(o, null, 2) + '\n';
const MAIN = {
    eslint: 4786,
    tsc: 0,
    cycles: { cyclicModules: 0, cyclicEdges: 0, madgeCycles: 0 },
};

function baselineFiles({ eslint, tsc, cycles }) {
    return {
        'scripts/eslint-baseline.json': json({ maxProblems: eslint, updatedAt: '2026-10-10' }),
        'scripts/tsc-baseline.json': json({ errors: tsc }),
        'scripts/cycles-baseline.json': json({ ...cycles, updatedAt: '2026-09-30', edges: [] }),
    };
}

/**
 * @param pr        baseline values on the PR side (merged over MAIN)
 * @param extra     other files the PR changes
 * @param labels    labels on the PR in the event payload
 * @param withOrigin  create refs/remotes/origin/main
 */
function runCase({ pr = {}, extra = {}, labels = [], withOrigin = true, event = 'pull_request' }) {
    const repo = makeRepo('baseline-direction');
    try {
        repo.commit('main', {
            ...baselineFiles(MAIN),
            'eslint.config.js': 'export default [];\n',
            'scripts/eslint-ratchet.mjs': '// ratchet\n',
        });
        if (withOrigin) repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        repo.git('switch', '-q', '-c', 'pr');
        repo.commit('pr', { ...baselineFiles({ ...MAIN, ...pr }), ...extra });

        const eventPath = join(repo.dir, '.git', 'event.json');
        writeFileSync(
            eventPath,
            JSON.stringify({ pull_request: { labels: labels.map((name) => ({ name })) } })
        );
        const env = event
            ? { GITHUB_EVENT_NAME: event, GITHUB_BASE_REF: 'main', GITHUB_EVENT_PATH: eventPath }
            : {};
        return repo.run(SCRIPT, env);
    } finally {
        repo.cleanup();
    }
}

let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`);
    }
}

console.log('baseline-direction');

test('higher maxProblems fails, naming the file and both numbers', () => {
    const r = runCase({ pr: { eslint: 4823 } });
    assert.equal(r.status, 1, r.out);
    assert.match(
        r.out,
        /scripts\/eslint-baseline\.json maxProblems: 4823 is higher than origin\/main's 4786/
    );
});

test('equal passes', () => {
    const r = runCase({});
    assert.equal(r.status, 0, r.out);
});

test('lower passes', () => {
    const r = runCase({ pr: { eslint: 4700 } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /maxProblems: 4700 \(origin\/main: 4786\) ok/);
});

test('higher + ratchet-reset label + eslint.config.js change passes and prints the reason', () => {
    const r = runCase({
        pr: { eslint: 6000 },
        labels: ['ratchet-reset'],
        extra: { 'eslint.config.js': 'export default [{ rules: {} }];\n' },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(
        r.out,
        /ratchet-reset: maxProblems 4786 → 6000 accepted \(label \+ eslint\.config\.js changed\)/
    );
});

test('higher + ratchet-reset label + eslint-ratchet.mjs change passes', () => {
    const r = runCase({
        pr: { eslint: 6000 },
        labels: ['ratchet-reset'],
        extra: { 'scripts/eslint-ratchet.mjs': '// ratchet v2\n' },
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /accepted \(label \+ scripts\/eslint-ratchet\.mjs changed\)/);
});

test('higher + label without a config change fails', () => {
    const r = runCase({ pr: { eslint: 4823 }, labels: ['ratchet-reset'] });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /label is set, but the PR changes neither/);
});

test('higher + config change without the label fails', () => {
    const r = runCase({
        pr: { eslint: 4823 },
        extra: { 'eslint.config.js': 'export default [1];\n' },
    });
    assert.equal(r.status, 1, r.out);
});

test('tsc errors higher fails even with label + config change', () => {
    const r = runCase({
        pr: { tsc: 3 },
        labels: ['ratchet-reset'],
        extra: { 'eslint.config.js': 'export default [1];\n' },
    });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /scripts\/tsc-baseline\.json errors: 3 is higher than origin\/main's 0/);
    assert.match(r.out, /never accepts a raise/);
});

for (const key of ['cyclicModules', 'cyclicEdges', 'madgeCycles']) {
    test(`cycles ${key} higher fails even with label + config change`, () => {
        const r = runCase({
            pr: { cycles: { ...MAIN.cycles, [key]: 2 } },
            labels: ['ratchet-reset'],
            extra: { 'scripts/eslint-ratchet.mjs': '// v2\n' },
        });
        assert.equal(r.status, 1, r.out);
        assert.match(
            r.out,
            new RegExp(`cycles-baseline\\.json ${key}: 2 is higher than origin/main's 0`)
        );
    });
}

test('deleting a key fails (the ratchet would read it as no limit)', () => {
    const repoFiles = { 'scripts/eslint-baseline.json': json({ updatedAt: '2026-10-10' }) };
    const r = runCase({ extra: repoFiles });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /maxProblems: missing or not a number/);
});

test("missing origin/main exits 1 with git's reason and the fetch-depth hint", () => {
    const r = runCase({ withOrigin: false });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /Cannot read origin\/main/);
    assert.match(r.out, /git said: /);
    assert.match(r.out, /fetch-depth: 0/);
});

test('outside pull_request: prints both numbers and exits 0, even when higher', () => {
    const r = runCase({ pr: { eslint: 4823 }, event: null });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /maxProblems: 4823 \(origin\/main: 4786\)/);
});

console.log(`baseline-direction: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

/**
 * Throwaway git repos for testing the CI guards (scripts/check-*.mjs) against
 * a fake origin/main without touching the network or this checkout.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_ENV = {
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
};

export function makeRepo(prefix) {
    const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
    const git = (...args) =>
        execFileSync('git', args, { cwd: dir, env: { ...process.env, ...GIT_ENV } })
            .toString()
            .trim();
    git('init', '-q', '-b', 'main');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '/dev/null');

    const write = (files) => {
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, path)), { recursive: true });
            writeFileSync(join(dir, path), content);
        }
    };
    const commit = (message, files = {}) => {
        write(files);
        git('add', '-A');
        git('commit', '-q', '--allow-empty', '-m', message);
        return git('rev-parse', 'HEAD');
    };
    /** Run a node script with cwd = this repo; returns { status, out }. */
    const run = (script, env = {}) => {
        const res = spawnSync(process.execPath, [script], {
            cwd: dir,
            env: { ...stripGithubEnv(process.env), ...GIT_ENV, ...env },
            encoding: 'utf8',
        });
        return { status: res.status, out: `${res.stdout}${res.stderr}` };
    };
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    return { dir, git, write, commit, run, cleanup };
}

/** A real Actions runner's env must not leak into the script under test. */
function stripGithubEnv(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) if (!k.startsWith('GITHUB_')) out[k] = v;
    return out;
}

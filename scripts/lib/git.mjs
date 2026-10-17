import { execSync } from 'node:child_process';

/** Run a git command and return trimmed stdout; throws like execSync on failure. */
export function git(cmd) {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
        .toString()
        .trim();
}

/**
 * Run a git command or exit 1 with git's own reason.
 *
 * A guard that cannot compute its inputs must fail, not pass: under the default
 * depth-1 actions/checkout there is no merge-base and no origin/main, and
 * exiting 0 there would make the check silently skip itself on every PR.
 */
export function gitOrDie(cmd, why, tag) {
    try {
        return git(cmd);
    } catch (e) {
        const stderr = e.stderr?.toString().trim() || e.message;
        let shallow = '';
        try {
            shallow = git('git rev-parse --is-shallow-repository');
        } catch {
            /* not a git repo at all; stderr above already says so */
        }
        console.error(`❌ [${tag}] ${why}`);
        console.error(`   command: ${cmd}`);
        console.error(`   git said: ${stderr}`);
        if (shallow === 'true') {
            console.error('   this clone is shallow — set fetch-depth: 0 on actions/checkout');
        }
        process.exit(1);
    }
}

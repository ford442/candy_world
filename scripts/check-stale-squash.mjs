import { appendFileSync } from 'node:fs';
import { git, gitOrDie } from './lib/git.mjs';

const TAG = 'Stale-Squash Guard';
const TARGET_BRANCH = process.env.GITHUB_BASE_REF || 'main';
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;
const REF = process.env.GITHUB_REF;
// Only overridden by tests and proofs, which fetch a fake refs/pull/N/head from `.`.
const REMOTE = process.env.STALE_SQUASH_REMOTE || 'origin';

const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Files the change `from → to` deletes lines from that `main` also changed
 * after the branch forked (`since → mainTip`). A simple heuristic: if a file has
 * deletions on both sides of the fork, the squash may overwrite main's change.
 * Line-level blame would be stricter; this is the file-granular version.
 */
function findStaleFiles({ from, to, since, mainTip }) {
    const changed = git(`git diff --name-only ${from} ${to}`).split('\n').filter(Boolean);
    const stale = [];
    for (const file of changed) {
        // Lines deleted by the change.
        const deletedLines = git(`git diff ${from} ${to} -- ${q(file)}`)
            .split('\n')
            .filter((l) => /^-[^-]/.test(l) && l.slice(1).trim().length > 0);
        if (deletedLines.length === 0) continue;

        // Commits on main after the fork that touched this file.
        const recentCommits = git(`git log ${since}..${mainTip} --format=%H -- ${q(file)}`)
            .split('\n')
            .filter(Boolean);
        if (recentCommits.length > 0) {
            console.warn(
                `[${TAG}] Warning: PR modifies ${file}, which has recent changes in main that might be overwritten.`
            );
            stale.push(file);
        }
    }
    return stale;
}

console.log(`[${TAG}] event=${EVENT_NAME ?? '(unset)'} base=${TARGET_BRANCH}`);

if (EVENT_NAME === 'push' && REF === `refs/heads/${TARGET_BRANCH}`) {
    pushMode();
} else if (EVENT_NAME === 'pull_request') {
    pullRequestMode();
} else {
    console.log(
        `Not a pull request or a push to ${TARGET_BRANCH} (event "${EVENT_NAME ?? '(unset)'}", ref "${REF ?? '(unset)'}"). Skipping stale-squash check.`
    );
    process.exit(0);
}

function pullRequestMode() {
    gitOrDie(`git fetch origin ${TARGET_BRANCH}`, `Could not fetch origin/${TARGET_BRANCH}.`, TAG);
    const mergeBase = gitOrDie(
        `git merge-base HEAD origin/${TARGET_BRANCH}`,
        `Merge base with origin/${TARGET_BRANCH} could not be determined; refusing to skip the check.`,
        TAG
    );
    console.log(`[${TAG}] merge-base=${mergeBase}`);

    const stale = findStaleFiles({
        from: mergeBase,
        to: 'HEAD',
        since: mergeBase,
        mainTip: `origin/${TARGET_BRANCH}`,
    });
    if (stale.length) {
        console.error(
            '❌ Stale-squash risk detected! This PR deletes lines in files that have been modified in main after this branch was created. Please rebase and ensure you are not unintentionally reverting recent changes.'
        );
        process.exit(1);
    }
    console.log('✅ No stale-squash patterns detected.');
}

/**
 * After a squash lands on main. A squash commit's only parent is the previous
 * main, so the branch's fork point is gone from main's history; GitHub keeps
 * refs/pull/<N>/head after merge, so it is recovered from that.
 *
 * The fork point is NOT `git merge-base HEAD^ <pr head>`: a branch that merged
 * main in before the squash (#1917 did, twice, a minute before merging) has
 * main's tip as its merge-base, and the check would see no main changes at
 * all. It is the parent of the oldest commit on the PR head's first-parent
 * chain that is not on main, i.e. where the branch's own work started. For a
 * branch that never merged main this equals the merge-base.
 *
 * Deletions are read from the squash itself (HEAD^ → HEAD), which is what
 * actually landed, including whatever a merge-main resolution dropped.
 *
 * This cannot un-merge, so a detection never fails the run: it writes
 * `stale=<json>` to $GITHUB_OUTPUT and the workflow files one issue. A guard
 * that cannot compute its inputs (no PR ref) still exits 1.
 */
function pushMode() {
    const sha = git('git rev-parse HEAD');
    const subject = git('git log -1 --format=%s');
    // The trailing (#N) is the one GitHub appends; an earlier one is usually an
    // issue the PR title cited, e.g. "… cue dispatcher (#1826) (#1917)".
    const match = subject.match(/\(#(\d+)\)\s*$/);
    if (!match) {
        console.log(
            `[${TAG}] ${sha.slice(0, 8)} "${subject}" has no trailing (#N): a direct push or rebase merge, not a squash. Skipping.`
        );
        process.exit(0);
    }
    const pr = Number(match[1]);
    console.log(`[${TAG}] push mode: ${sha.slice(0, 8)} squashes #${pr}`);

    gitOrDie(
        `git fetch ${REMOTE} refs/pull/${pr}/head`,
        `Could not fetch refs/pull/${pr}/head; cannot recover the branch's fork point.`,
        TAG
    );
    const prHead = git('git rev-parse FETCH_HEAD');
    const ownCommits = gitOrDie(
        `git rev-list --first-parent ${prHead} ^HEAD^`,
        `Could not walk #${pr}'s first-parent history.`,
        TAG
    )
        .split('\n')
        .filter(Boolean);
    if (!ownCommits.length) {
        console.log(
            `[${TAG}] #${pr}'s head ${prHead.slice(0, 8)} is already on main; nothing to compare.`
        );
        return;
    }
    const oldest = ownCommits[ownCommits.length - 1];
    const forkPoint = gitOrDie(
        `git rev-parse --verify --quiet ${oldest}^`,
        `#${pr}'s first commit ${oldest.slice(0, 8)} has no parent; cannot find the fork point.`,
        TAG
    );
    console.log(
        `[${TAG}] pr-head=${prHead} fork-point=${forkPoint} (parent of ${oldest.slice(0, 8)}, ${ownCommits.length} first-parent commit(s) off main)`
    );

    const files = findStaleFiles({ from: 'HEAD^', to: 'HEAD', since: forkPoint, mainTip: 'HEAD^' });
    if (!files.length) {
        console.log('✅ No stale-squash patterns detected.');
        return;
    }

    const summary = { sha, shortSha: sha.slice(0, 8), pr, forkPoint, files };
    console.log(
        `::warning title=Stale squash landed on main::#${pr} (${summary.shortSha}) may have reverted main's changes to ${files.join(', ')}`
    );
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `stale=${JSON.stringify(summary)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `### Stale squash landed: ${summary.shortSha} (#${pr})\n\n` +
                `Fork point \`${forkPoint.slice(0, 8)}\`. Files the squash deletes lines from that main changed after the fork:\n\n` +
                files.map((f) => `- \`${f}\``).join('\n') +
                '\n'
        );
    }
    console.error(
        `❌ Stale squash landed: #${pr} at ${summary.shortSha}. Filing an issue; not failing the run.`
    );
}

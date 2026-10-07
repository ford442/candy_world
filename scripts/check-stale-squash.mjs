import { execSync } from 'node:child_process';

const TARGET_BRANCH = process.env.GITHUB_BASE_REF || 'main';
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;

console.log(`[Stale-Squash Guard] event=${EVENT_NAME ?? '(unset)'} base=${TARGET_BRANCH}`);

if (EVENT_NAME !== 'pull_request') {
    console.log(`Not a pull request (event "${EVENT_NAME ?? '(unset)'}"). Skipping stale-squash check.`);
    process.exit(0);
}

// A guard that cannot compute its inputs must fail, not pass: under the default
// depth-1 actions/checkout there is no merge-base, and exiting 0 here would make
// the check silently skip itself on every PR.
function gitOrDie(cmd, why) {
    try {
        return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    } catch (e) {
        const stderr = e.stderr?.toString().trim() || e.message;
        let shallow = '';
        try {
            shallow = execSync('git rev-parse --is-shallow-repository').toString().trim();
        } catch {
            /* not a git repo at all; stderr above already says so */
        }
        console.error(`❌ [Stale-Squash Guard] ${why}`);
        console.error(`   command: ${cmd}`);
        console.error(`   git said: ${stderr}`);
        if (shallow === 'true') {
            console.error('   this clone is shallow — set fetch-depth: 0 on actions/checkout');
        }
        process.exit(1);
    }
}

try {
    gitOrDie(`git fetch origin ${TARGET_BRANCH}`, `Could not fetch origin/${TARGET_BRANCH}.`);
    const mergeBase = gitOrDie(
        `git merge-base HEAD origin/${TARGET_BRANCH}`,
        `Merge base with origin/${TARGET_BRANCH} could not be determined; refusing to skip the check.`
    );
    console.log(`[Stale-Squash Guard] merge-base=${mergeBase}`);

    // Check if any deleted lines in the PR diff were authored *after* the merge base
    // i.e., lines being reverted that the author didn't originally write or modifying recent main changes.
    // A simple heuristic: if a file has conflicts or deletes recent lines, it might be a stale squash.

    // Get list of deleted lines and their origin commits.
    // This is hard to do perfectly in a short script. We'll check if the PR deletes lines
    // that were introduced in main *after* the PR's merge-base.

    const diffFiles = execSync(`git diff --name-only ${mergeBase}...HEAD`).toString().trim().split('\n');

    let staleSquashDetected = false;
    for (const file of diffFiles) {
        if (!file) continue;

        // This command gets lines deleted in the PR
        const deletedLines = execSync(`git diff ${mergeBase}...HEAD -- ${file} | grep '^-[^-]' | sed 's/^-//'`).toString().split('\n').filter(l => l.trim().length > 0);

        if (deletedLines.length > 0) {
            // Find commits in main after merge-base that touched this file
            const recentCommits = execSync(`git log ${mergeBase}..origin/${TARGET_BRANCH} --format="%H" -- ${file}`).toString().trim().split('\n').filter(Boolean);

            if (recentCommits.length > 0) {
                // Potential stale squash: the PR deletes lines in a file that was modified in main after the PR branched off.
                // It's a high risk. Let's just warn or fail based on strictness.
                console.warn(`[Stale-Squash Guard] Warning: PR modifies ${file}, which has recent changes in main that might be overwritten.`);
                // For a stricter check, we would blame the exact deleted lines.
                // However, doing this precisely requires parsing diffs and git blame.
                // For the scope of this guard, we'll implement a basic check that flags files modified in both branches where lines are deleted in the PR.
                staleSquashDetected = true;
            }
        }
    }

    if (staleSquashDetected) {
        console.error('❌ Stale-squash risk detected! This PR deletes lines in files that have been modified in main after this branch was created. Please rebase and ensure you are not unintentionally reverting recent changes.');
        process.exit(1);
    } else {
        console.log('✅ No stale-squash patterns detected.');
    }

} catch (e) {
    console.error('Failed to run stale-squash check:', e.message);
    process.exit(1);
}

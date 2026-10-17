/**
 * Files (or updates) the issue for a stale squash that landed on main.
 * Called from actions/github-script in node-protocol-tests.yml with the JSON
 * that scripts/check-stale-squash.mjs wrote to $GITHUB_OUTPUT in push mode.
 *
 * One issue per squash sha: if an open `stale-squash-landed` issue already
 * names the sha (a re-run of the same push), comment on it instead.
 */
const LABEL = 'stale-squash-landed';

module.exports = async function fileStaleSquashIssue({ github, context, stale }) {
    const { owner, repo } = context.repo;
    const { sha, shortSha, pr, forkPoint, files } = stale;
    const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
    const fileList = files.map((f) => `- \`${f}\``).join('\n');

    const open = await github.paginate(github.rest.issues.listForRepo, {
        owner,
        repo,
        state: 'open',
        labels: LABEL,
        per_page: 100,
    });
    const existing = open.find((issue) => !issue.pull_request && (issue.body ?? '').includes(sha));
    if (existing) {
        await github.rest.issues.createComment({
            owner,
            repo,
            issue_number: existing.number,
            body: `Detected again for ${sha} in ${runUrl}:\n\n${fileList}`,
        });
        return { action: 'commented', number: existing.number };
    }

    try {
        await github.rest.issues.getLabel({ owner, repo, name: LABEL });
    } catch (e) {
        if (e.status !== 404) throw e;
        await github.rest.issues.createLabel({
            owner,
            repo,
            name: LABEL,
            color: 'b60205',
            description: 'A squash on main deleted lines main had changed after the branch forked',
        });
    }

    const body = [
        `Squash commit ${sha} (#${pr}) landed on \`main\` and deletes lines in files that \`main\` changed after #${pr}'s branch forked at \`${forkPoint}\`.`,
        '',
        fileList,
        '',
        '**What to do:** for each file, compare the squash against its parent ' +
            `(\`git diff ${shortSha}^ ${shortSha} -- <file>\`) and port back whatever main had that the squash dropped, in a new PR. ` +
            `Never re-merge #${pr}'s branch or revert-and-reapply it; that repeats the stale squash.`,
        '',
        `Detected by the stale-squash guard (push mode) in ${runUrl}. See docs/CI_CONTRACT.md, "What happens when a stale squash lands".`,
    ].join('\n');

    const { data } = await github.rest.issues.create({
        owner,
        repo,
        title: `Stale squash landed on main: ${shortSha} (#${pr})`,
        labels: [LABEL],
        body,
    });
    return { action: 'created', number: data.number };
};

import { git, gitOrDie } from './lib/git.mjs';

const TAG = 'PR Description Guard';
const TARGET_BRANCH = process.env.GITHUB_BASE_REF || 'main';

const PATH_RE = /[\w.@-]+(?:\/[\w.@-]+)*\.(?:ts|tsx|js|mjs|cjs|json|md|yml|yaml|css|wgsl|cpp|h)\b/g;
const IDENT_RE = /`([A-Za-z_$][\w$]{5,})`/g;

/**
 * Paths and identifiers a PR body names. Paths are file-looking tokens;
 * identifiers are backticked camelCase/snake_case words with no dot or slash.
 */
export function extractClaims(body) {
    const text = String(body ?? '');
    const paths = new Set(text.match(PATH_RE) ?? []);
    const idents = new Set();
    for (const m of text.matchAll(IDENT_RE)) {
        if (/[a-z][A-Z]|_/.test(m[1])) idents.add(m[1]);
    }
    return { paths: [...paths], idents: [...idents] };
}

/**
 * A description is consistent with its diff when at least one named path is
 * (or ends with / is the basename of) a changed file, or one named identifier
 * appears in the changed lines. A body that names nothing checkable passes.
 * Stale-base PRs fail: their description names the intended files while the
 * diff holds unrelated ones (#1946, #1960).
 */
export function checkDescription({ body, files, diffText }) {
    const { paths, idents } = extractClaims(body);
    if (paths.length === 0 && idents.length === 0) return { ok: true, reason: 'nothing checkable' };
    const pathHit = paths.some((p) =>
        files.some((f) => f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`))
    );
    const identHit = idents.some((id) => diffText.includes(id));
    if (pathHit || identHit) return { ok: true, reason: 'overlap' };
    return { ok: false, reason: 'no overlap', paths, idents };
}

function main() {
    if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
        console.log(`[${TAG}] not a pull_request event; skipping.`);
        return;
    }
    gitOrDie(`git fetch origin ${TARGET_BRANCH}`, `Could not fetch origin/${TARGET_BRANCH}.`, TAG);
    const base = gitOrDie(`git merge-base HEAD origin/${TARGET_BRANCH}`, 'No merge base.', TAG);
    const files = git(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean);
    const diffText = git(`git diff -U0 ${base} HEAD`);
    const res = checkDescription({ body: process.env.PR_BODY, files, diffText });
    if (res.ok) {
        console.log(`✅ [${TAG}] ${res.reason}.`);
        return;
    }
    console.error(
        `❌ [${TAG}] The PR body names paths/identifiers that appear nowhere in the diff.\n` +
            `   named paths: ${res.paths.join(', ') || '(none)'}\n` +
            `   named identifiers: ${res.idents.join(', ') || '(none)'}\n` +
            `   changed files: ${files.slice(0, 20).join(', ')}\n` +
            'This usually means a stale base: the diff is not the change the description promises. Rebase on main or fix the description.'
    );
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

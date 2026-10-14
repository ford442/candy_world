#!/usr/bin/env node
/**
 * Baselines only go down.
 *
 * The ratchets (eslint-ratchet, tsc-ratchet, cycles-ratchet) compare the
 * current count against a committed JSON baseline, and their --update refuses
 * to raise it. Nothing stopped a PR from simply committing a higher number:
 * between 2026-10-09 and 10-10 four bot PRs moved maxProblems 4784 → 4786 →
 * 4823 → 4786. This compares each baseline in the PR against origin/<base>.
 *
 *   lower or equal   pass
 *   higher           fail, naming the file, key and both numbers
 *
 * One exception, ESLint only: a person adds the `ratchet-reset` label AND the
 * PR changes eslint.config.js or scripts/eslint-ratchet.mjs (a rule-set
 * change, like #1858's type-aware re-base 1752 → 4787). tsc and cycles are
 * exact at 0 and never accept a raise. The label is read from the event
 * payload at GITHUB_EVENT_PATH, so no API call is needed.
 *
 * Outside pull_request (local runs, push) it prints both numbers and exits 0.
 *
 * Usage: npm run test:baselines
 */
import { existsSync, readFileSync } from 'node:fs';
import { git, gitOrDie } from './lib/git.mjs';

const TAG = 'Baseline Direction';
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;
const BASE = process.env.GITHUB_BASE_REF || 'main';
const RESET_LABEL = 'ratchet-reset';
const RESET_FILES = ['eslint.config.js', 'scripts/eslint-ratchet.mjs'];

const BASELINES = [
    { file: 'scripts/eslint-baseline.json', keys: ['maxProblems'], resettable: true },
    { file: 'scripts/tsc-baseline.json', keys: ['errors'], resettable: false },
    {
        file: 'scripts/cycles-baseline.json',
        keys: ['cyclicModules', 'cyclicEdges', 'madgeCycles'],
        resettable: false,
    },
];

const readLocal = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

function readBase(ref, file) {
    try {
        return JSON.parse(git(`git show ${ref}:${file}`));
    } catch {
        return null;
    }
}

console.log(`[${TAG}] event=${EVENT_NAME ?? '(unset)'} base=${BASE}`);

if (EVENT_NAME !== 'pull_request') {
    let baseRef = `origin/${BASE}`;
    try {
        git(`git rev-parse --verify --quiet ${baseRef}^{commit}`);
    } catch {
        baseRef = null;
    }
    for (const { file, keys } of BASELINES) {
        const local = readLocal(file);
        const base = baseRef ? readBase(baseRef, file) : null;
        for (const key of keys) {
            console.log(
                `  ${file} ${key}: ${local?.[key] ?? '-'} (${baseRef ?? `origin/${BASE} unavailable`}: ${base?.[key] ?? '-'})`
            );
        }
    }
    console.log(`Not a pull request; direction is only enforced on pull_request.`);
    process.exit(0);
}

const baseRef = `origin/${BASE}`;
gitOrDie(
    `git rev-parse --verify ${baseRef}^{commit}`,
    `Cannot read ${baseRef}, so the baselines cannot be compared; refusing to pass. ` +
        'The checkout needs fetch-depth: 0 (or an explicit fetch of the base branch).',
    TAG
);

let labels = [];
if (process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    labels = (event.pull_request?.labels ?? []).map((l) => l.name);
}
const hasResetLabel = labels.includes(RESET_LABEL);
const changed = gitOrDie(
    `git diff --name-only ${baseRef}...HEAD`,
    `Cannot list the files this PR changes against ${baseRef}.`,
    TAG
)
    .split('\n')
    .filter(Boolean);
const resetFilesChanged = RESET_FILES.filter((f) => changed.includes(f));

let failed = false;
for (const { file, keys, resettable } of BASELINES) {
    const local = readLocal(file);
    const base = readBase(baseRef, file);
    if (!base) {
        console.log(`  ${file}: not on ${baseRef} (new baseline), nothing to compare`);
        continue;
    }
    if (!local) {
        failed = true;
        console.error(
            `❌ ${file}: deleted in this PR; a ratchet without a baseline gates nothing.`
        );
        continue;
    }
    for (const key of keys) {
        const was = base[key];
        const now = local[key];
        if (typeof was !== 'number') {
            console.log(`  ${file} ${key}: ${now} (${baseRef}: -) new key, nothing to compare`);
            continue;
        }
        if (!Number.isFinite(now)) {
            failed = true;
            console.error(`❌ ${file} ${key}: missing or not a number (${baseRef}: ${was}).`);
            continue;
        }
        if (now <= was) {
            console.log(`  ${file} ${key}: ${now} (${baseRef}: ${was}) ok`);
            continue;
        }
        if (resettable && hasResetLabel && resetFilesChanged.length) {
            console.log(
                `  ${file} ${key}: ${now} (${baseRef}: ${was}) raised; ${RESET_LABEL}: ${key} ${was} → ${now} accepted (label + ${resetFilesChanged.join(', ')} changed)`
            );
            continue;
        }
        failed = true;
        console.error(`❌ ${file} ${key}: ${now} is higher than ${baseRef}'s ${was}.`);
        if (!resettable) {
            console.error(
                '   This baseline is exact; it never accepts a raise. Fix the new errors/cycles.'
            );
        } else if (hasResetLabel) {
            console.error(
                `   The ${RESET_LABEL} label is set, but the PR changes neither ${RESET_FILES.join(' nor ')}. ` +
                    'A reset is for a rule-set change only; fix the new lint problems instead.'
            );
        } else {
            console.error(
                `   Fix the new lint problems. A raise is accepted only for a rule-set change: the ${RESET_LABEL} ` +
                    `label (set by a person) plus a change to ${RESET_FILES.join(' or ')}.`
            );
        }
    }
}

if (failed) {
    console.error(
        `\n❌ [${TAG}] A baseline went up. Baselines only go down; see docs/CI_CONTRACT.md.`
    );
    process.exit(1);
}
console.log(`✅ [${TAG}] No baseline went up.`);

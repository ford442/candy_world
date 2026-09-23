#!/usr/bin/env node
/**
 * Guard: no filled-in `Outcome:` line in `weekly_plan.md` may appear more than once.
 *
 * WHY: commit 30eb9b2 (PR #1724) ran a global find-and-replace across
 * weekly_plan.md and overwrote 8 historical `Outcome:` lines — runs spanning
 * 2026-06-23 to 2026-09-01 — with one identical
 * "✅ #1577 is NOW FULLY IMPLEMENTED AND VERIFIED" string, retroactively
 * asserting that June's run shipped September's work. A duplicated outcome line
 * is the fingerprint of that failure mode, and it is cheap to detect.
 *
 * Unfilled placeholders (`Outcome: <!-- fill in at end of day ... -->`) are
 * EXEMPT: they legitimately repeat once per pending day, and there are 8 of
 * them on main today. Only lines carrying real prose are checked.
 *
 * Exits non-zero listing each repeated outcome and the line numbers involved.
 *
 * Run: npm run test:plan-integrity
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = path.join(root, 'weekly_plan.md');

// Anchored at line start (allowing list markers / bold) so prose that merely
// mentions the word "Outcome:" mid-sentence is not treated as an outcome entry.
const OUTCOME_RE = /^[\s>*-]*(?:\*\*)?Outcome:?(?:\*\*)?\s*:?\s*(.*)$/;

// An outcome that is still a placeholder comment carries no assertion, so it
// may legitimately repeat across pending days.
function isPlaceholder(body) {
    const stripped = body.replace(/<!--[\s\S]*?-->/g, '').trim();
    return stripped.length === 0;
}

function main() {
    if (!fs.existsSync(PLAN)) {
        console.error(`✗ weekly_plan.md not found at ${PLAN}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(PLAN, 'utf8').split('\n');

    // normalized outcome text -> line numbers (1-indexed)
    const seen = new Map();
    let placeholders = 0;

    lines.forEach((line, i) => {
        const m = OUTCOME_RE.exec(line);
        if (!m) return;
        const body = m[1];
        if (isPlaceholder(body)) {
            placeholders++;
            return;
        }
        const key = body.trim().replace(/\s+/g, ' ');
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(i + 1);
    });

    const duplicates = [...seen.entries()].filter(([, ln]) => ln.length > 1);

    console.log(
        `plan-integrity: ${seen.size} filled Outcome line(s), ${placeholders} unfilled placeholder(s) in weekly_plan.md`
    );

    if (duplicates.length > 0) {
        console.error('');
        console.error(`✗ ${duplicates.length} Outcome line(s) in weekly_plan.md appear more than once:`);
        for (const [key, lineNumbers] of duplicates) {
            const preview = key.length > 120 ? `${key.slice(0, 120)}…` : key;
            console.error(`  ✗ lines ${lineNumbers.join(', ')}: "${preview}"`);
        }
        console.error('');
        console.error('This is the signature of a global find-and-replace across historical');
        console.error('entries. Restore the originals (git history on weekly_plan.md) and edit');
        console.error('one dated block at a time.');
        process.exit(1);
    }

    console.log('✓ no filled Outcome line is repeated');
}

main();

#!/usr/bin/env node
/**
 * Guards weekly_plan.md against the #1724 failure mode: a global find/replace
 * that stamped one identical "Outcome:" string over N historically distinct
 * entries (8 runs from 2026-06-23..2026-09-01 got overwritten with the same
 * "#1577 is NOW FULLY IMPLEMENTED AND VERIFIED" line — see weekly_plan.md's
 * own note on commit 30eb9b2 / PR #1724).
 *
 * Unfilled placeholder lines ("<!-- fill in at end of day ... -->") are
 * expected to repeat verbatim across many entries and are NOT a violation —
 * only a *filled-in* Outcome line duplicated across two or more entries is
 * the vandalism signature this guards against.
 *
 * Rule for agents editing weekly_plan.md: append or edit one dated block —
 * never pattern-replace across the file.
 *
 * Run: node scripts/check-plan-integrity.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PLAN_FILE = join(ROOT, 'weekly_plan.md');

const OUTCOME_RE = /^\s*Outcome:\s*(.*)$/;
const PLACEHOLDER_RE = /<!--\s*fill in/i;

const text = readFileSync(PLAN_FILE, 'utf8');
const lines = text.split('\n');

/** @type {Map<string, number[]>} */
const byText = new Map();

lines.forEach((line, idx) => {
    const match = line.match(OUTCOME_RE);
    if (!match) return;
    const content = match[1].trim();
    if (content.length === 0 || PLACEHOLDER_RE.test(content)) return; // unfilled placeholder — expected to repeat
    const lineNos = byText.get(content) ?? [];
    lineNos.push(idx + 1);
    byText.set(content, lineNos);
});

const duplicates = [...byText.entries()].filter(([, lineNos]) => lineNos.length > 1);

if (duplicates.length > 0) {
    console.error(`❌ weekly_plan.md has ${duplicates.length} filled-in Outcome: line(s) duplicated verbatim across multiple entries — the #1724 global-replace signature:\n`);
    for (const [content, lineNos] of duplicates) {
        console.error(`  lines ${lineNos.join(', ')}: "${content.slice(0, 100)}${content.length > 100 ? '…' : ''}"`);
    }
    console.error('\nIf this is real: restore each entry\'s original outcome text (git blame / prior commits), never pattern-replace across the file — append or edit one dated block at a time.');
    process.exit(1);
}

console.log(`✅ weekly_plan.md: ${byText.size} filled-in Outcome: line(s), all unique.`);

#!/usr/bin/env node
/**
 * Guard: every tracked top-level file or directory must be on the allowlist in
 * `scripts/root-files-allowlist.json`.
 *
 * WHY: bots and agents read the repo root (and CLAUDE.md) before every change, so
 * one-shot patch scripts, finished checklists and scratch notes left there get
 * treated as current guidance. `update_js*.py` were string-replace patches that
 * had already run and would have corrupted `src/utils/wasm-loader*.ts` if run
 * again; they sat at the root for months. A new root entry now needs an explicit
 * allowlist line with a reason, which makes the question "does this belong at the
 * root?" a review decision instead of an accident.
 *
 * The allowlist is exact in both directions, like the other ratchets: an entry
 * that is no longer tracked fails too, so the list can only shrink or be extended
 * on purpose. Only tracked paths count (`git ls-files`), so build output such as
 * `dist/` and `node_modules/` never matters.
 *
 * Usage: npm run check:root-files
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST = join(ROOT, 'scripts', 'root-files-allowlist.json');

/**
 * Top-level entries of a list of tracked paths.
 * A path with a slash contributes its first segment as a directory.
 *
 * @param {string[]} tracked Repo-relative paths, as printed by `git ls-files`.
 * @returns {{ files: string[], dirs: string[] }} Sorted, de-duplicated names.
 */
export function rootEntries(tracked) {
    const files = new Set();
    const dirs = new Set();
    for (const p of tracked) {
        if (!p) continue;
        const slash = p.indexOf('/');
        if (slash === -1) files.add(p);
        else dirs.add(p.slice(0, slash));
    }
    return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/**
 * Compare the tracked root against the allowlist.
 *
 * @param {{ tracked: string[], allow: { files?: Record<string, string>, dirs?: Record<string, string> } }} input
 * @returns {{ unlisted: string[], stale: string[] }} Human-readable lines, one per problem.
 *   `unlisted`: tracked at the root, not allowed. `stale`: allowed, no longer tracked.
 */
export function checkRootEntries({ tracked, allow }) {
    const { files, dirs } = rootEntries(tracked);
    const allowFiles = allow.files ?? {};
    const allowDirs = allow.dirs ?? {};
    const unlisted = [
        ...files.filter((f) => !(f in allowFiles)).map((f) => `file  ${f}`),
        ...dirs.filter((d) => !(d in allowDirs)).map((d) => `dir   ${d}/`),
    ];
    const stale = [
        ...Object.keys(allowFiles)
            .filter((f) => !files.includes(f))
            .map((f) => `file  ${f}`),
        ...Object.keys(allowDirs)
            .filter((d) => !dirs.includes(d))
            .map((d) => `dir   ${d}/`),
    ];
    return { unlisted, stale };
}

function main() {
    const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    const tracked = execFileSync('git', ['ls-files', '-z'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })
        .split('\0')
        .filter(Boolean);
    const { unlisted, stale } = checkRootEntries({ tracked, allow });

    if (unlisted.length === 0 && stale.length === 0) {
        const { files, dirs } = rootEntries(tracked);
        console.log(
            `✅ root-files: ${files.length} files and ${dirs.length} directories, all on the allowlist.`
        );
        return;
    }
    if (unlisted.length) {
        console.error(
            `❌ root-files: ${unlisted.length} tracked root entr${unlisted.length === 1 ? 'y is' : 'ies are'} not on the allowlist:`
        );
        for (const u of unlisted) console.error(`  ${u}`);
        console.error(
            'Put it under docs/, scripts/, tools/ or tests/. If it has to live at the root, add it to\n' +
                'scripts/root-files-allowlist.json with a one-line reason.'
        );
    }
    if (stale.length) {
        console.error(
            `❌ root-files: ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} no longer tracked:`
        );
        for (const s of stale) console.error(`  ${s}`);
        console.error(
            'Remove them from scripts/root-files-allowlist.json so the list stays exact.'
        );
    }
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

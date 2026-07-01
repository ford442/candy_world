#!/usr/bin/env node
/**
 * Lightweight drift guard: every CandyPresets.<Name> used under src/foliage/
 * must appear in docs/CANDY_MATERIAL_COOKBOOK.md preset table.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FOLIAGE_DIR = join(ROOT, 'src/foliage');
const COOKBOOK = join(ROOT, 'docs/CANDY_MATERIAL_COOKBOOK.md');
const MATERIAL_CORE = join(ROOT, 'src/foliage/material-core.ts');

const PRESET_RE = /CandyPresets\.([A-Z][a-zA-Z0-9]*)/g;

function walkTsFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walkTsFiles(full));
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

function collectPresetsFromFiles(files) {
    const used = new Set();
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        let m;
        while ((m = PRESET_RE.exec(text)) !== null) {
            used.add(m[1]);
        }
    }
    return used;
}

function collectDefinedPresets() {
    const text = readFileSync(MATERIAL_CORE, 'utf8');
    const block = text.match(/export const CandyPresets[\s\S]*?^};/m);
    if (!block) throw new Error('Could not find CandyPresets block in material-core.ts');
    const defined = new Set();
    const keyRe = /^\s+([A-Z][a-zA-Z0-9]*)\s*:/gm;
    let m;
    while ((m = keyRe.exec(block[0])) !== null) {
        defined.add(m[1]);
    }
    return defined;
}

function collectDocumentedPresets() {
    const text = readFileSync(COOKBOOK, 'utf8');
    const documented = new Set();
    const rowRe = /^\|\s*`([A-Z][a-zA-Z0-9]*)`\s*\|/gm;
    let m;
    while ((m = rowRe.exec(text)) !== null) {
        documented.add(m[1]);
    }
    // Also accept backtick mentions in the "all seven" list
    const inlineRe = /`([A-Z][a-zA-Z0-9]*)`/g;
    while ((m = inlineRe.exec(text)) !== null) {
        if (['Clay', 'Sugar', 'Gummy', 'SeaJelly', 'Crystal', 'Velvet', 'OilSlick'].includes(m[1])) {
            documented.add(m[1]);
        }
    }
    return documented;
}

const foliageFiles = walkTsFiles(FOLIAGE_DIR);
const usedInFoliage = collectPresetsFromFiles(foliageFiles);
const defined = collectDefinedPresets();
const documented = collectDocumentedPresets();

const unknownDefined = [...usedInFoliage].filter((p) => !defined.has(p));
const missingFromCookbook = [...usedInFoliage].filter((p) => !documented.has(p));

let failed = false;

if (unknownDefined.length > 0) {
    console.error('[cookbook-presets] Unknown CandyPresets keys in foliage:', unknownDefined.join(', '));
    failed = true;
}

if (missingFromCookbook.length > 0) {
    console.error('[cookbook-presets] Used in src/foliage/ but missing from cookbook table:', missingFromCookbook.join(', '));
    failed = true;
}

const unusedDefined = [...defined].filter((p) => !usedInFoliage.has(p) && p !== 'Clay');
if (unusedDefined.length > 0) {
    console.warn('[cookbook-presets] Defined but unused in foliage (info):', unusedDefined.join(', '));
}

if (failed) {
    process.exit(1);
}

console.log(`[cookbook-presets] OK — ${usedInFoliage.size} presets used in foliage, all documented (${[...usedInFoliage].sort().join(', ')})`);

#!/usr/bin/env node
/**
 * Guard: the production bundle ships no native-module debug output.
 *
 * Fails if dist/ contains a `.wat`, a `.wasm.map`, or a `.wasm` that carries a
 * `sourceMappingURL` custom section. `build:wasm` is the prod AssemblyScript
 * build (no --textFile, no --sourceMap); `build:wasm:debug` adds both for local
 * debugging, and a module built that way points devtools at a map that is
 * never deployed. Vite's own `hidden` JS maps are not affected: deploy.py
 * skips every `.map`.
 *
 * Run after `vite build`: npm run check:dist-wasm
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'dist-wasm';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`❌ [${TAG}] dist/index.html not found: run \`vite build\` first.`);
    process.exit(1);
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
    }
}

const problems = [];
const modules = [];
for (const file of walk(dist)) {
    const rel = path.relative(dist, file);
    if (rel.endsWith('.wat')) problems.push(`${rel}: WebAssembly text output`);
    if (rel.endsWith('.wasm.map')) problems.push(`${rel}: WebAssembly source map`);
    if (!rel.endsWith('.wasm')) continue;
    modules.push(rel);
    const sections = WebAssembly.Module.customSections(
        new WebAssembly.Module(fs.readFileSync(file)),
        'sourceMappingURL'
    );
    if (sections.length > 0) {
        const url = Buffer.from(sections[0])
            .toString('utf8')
            .replace(/^[\s\S]/, '');
        problems.push(`${rel}: sourceMappingURL section (${url}); rebuild with npm run build:wasm`);
    }
}

if (modules.length === 0) {
    console.error(`❌ [${TAG}] no .wasm in dist/: the AssemblyScript module did not bundle.`);
    process.exit(1);
}

if (problems.length > 0) {
    console.error(`❌ [${TAG}] dist/ ships native debug output:`);
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
}

console.log(`✅ [${TAG}] ${modules.length} module(s), no .wat, no .wasm.map, no sourceMappingURL.`);

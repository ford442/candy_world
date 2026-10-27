#!/usr/bin/env node
/**
 * Guard (#1975): single-player boot never loads the networking code.
 *
 * Walks the static import graph of the built page (dist/index.html's module
 * entry and modulepreloads, then every `import ... from "./x.js"` inside the
 * chunks) and fails if it reaches the lazy `net` chunk or any supabase-js
 * code. Dynamic `import()` edges are not followed: that is how `app` reaches
 * `net` (a `?world=` link, the Worlds panel, `?presence=1`).
 *
 * Run after `vite build`: npm run check:net-chunk
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'net-chunk';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const indexHtml = path.join(dist, 'index.html');

if (!fs.existsSync(indexHtml)) {
    console.error(
        `❌ [${TAG}] ${path.relative(root, indexHtml)} not found: run \`vite build\` first.`
    );
    process.exit(1);
}

/** Markers of supabase-js in minified output: the Realtime join event and the client's headers. */
const SUPABASE_MARKERS = ['phx_join', 'X-Client-Info', 'supabase-js'];
const STATIC_IMPORT_RE = /(?:\bfrom|\bimport)\s*["']([^"']+\.js)["']/g;

const html = fs.readFileSync(indexHtml, 'utf8');
const entries = [
    ...[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
].map((src) => path.resolve(dist, src));

const seen = new Set();
const queue = [...entries];
while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(STATIC_IMPORT_RE))
        queue.push(path.resolve(path.dirname(file), m[1]));
}

const problems = [];
for (const file of seen) {
    const rel = path.relative(dist, file);
    if (/(^|\/)net-[^/]*\.js$/.test(rel)) problems.push(`${rel} is the net chunk`);
    const code = fs.readFileSync(file, 'utf8');
    const marker = SUPABASE_MARKERS.find((m) => code.includes(m));
    if (marker) problems.push(`${rel} contains supabase-js ("${marker}")`);
}

const netChunks = fs.readdirSync(path.join(dist, 'chunks')).filter((f) => /^net-.*\.js$/.test(f));
if (netChunks.length === 0)
    problems.push('no net chunk was built (is the manualChunks rule gone?)');

if (problems.length > 0) {
    console.error(
        `❌ [${TAG}] Single-player boot reaches networking code:\n   ${problems.join('\n   ')}`
    );
    process.exit(1);
}
console.log(
    `✅ [${TAG}] ${seen.size} boot modules; none is ${netChunks.join(', ')} or contains supabase-js.`
);

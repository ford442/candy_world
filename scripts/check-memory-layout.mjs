#!/usr/bin/env node
/**
 * Static check for the AssemblyScript memory layout (no browser, no emsdk).
 *
 * Fails when:
 *   1. two fixed regions in scripts/memory-layout.mjs overlap or are misaligned;
 *   2. the derived layout files are stale;
 *   3. build:wasm's --memoryBase is not the table's HEAP_BASE_FLOOR, or
 *      --initialMemory cannot hold it;
 *   4. a raw fixed offset is declared outside the table (assembly/ or the
 *      TS files that write into AS memory);
 *   5. the built src/wasm/candy_physics.wasm (when present) puts static data
 *      or __heap_base inside a fixed region.
 *
 * Usage: node scripts/check-memory-layout.mjs
 */

import fs from 'fs';
import path from 'path';
import { REPO_ROOT, WASM_PAGE, computeLayout, staleOutputs } from './memory-layout.mjs';

const errors = [];
const fail = (msg) => errors.push(msg);
const layout = computeLayout();

// 1. Overlaps and alignment ---------------------------------------------------
const sorted = [...layout.regions].sort((a, b) => a.offset - b.offset);
for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.offset % 16 !== 0) fail(`${r.name} at ${r.offset} is not 16-byte aligned`);
    if (r.bytes <= 0) fail(`${r.name} has non-positive size ${r.bytes}`);
    const next = sorted[i + 1];
    if (next && next.offset < r.end) {
        fail(
            `${r.name} (${r.offset}..${r.end}) overlaps ${next.name} (${next.offset}..${next.end})`
        );
    }
}

// 2. Derived files ------------------------------------------------------------
for (const file of staleOutputs(layout)) {
    fail(`${file} is stale; run: node scripts/memory-layout.mjs`);
}

// 3. Build flags --------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const buildWasm = pkg.scripts?.['build:wasm'] ?? '';
const flag = (name) => {
    const m = buildWasm.match(new RegExp(`--${name}[ =](\\d+)`));
    return m ? Number(m[1]) : null;
};
const memoryBase = flag('memoryBase');
const initialPages = flag('initialMemory');
if (memoryBase === null) {
    fail('build:wasm has no --memoryBase: the AS heap would start inside the fixed regions');
} else if (memoryBase !== layout.heapBaseFloor) {
    fail(`build:wasm --memoryBase ${memoryBase} != HEAP_BASE_FLOOR ${layout.heapBaseFloor}`);
}
if (initialPages !== null && memoryBase !== null && initialPages * WASM_PAGE <= memoryBase) {
    fail(`--initialMemory ${initialPages} pages does not reach --memoryBase ${memoryBase}`);
}

// 4. Raw offsets outside the table ---------------------------------------------
// Files that address AS linear memory directly. Anything matching here must
// come from the generated layout (or a malloc'd pointer) instead.
const AS_MEMORY_TS_FILES = [
    'src/utils/wasm-loader-core.ts',
    'src/utils/wasm-physics.ts',
    'src/utils/wasm-batch-core.ts',
    'src/systems/material-batcher.ts',
    'src/foliage/animation.ts',
    'src/foliage/batcher/foliage-batcher-types.ts',
    'src/foliage/batcher/foliage-batcher-core.ts',
];
const RAW_OFFSET =
    /\b(?:(?:const|let|var)\s+|this\.)(\w*(?:OFFSET|_START|_PTR|Ptr|Offset))\b(?:\s*:\s*\w+)?\s*=\s*(\d{3,})\b/g;
const scan = (rel) => {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const m of src.matchAll(RAW_OFFSET)) {
        if (Number(m[2]) === 0) continue;
        fail(
            `${rel}: raw fixed offset ${m[1]} = ${m[2]}; add it to scripts/memory-layout.mjs or malloc it`
        );
    }
};
for (const f of fs.readdirSync(path.join(REPO_ROOT, 'assembly'))) {
    if (f.endsWith('.ts') && f !== 'memory_layout.ts') scan(`assembly/${f}`);
}
AS_MEMORY_TS_FILES.forEach(scan);

// 5. Built binary ---------------------------------------------------------------
function readLeb(bytes, pos, signed = false) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
        byte = bytes[pos++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    if (signed && shift < 32 && byte & 0x40) result |= -1 << shift;
    return [result, pos];
}

/** Offsets and lengths of active data segments with an i32.const offset. */
export function activeDataSegments(bytes) {
    const segments = [];
    let pos = 8;
    while (pos < bytes.length) {
        const id = bytes[pos++];
        let size;
        [size, pos] = readLeb(bytes, pos);
        const end = pos + size;
        if (id === 11) {
            let count;
            [count, pos] = readLeb(bytes, pos);
            for (let i = 0; i < count; i++) {
                let flags;
                [flags, pos] = readLeb(bytes, pos);
                let offset = null;
                if (flags === 2) [, pos] = readLeb(bytes, pos); // memory index
                if (flags === 0 || flags === 2) {
                    if (bytes[pos++] !== 0x41)
                        throw new Error('data segment offset is not i32.const');
                    [offset, pos] = readLeb(bytes, pos, true);
                    if (bytes[pos++] !== 0x0b) throw new Error('unterminated data offset expr');
                }
                let len;
                [len, pos] = readLeb(bytes, pos);
                if (offset !== null) segments.push({ offset, len });
                pos += len;
            }
        }
        pos = end;
    }
    return segments;
}

const wasmPath = path.join(REPO_ROOT, 'src/wasm/candy_physics.wasm');
if (fs.existsSync(wasmPath)) {
    const bytes = fs.readFileSync(wasmPath);
    for (const { offset, len } of activeDataSegments(bytes)) {
        if (offset < layout.end) {
            fail(
                `built WASM places static data at ${offset}..${offset + len}, inside the fixed regions (end ${layout.end}); rebuild with npm run build:wasm`
            );
            break;
        }
    }
    const env = {
        abort: () => {
            throw new Error('abort');
        },
        seed: () => 0,
        now: () => 0,
    };
    const { instance } = await WebAssembly.instantiate(bytes, { env });
    const heapBase = instance.exports.getHeapBase?.();
    if (heapBase === undefined) {
        fail('built WASM does not export getHeapBase; rebuild with npm run build:wasm');
    } else if (heapBase < layout.end) {
        fail(`built WASM __heap_base ${heapBase} is inside the fixed regions (end ${layout.end})`);
    }
} else {
    console.log('ℹ️  src/wasm/candy_physics.wasm not built; skipping binary checks');
}

if (errors.length) {
    console.error('❌ Memory layout check failed:');
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
}
console.log(
    `✅ Memory layout OK: ${layout.regions.length} regions, end ${layout.end}, heap base floor ${layout.heapBaseFloor}`
);

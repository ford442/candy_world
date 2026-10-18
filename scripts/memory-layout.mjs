#!/usr/bin/env node
/**
 * Single source of truth for the fixed regions of AssemblyScript linear memory.
 *
 * The AS module addresses these regions with raw load/store at compile-time
 * offsets, and JS writes into some of them directly. Everything else (managed
 * StaticArrays, `malloc` blocks handed to JS) lives in the AS runtime heap,
 * which `--memoryBase` in `build:wasm` places above HEAP_BASE_FLOOR.
 *
 * Emscripten (C++) needs no entry here: it hands out every buffer through its
 * own exported `_malloc`, in a separate linear memory.
 *
 * Usage:
 *   node scripts/memory-layout.mjs           # regenerate the derived files
 *   node scripts/memory-layout.mjs --check   # exit 1 if they are stale
 *
 * Derived files (never edit by hand):
 *   assembly/memory_layout.ts
 *   src/utils/native-memory-layout.ts
 *
 * scripts/check-memory-layout.mjs validates the table, the build flags and the
 * built binary against it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

export const WASM_PAGE = 65536;
const REGION_ALIGN = 16; // v128 loads/stores

/** Capacity constants that size the regions. Exported to AS, TS and JS. */
export const COUNTS = {
    MAX_POSITION_OBJECTS: 256,
    MAX_COLLISION_OBJECTS: 4096,
    COLLISION_STRIDE: 32, // bytes
    GRID_COLS: 16,
    GRID_ROWS: 16,
    MAX_DYNAMIC_PLANTS: 512,
    BATCH_UPLOAD_FLOATS_PER_OBJECT: 8,
    MAX_DISCOVERY_OBJECTS: 3000,
    DISCOVERY_STRIDE: 8, // floats
    MAX_MATERIALS: 2000,
    MATERIAL_STRIDE: 12, // floats
    MATERIAL_RESULT_STRIDE: 4, // floats
};

const C = COUNTS;

/**
 * Regions in address order. `bytes` is the full extent the owner may touch.
 * Offsets are assigned by packing with REGION_ALIGN (or `align`) padding.
 */
export const REGIONS = [
    {
        name: 'POSITION',
        bytes: C.MAX_POSITION_OBJECTS * 16,
        owner: 'assembly/batch.ts, memory.ts',
        note: 'x, y, z, radius per object',
    },
    {
        name: 'ANIMATION',
        bytes: 4096,
        owner: 'assembly/batch.ts',
        note: 'currentY, targetY, velocity, phase',
    },
    { name: 'OUTPUT', bytes: 4096, owner: 'assembly/batch.ts', note: 'batch-operation results' },
    {
        name: 'MATERIAL_DATA',
        bytes: 4096,
        owner: 'assembly/batch.ts',
        note: 'shader analysis output',
    },
    {
        name: 'PLAYER_STATE',
        bytes: 32,
        owner: 'assembly/physics.ts',
        note: 'x, y, z, vx, vy, vz, grounded, pad',
    },
    {
        name: 'COLLISION',
        bytes: C.MAX_COLLISION_OBJECTS * C.COLLISION_STRIDE,
        owner: 'assembly/physics.ts',
        note: 'collision objects',
    },
    {
        name: 'GRID_HEADS',
        bytes: C.GRID_COLS * C.GRID_ROWS * 4,
        owner: 'assembly/physics.ts',
        note: 'collision grid cell heads',
    },
    {
        name: 'GRID_NEXT',
        bytes: C.MAX_COLLISION_OBJECTS * 4,
        owner: 'assembly/physics.ts',
        note: 'collision grid next links',
    },
    {
        name: 'DYNAMIC_RADII',
        bytes: C.MAX_DYNAMIC_PLANTS * 4,
        owner: 'assembly/physics.ts',
        note: 'dynamic foliage radii',
    },
    {
        name: 'BATCH_UPLOAD',
        bytes: C.MAX_COLLISION_OBJECTS * C.BATCH_UPLOAD_FLOATS_PER_OBJECT * 4,
        owner: 'src/utils/wasm-physics.ts',
        note: 'collision batch staging (JS writes, AS reads)',
    },
    {
        name: 'DISCOVERY_BUFFER',
        bytes: C.MAX_DISCOVERY_OBJECTS * C.DISCOVERY_STRIDE * 4,
        align: 256,
        owner: 'assembly/discovery.ts',
        note: 'discovery objects',
    },
    {
        name: 'DISCOVERY_GRID_HEADS',
        bytes: C.GRID_COLS * C.GRID_ROWS * 4,
        owner: 'assembly/discovery.ts',
        note: 'discovery grid cell heads',
    },
    {
        name: 'DISCOVERY_GRID_NEXT',
        bytes: C.MAX_DISCOVERY_OBJECTS * 4,
        owner: 'assembly/discovery.ts',
        note: 'discovery grid next links',
    },
    {
        name: 'MATERIAL_BUFFER',
        bytes: C.MAX_MATERIALS * C.MATERIAL_STRIDE * 4,
        owner: 'assembly/material_batch.ts, src/systems/material-batcher.ts',
        note: 'material flash state',
    },
    {
        name: 'MATERIAL_RESULT',
        bytes: C.MAX_MATERIALS * C.MATERIAL_RESULT_STRIDE * 4,
        owner: 'assembly/material_batch.ts, src/systems/material-batcher.ts',
        note: 'material flash output colors',
    },
];

function alignUp(n, a) {
    return Math.ceil(n / a) * a;
}

/** Assign offsets. Returns { regions: [{...region, offset, end}], end, heapBaseFloor }. */
export function computeLayout(regions = REGIONS) {
    let cursor = 0;
    const placed = regions.map((r) => {
        const offset = alignUp(cursor, r.align ?? REGION_ALIGN);
        const end = offset + r.bytes;
        cursor = end;
        return { ...r, offset, end };
    });
    return { regions: placed, end: cursor, heapBaseFloor: alignUp(cursor, WASM_PAGE) };
}

const HEADER = (comment) =>
    `${comment} GENERATED by scripts/memory-layout.mjs. Do not edit by hand:\n` +
    `${comment} change the table there and run \`node scripts/memory-layout.mjs\`.\n`;

function renderAssembly(layout) {
    const lines = [
        HEADER('//'),
        '// Fixed AssemblyScript linear-memory regions. The AS runtime heap starts at',
        '// HEAP_BASE_FLOOR (build:wasm passes it as --memoryBase).',
        '',
    ];
    for (const [k, v] of Object.entries(COUNTS)) lines.push(`export const ${k}: i32 = ${v};`);
    lines.push('');
    for (const r of layout.regions) {
        lines.push(`// ${r.note} (${r.offset}..${r.end})`);
        lines.push(`export const ${r.name}_OFFSET: i32 = ${r.offset};`);
        lines.push(`export const ${r.name}_BYTES: i32 = ${r.bytes};`);
    }
    lines.push('');
    lines.push(`export const MEMORY_LAYOUT_END: i32 = ${layout.end};`);
    lines.push(`export const HEAP_BASE_FLOOR: i32 = ${layout.heapBaseFloor};`);
    return lines.join('\n') + '\n';
}

function renderTypeScript(layout) {
    const lines = [
        HEADER('//'),
        '// Mirrors assembly/memory_layout.ts for code that writes into AS memory.',
        '',
    ];
    for (const [k, v] of Object.entries(COUNTS)) lines.push(`export const ${k} = ${v};`);
    lines.push('');
    for (const r of layout.regions) {
        lines.push(`/** ${r.note} (${r.offset}..${r.end}) */`);
        lines.push(`export const ${r.name}_OFFSET = ${r.offset};`);
        lines.push(`export const ${r.name}_BYTES = ${r.bytes};`);
    }
    lines.push('');
    lines.push(`export const MEMORY_LAYOUT_END = ${layout.end};`);
    lines.push(`export const HEAP_BASE_FLOOR = ${layout.heapBaseFloor};`);
    return lines.join('\n') + '\n';
}

export const OUTPUTS = [
    { file: 'assembly/memory_layout.ts', render: renderAssembly },
    { file: 'src/utils/native-memory-layout.ts', render: renderTypeScript },
];

/** Returns the list of derived files whose content differs from the table. */
export function staleOutputs(layout = computeLayout()) {
    return OUTPUTS.filter(({ file, render }) => {
        const abs = path.join(REPO_ROOT, file);
        return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== render(layout);
    }).map((o) => o.file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const layout = computeLayout();
    if (process.argv.includes('--check')) {
        const stale = staleOutputs(layout);
        if (stale.length) {
            console.error(`❌ Stale memory layout output: ${stale.join(', ')}`);
            console.error('   Run: node scripts/memory-layout.mjs');
            process.exit(1);
        }
        console.log('✅ memory layout outputs are up to date');
    } else {
        for (const { file, render } of OUTPUTS) {
            fs.writeFileSync(path.join(REPO_ROOT, file), render(layout));
            console.log(`wrote ${file}`);
        }
        console.log(
            `layout end ${layout.end}, heap base floor ${layout.heapBaseFloor} (${layout.heapBaseFloor / WASM_PAGE} pages)`
        );
    }
}

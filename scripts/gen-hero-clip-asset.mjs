/**
 * Generates public/models/hero-clip-test.gltf — the tiny test asset for the
 * hero clip player (docs/HERO_ANIMATION.md).
 *
 * Hand-rolled rather than exported from a DCC tool so the file stays a few KB
 * and reviewable: one cube node, two keyframed TRS clips ("bounce", "spin").
 * Re-run with: node scripts/gen-hero-clip-asset.mjs
 */
import { writeFileSync } from 'node:fs';

const S = 0.5; // half-extent
// 8 corners of a cube.
const positions = [
    [-S, -S, -S],
    [S, -S, -S],
    [S, S, -S],
    [-S, S, -S],
    [-S, -S, S],
    [S, -S, S],
    [S, S, S],
    [-S, S, S],
];
const indices = [
    0,
    2,
    1,
    0,
    3,
    2, // -Z
    4,
    5,
    6,
    4,
    6,
    7, // +Z
    0,
    1,
    5,
    0,
    5,
    4, // -Y
    3,
    7,
    6,
    3,
    6,
    2, // +Y
    0,
    4,
    7,
    0,
    7,
    3, // -X
    1,
    2,
    6,
    1,
    6,
    5, // +X
];

// bounce: translation over 1.2 s, ease-free linear up/down.
const bounceTimes = [0, 0.3, 0.6, 0.9, 1.2];
const bounceValues = [
    [0, 0, 0],
    [0, 0.55, 0],
    [0, 0.8, 0],
    [0, 0.55, 0],
    [0, 0, 0],
];
// spin: a full Y turn over 2 s, five keys so slerp never takes a shortcut.
const spinTimes = [0, 0.5, 1.0, 1.5, 2.0];
const spinValues = [0, 90, 180, 270, 360].map((deg) => {
    const h = (deg * Math.PI) / 360;
    return [0, Math.sin(h), 0, Math.cos(h)];
});

const chunks = [];
let offset = 0;
const push = (typedArray) => {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const view = { byteOffset: offset, byteLength: bytes.byteLength };
    chunks.push(bytes);
    offset += bytes.byteLength;
    // glTF requires 4-byte alignment for accessor-backed buffer views.
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
        chunks.push(new Uint8Array(pad));
        offset += pad;
    }
    return view;
};

const vIndices = push(new Uint16Array(indices));
const vPositions = push(new Float32Array(positions.flat()));
const vBounceIn = push(new Float32Array(bounceTimes));
const vBounceOut = push(new Float32Array(bounceValues.flat()));
const vSpinIn = push(new Float32Array(spinTimes));
const vSpinOut = push(new Float32Array(spinValues.flat()));

const total = chunks.reduce((n, c) => n + c.byteLength, 0);
const merged = new Uint8Array(total);
let cursor = 0;
for (const c of chunks) {
    merged.set(c, cursor);
    cursor += c.byteLength;
}

const min = (axis) => Math.min(...positions.map((p) => p[axis]));
const max = (axis) => Math.max(...positions.map((p) => p[axis]));

const gltf = {
    asset: { version: '2.0', generator: 'candy_world scripts/gen-hero-clip-asset.mjs' },
    scene: 0,
    scenes: [{ name: 'HeroClipTest', nodes: [0] }],
    nodes: [{ name: 'HeroCube', mesh: 0 }],
    meshes: [
        {
            name: 'HeroCube',
            primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }],
        },
    ],
    materials: [
        {
            name: 'CandyGloss',
            pbrMetallicRoughness: {
                baseColorFactor: [1.0, 0.55, 0.79, 1.0],
                metallicFactor: 0.0,
                roughnessFactor: 0.3,
            },
        },
    ],
    accessors: [
        { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
        {
            bufferView: 1,
            componentType: 5126,
            count: positions.length,
            type: 'VEC3',
            min: [min(0), min(1), min(2)],
            max: [max(0), max(1), max(2)],
        },
        {
            bufferView: 2,
            componentType: 5126,
            count: bounceTimes.length,
            type: 'SCALAR',
            min: [bounceTimes[0]],
            max: [bounceTimes[bounceTimes.length - 1]],
        },
        { bufferView: 3, componentType: 5126, count: bounceValues.length, type: 'VEC3' },
        {
            bufferView: 4,
            componentType: 5126,
            count: spinTimes.length,
            type: 'SCALAR',
            min: [spinTimes[0]],
            max: [spinTimes[spinTimes.length - 1]],
        },
        { bufferView: 5, componentType: 5126, count: spinValues.length, type: 'VEC4' },
    ],
    bufferViews: [
        {
            buffer: 0,
            byteOffset: vIndices.byteOffset,
            byteLength: vIndices.byteLength,
            target: 34963,
        },
        {
            buffer: 0,
            byteOffset: vPositions.byteOffset,
            byteLength: vPositions.byteLength,
            target: 34962,
        },
        { buffer: 0, byteOffset: vBounceIn.byteOffset, byteLength: vBounceIn.byteLength },
        { buffer: 0, byteOffset: vBounceOut.byteOffset, byteLength: vBounceOut.byteLength },
        { buffer: 0, byteOffset: vSpinIn.byteOffset, byteLength: vSpinIn.byteLength },
        { buffer: 0, byteOffset: vSpinOut.byteOffset, byteLength: vSpinOut.byteLength },
    ],
    animations: [
        {
            name: 'bounce',
            samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }],
            channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        },
        {
            name: 'spin',
            samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }],
            channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
        },
    ],
    buffers: [
        {
            byteLength: merged.byteLength,
            uri: `data:application/octet-stream;base64,${Buffer.from(merged).toString('base64')}`,
        },
    ],
};

const out = new URL('../public/models/hero-clip-test.gltf', import.meta.url);
writeFileSync(out, `${JSON.stringify(gltf, null, 2)}\n`);
console.log(`Wrote ${out.pathname} (${merged.byteLength} B of buffer data)`);

// tests/season-tint-wgsl.test.mjs
// Builds WGSL for every season-tinted material without a GPU.
//
// CI has no WebGPU, so a broken TSL graph would otherwise only surface as a
// black material in someone's browser. three's node builder runs fine under
// node: this builds each material's shaders through the renderer backend's
// own WGSLNodeBuilder and checks the season frost gate reached the fragment
// stage. three emits WGSL text without validating it (a `.w` swizzle on a
// vec3 builds happily), so when `naga` (cargo install naga-cli) is on PATH
// every shader is also validated; without it the run says so.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ PASS: ${message}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${message}`);
        failed++;
    }
}

const fakeCanvas = () => ({
    style: {},
    width: 1,
    height: 1,
    addEventListener() {},
    removeEventListener() {},
    getContext() {
        return null;
    },
});
globalThis.document = { createElementNS: fakeCanvas, createElement: fakeCanvas };
globalThis.window = globalThis.window ?? {
    location: { search: '' },
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
};

// Instanced attributes the batchers add at runtime are absent on these test
// meshes; three warns and substitutes defaults, which is fine for a build check.
const QUIET =
    /Vertex attribute .* not found|before the backend is initialized|WebGPU is not available/;
for (const level of ['warn', 'log']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        if (typeof args[0] === 'string' && QUIET.test(args[0])) return;
        original(...args);
    };
}

const THREE = await import('three/webgpu');
const { color, varyingProperty } = await import('three/tsl');
const { applySeasonTint } = await import('../src/foliage/material-core/season-nodes.ts');
const { CandyPresets } = await import('../src/foliage/material-core/presets.ts');

const renderer = new THREE.WebGPURenderer();
// Building WGSL needs only the node builder; nothing here may touch a GPU.
renderer.init = async () => renderer;
renderer.render = () => {};
renderer.renderAsync = async () => {};
renderer.compileAsync = async () => {};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
// applySeasonTint's frost gate; present in a fragment shader only if the tint was built.
const FROST_GATE = 'smoothstep( 0.2, 0.85,';

const NAGA = spawnSync('naga', ['--version'], { encoding: 'utf8' }).status === 0;
const wgslDir = NAGA ? mkdtempSync(join(tmpdir(), 'season-wgsl-')) : null;
let validatedShaders = 0;

function validateWgsl(label, stage, code) {
    if (!NAGA) return true;
    const file = join(wgslDir, `${validatedShaders++}.wgsl`);
    writeFileSync(file, code);
    const r = spawnSync('naga', [file], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
    });
    if (r.status === 0) return true;
    const detail = (r.stderr || '')
        .split('\n')
        .filter((line) => /error|= /.test(line))
        .slice(0, 3)
        .map((line) => (line.length > 160 ? `${line.slice(0, 160)}…` : line))
        .join(' | ');
    assert(false, `${label}: ${stage} WGSL fails naga validation — ${detail}`);
    return false;
}

function build(label, object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const shaders = [];
    for (const material of materials) {
        try {
            const target = Array.isArray(object.material) ? object.clone() : object;
            target.material = material;
            const b = renderer.backend.createNodeBuilder(target, renderer);
            b.scene = scene;
            b.material = material;
            b.camera = camera;
            b.context.material = material;
            b.lightsNode = renderer.lighting.getNode(scene, camera);
            b.build();
            if (!validateWgsl(label, 'vertex', b.vertexShader)) return [];
            if (!validateWgsl(label, 'fragment', b.fragmentShader)) return [];
            shaders.push(b.fragmentShader);
        } catch (err) {
            assert(false, `${label}: WGSL build threw — ${err.message}`);
            return [];
        }
    }
    return shaders;
}

function expectTinted(label, object, index = null) {
    const shaders = build(label, object);
    if (shaders.length === 0) return;
    const picked = index === null ? shaders : [shaders[index]];
    assert(
        picked.every((fs) => fs.includes(FROST_GATE)),
        `${label}: builds and carries the season tint`
    );
}

console.log('🍂 Season tint WGSL build');
console.log('=========================\n');

{
    const m = new THREE.MeshStandardNodeMaterial();
    m.colorNode = applySeasonTint(color(0x7cfc00), 'leaf');
    expectTinted('tint on a hex colour', new THREE.Mesh(new THREE.BoxGeometry(), m));

    const im = new THREE.MeshStandardNodeMaterial();
    im.colorNode = applySeasonTint(varyingProperty('vec3', 'vInstanceColor'), 'cap');
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(), im, 4);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
    expectTinted('tint on an instance colour varying', inst);
}

for (const preset of ['Clay', 'Gummy', 'Sugar', 'Velvet', 'Crystal', 'SeaJelly', 'OilSlick']) {
    const m = CandyPresets[preset](0x66aa55, { seasonRole: 'leaf' });
    expectTinted(
        `CandyPresets.${preset}({ seasonRole })`,
        new THREE.Mesh(new THREE.BoxGeometry(), m)
    );
}

{
    const plain = CandyPresets.Clay(0x66aa55);
    const shaders = build(
        'CandyPresets.Clay without a role',
        new THREE.Mesh(new THREE.BoxGeometry(), plain)
    );
    assert(
        shaders.length === 1 && !shaders[0].includes(FROST_GATE),
        'materials without a role stay untinted'
    );
}

{
    const { createTerrainMaterial } = await import('../src/foliage/terrain.ts');
    expectTinted(
        'terrain (ground role)',
        new THREE.Mesh(new THREE.PlaneGeometry(), createTerrainMaterial(0x88cc66))
    );

    const { createWaveformWater } = await import('../src/foliage/water.ts');
    expectTinted('lake water (water role)', createWaveformWater(10, 10));

    const { initGrassSystem } = await import('../src/foliage/grass.ts');
    const grass = initGrassSystem(new THREE.Scene(), 8);
    expectTinted('grass field (leaf role)', grass[0]);

    const { createMaterials } = await import('../src/foliage/mushroom-batcher/materials.ts');
    const mushroomMats = createMaterials();
    const { initInstanceLodAttribute } = await import('../src/foliage/batcher-lod-utils.ts');
    const mushroomGeo = new THREE.CylinderGeometry();
    // The batcher adds these at runtime; without them three folds the reads to constants.
    mushroomGeo.setAttribute(
        'instanceData',
        new THREE.InstancedBufferAttribute(new Float32Array(8), 4)
    );
    const mushroom = new THREE.InstancedMesh(mushroomGeo, mushroomMats, 2);
    mushroom.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    initInstanceLodAttribute(mushroom, 2);
    expectTinted('mushroom stem (bark role)', mushroom, 0);
    expectTinted('mushroom cap (cap role)', mushroom, 1);

    const { initializeTreeBatcherMeshes } =
        await import('../src/foliage/tree-batcher/materials-init.ts');
    const state = {
        initialized: false,
        trunkCapacity: 4,
        sphereCapacity: 4,
        capsuleCapacity: 4,
        helixCapacity: 4,
        roseCapacity: 4,
        accordionLeafCapacity: 4,
        logicIdToInstances: new Map(),
        instanceToLogicId: {},
        _pendingInstances: [],
    };
    initializeTreeBatcherMeshes(state, () => []);
    for (const [part, role] of [
        ['trunks', 'bark'],
        ['spheres', 'leaf'],
        ['capsules', 'bark'],
        ['helices', 'leaf'],
        ['roses', 'petal'],
        ['accordionLeaves', 'leaf'],
    ]) {
        const mesh = state[part];
        expectTinted(`tree ${part} (${role} role)`, mesh);
        assert(
            mesh.userData.seasonRole === role,
            `tree ${part} tags userData.seasonRole = '${role}' for impostors`
        );
    }
}

{
    const { flowerBatcher } = await import('../src/foliage/flower-batcher.ts');
    flowerBatcher.init();
    expectTinted('flower petals (petal role)', flowerBatcher.petalsSimple);
    assert(
        flowerBatcher.petalsSimple.userData.seasonRole === 'petal',
        'flower petals tag userData.seasonRole'
    );

    const { simpleFlowerBatcher } = await import('../src/foliage/simple-flower-batcher.ts');
    simpleFlowerBatcher.init();
    expectTinted('simple flower petals (petal role)', simpleFlowerBatcher.petalMesh);

    const { arpeggioFernBatcher } = await import('../src/foliage/arpeggio-batcher.ts');
    arpeggioFernBatcher.init();
    expectTinted('arpeggio fern (leaf role)', arpeggioFernBatcher.mesh);

    const { dandelionBatcher } = await import('../src/foliage/dandelion-batcher.ts');
    dandelionBatcher.init();
    expectTinted('dandelion (petal role)', dandelionBatcher.mesh);

    const { portamentoPineBatcher } = await import('../src/foliage/portamento-batcher.ts');
    portamentoPineBatcher.init();
    expectTinted('portamento needles (leaf role)', portamentoPineBatcher.needleMesh);
}

if (NAGA) {
    console.log(`\nnaga validated ${validatedShaders} WGSL shaders.`);
    rmSync(wgslDir, { recursive: true, force: true });
} else {
    console.log(
        '\n⚠️  naga not on PATH: WGSL validity NOT checked (build and tint presence only).'
    );
}
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

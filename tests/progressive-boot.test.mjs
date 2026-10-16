/**
 * Tests for the progressive boot pipeline: runBootStage() halt / dependency-skip
 * behaviour, the ?halt / ?boot / ?bootfail URL switches, and the stage registry.
 *
 * Imports the production modules (src/debug/progressive-bootstrap.ts,
 * boot-registry.ts, stages.ts) — nothing is re-implemented here. The browser
 * surface they touch (`window.location`, `document`) is stubbed before import.
 *
 * It also scans src/ so the pipelines stay wired to the registry: the pipeline
 * was once deleted silently by a stale-branch merge (PR #1192 over #1191).
 *
 * Run: npm run test:progressive-boot
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Minimal browser surface, installed before importing the modules --------
const appended = [];
const present = new Set();
globalThis.window = { location: { search: '' } };
globalThis.document = {
    body: { appendChild: (el) => appended.push(el) },
    getElementById: (id) => (present.has(id) ? {} : null),
    createElement: () => ({ style: {}, innerHTML: '' }),
};

const boot = await import('../src/debug/progressive-bootstrap.ts');
const registry = await import('../src/debug/boot-registry.ts');
const stages = await import('../src/debug/stages.ts');

const { DEBUG_STAGES, DEBUG_CONFIG } = stages;
const { STAGE_REGISTRY, BOOT_PRESETS } = registry;
const DEFAULT_STAGES = { ...DEBUG_STAGES };

// The pipeline narrates every stage; keep the test output readable.
const realConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    group: console.group,
    groupEnd: console.groupEnd,
};
let warnings = [];
function muteConsole() {
    console.log = () => {};
    console.group = () => {};
    console.groupEnd = () => {};
    console.warn = (...args) => warnings.push(args.join(' '));
    console.error = () => {};
}
function restoreConsole() {
    Object.assign(console, realConsole);
}

/** Fresh pipeline state for a given URL search string. */
function reset(search = '', { debug = false } = {}) {
    warnings = [];
    present.clear();
    appended.length = 0;
    DEBUG_CONFIG.enabled = debug;
    Object.assign(DEBUG_STAGES, DEFAULT_STAGES);
    return boot.initProgressiveBoot(search);
}

/** Run a stage that records that it ran. */
function runOk(id, ran = []) {
    return boot.runBootStage(id, () => {
        ran.push(id);
    });
}

function runFailing(id, error) {
    return boot.runBootStage(id, () => {
        throw error;
    });
}

const ALL_STAGES = registry.getOrderedStageIds();

const results = [];
async function test(name, fn) {
    muteConsole();
    try {
        await fn();
        results.push({ name, ok: true });
    } catch (err) {
        results.push({ name, ok: false, err });
    } finally {
        restoreConsole();
    }
}

// ---------------------------------------------------------------------------
// Default boot: no switches means no behaviour change
// ---------------------------------------------------------------------------

await test('default: a failing stage is returned, not thrown, and nothing is skipped', async () => {
    const config = reset('');
    assert.equal(config.haltOnFailure, false);
    assert.equal(config.respectDependencies, false);
    assert.equal(stages.isStageGatingActive(), false);

    const boom = new Error('boom');
    const failed = await runFailing('weather', boom);
    assert.equal(failed.success, false);
    assert.equal(failed.error, 'boom');
    assert.equal(failed.cause, boom, 'the raw error is carried for instanceof checks');

    // A critical stage failing does not halt either, and dependents still run.
    const core = await runFailing('core', new Error('no gpu'));
    assert.equal(core.success, false);
    const ran = [];
    const dependent = await runOk('worldCritical', ran);
    assert.equal(dependent.success, true);
    assert.deepEqual(ran, ['worldCritical']);

    const state = boot.getBootPipelineState();
    assert.equal(state.halted, false);
    assert.deepEqual(state.failed, ['weather', 'core']);
    assert.deepEqual(state.skipped, []);
});

await test('default: stage flags are ignored without ?debug / ?boot', async () => {
    reset('');
    const ran = [];
    for (const id of ALL_STAGES) await runOk(id, ran);
    assert.deepEqual(ran, ALL_STAGES, 'every stage runs, even those the sandbox defaults disable');
});

// ---------------------------------------------------------------------------
// URL switches
// ---------------------------------------------------------------------------

await test('?halt turns halting on; ?halt=0|false|off does not', async () => {
    assert.equal(reset('?halt=1').haltOnFailure, true);
    assert.equal(reset('?halt').haltOnFailure, true);
    assert.equal(reset('?halt=0').haltOnFailure, false);
    assert.equal(reset('?halt=false').haltOnFailure, false);
    assert.equal(reset('?halt=OFF').haltOnFailure, false);
    assert.equal(reset('').haltOnFailure, false);
});

await test('?debug halts and starts from the limited sandbox', async () => {
    const config = reset('', { debug: true });
    assert.equal(config.haltOnFailure, true);
    assert.equal(config.respectDependencies, true);
    assert.deepEqual({ ...DEBUG_STAGES }, BOOT_PRESETS.limited);

    const ran = [];
    await runOk('worldGeneration', ran);
    assert.deepEqual(ran, [], 'worldGeneration is disabled in the limited sandbox');
});

await test('?boot=<preset> applies the preset and switches stage gating on by itself', async () => {
    const config = reset('?boot=scene');
    assert.equal(config.preset, 'scene');
    assert.equal(DEBUG_CONFIG.enabled, false, '?boot= must not pretend to be ?debug=1');
    assert.equal(stages.isStageGatingActive(), true);
    assert.equal(config.haltOnFailure, false, 'a preset alone does not halt');
    assert.deepEqual({ ...DEBUG_STAGES }, BOOT_PRESETS.scene);

    const ran = [];
    for (const id of ALL_STAGES) await runOk(id, ran);
    assert.deepEqual(ran, ['core', 'postProcessing'], 'boot stops after the scene pipeline');

    const state = boot.getBootPipelineState();
    assert.deepEqual(state.completed, ['core', 'postProcessing']);
    assert.equal(state.skipped.length, ALL_STAGES.length - 2);
    for (const id of state.skipped) assert.ok(!state.completed.includes(id), `${id} is not both`);
});

await test('an unknown ?boot= preset is ignored with a warning', async () => {
    const config = reset('?boot=nope');
    assert.equal(config.preset, null);
    assert.equal(stages.isStageGatingActive(), false);
    assert.ok(warnings.some((w) => w.includes('Unknown preset "nope"')));
    assert.equal(
        registry.parseBootPreset('?boot=toString'),
        null,
        'inherited keys are not presets'
    );
});

await test('?bootfail=<stage> forces that stage to fail, only when staging is active', async () => {
    assert.equal(reset('?halt=1&bootfail=weather').injectFailure, 'weather');

    const ran = [];
    const failed = await runOk('weather', ran);
    assert.equal(failed.success, false);
    assert.match(failed.error, /injected failure/);
    assert.deepEqual(ran, [], 'the stage body never ran');

    reset('?bootfail=weather');
    const inert = await runOk('weather', ran);
    assert.equal(inert.success, true, 'inert without ?halt / ?debug / ?boot');

    assert.equal(reset('?halt=1&bootfail=toString').injectFailure, null);
    assert.equal(reset('?halt=1&bootfail=nope').injectFailure, null);
});

// ---------------------------------------------------------------------------
// Halt and dependency-skip
// ---------------------------------------------------------------------------

await test('halt: a critical failure throws BootHaltError naming the stage and cause', async () => {
    reset('?halt=1');
    await runOk('core');
    await runOk('weather');

    const cause = new Error('terrain exploded');
    await assert.rejects(
        () => runFailing('worldCritical', cause),
        (err) => {
            assert.ok(err instanceof boot.BootHaltError);
            assert.equal(err.stage, 'worldCritical');
            assert.equal(err.cause, cause);
            assert.match(err.message, /HALTED at stage "worldCritical": terrain exploded/);
            return true;
        }
    );

    const state = boot.getBootPipelineState();
    assert.equal(state.halted, true);
    assert.equal(state.haltStage, 'worldCritical');
    assert.equal(state.haltError, 'terrain exploded');
    assert.deepEqual(state.completed, ['core', 'weather']);
    assert.deepEqual(state.failed, ['worldCritical']);

    // Nothing runs once the pipeline has halted.
    const ran = [];
    const after = await runOk('input', ran);
    assert.deepEqual(ran, []);
    assert.equal(after.skipped, true);
    assert.equal(after.error, 'pipeline already halted');
    assert.deepEqual(boot.getBootPipelineState().skipped, ['input']);
});

await test('halt: a non-critical failure continues and skips its dependents with a reason', async () => {
    reset('?halt=1');
    await runOk('core');
    const failed = await runFailing('weather', new Error('no clouds'));
    assert.equal(failed.success, false, 'non-critical failure is returned, not thrown');

    const ran = [];
    const worldCritical = await runOk('worldCritical', ran);
    assert.equal(worldCritical.success, false);
    assert.equal(worldCritical.skipped, true);
    assert.equal(worldCritical.error, 'dependency "weather" failed');

    // The skip cascades: deferredWorld needs core and worldCritical, and
    // worldCritical is a critical stage that was skipped.
    const deferredWorld = await runOk('deferredWorld', ran);
    assert.equal(deferredWorld.error, 'critical dependency "worldCritical" was skipped');

    // A stage that does not depend on the failure still runs.
    await runOk('audio', ran);
    assert.deepEqual(ran, ['audio']);

    const state = boot.getBootPipelineState();
    assert.equal(state.halted, false);
    assert.deepEqual(state.skipped, ['worldCritical', 'deferredWorld']);
    assert.equal(
        stages.getStageStatus('worldCritical').status,
        stages.StageStatus.SKIPPED,
        'the debug panel sees the skip'
    );
});

await test('halt: dependency skipping is off without a halt/debug switch', async () => {
    reset('');
    await runFailing('weather', new Error('no clouds'));
    const ran = [];
    await runOk('worldCritical', ran);
    assert.deepEqual(ran, ['worldCritical']);
});

await test('halt + preset: a disabled critical dependency blocks its dependents', async () => {
    reset('?halt=1&boot=sandbox');
    DEBUG_STAGES.worldCritical = false;

    const ran = [];
    const gameLoop = await runOk('gameLoop', ran);
    assert.equal(gameLoop.error, 'critical dependency "worldCritical" is disabled');
    assert.deepEqual(ran, []);
});

// ---------------------------------------------------------------------------
// Overlay and console hooks
// ---------------------------------------------------------------------------

await test('reportBootHalt shows an overlay naming the stage, unless the WebGPU screen is up', async () => {
    const halt = new boot.BootHaltError('weather', '[Boot] HALTED', new Error('no clouds'));

    reset('');
    boot.reportBootHalt(halt);
    assert.equal(appended.length, 1);
    assert.match(appended[0].innerHTML, /weather Initialization Failed/);
    assert.match(appended[0].innerHTML, /no clouds/);

    reset('');
    present.add('webgpu-fatal');
    boot.reportBootHalt(halt);
    assert.equal(appended.length, 0, 'the WebGPU fatal screen already explains the fault');
});

await test('window.__bootPipeline exposes the pipeline state and stage flags', async () => {
    reset('?boot=scene');
    boot.installBootDebugHooks();
    const hooks = globalThis.window.__bootPipeline;
    assert.ok(hooks, 'installed on window');
    assert.equal(hooks.state(), boot.getBootPipelineState());
    assert.deepEqual(hooks.stages(), BOOT_PRESETS.scene);

    hooks.preset('full');
    assert.deepEqual(hooks.stages(), BOOT_PRESETS.full);
    assert.equal(stages.isStageGatingActive(), true);
    delete globalThis.window.__bootPipeline;
});

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

await test('registry: stage ids match DebugStages and dependencies are known and earlier', async () => {
    const stageIds = Object.keys(DEFAULT_STAGES).sort();
    assert.deepEqual(Object.keys(STAGE_REGISTRY).sort(), stageIds);
    assert.deepEqual([...ALL_STAGES].sort(), stageIds);

    for (const [id, def] of Object.entries(STAGE_REGISTRY)) {
        for (const dep of def.dependsOn) {
            assert.ok(dep in STAGE_REGISTRY, `${id} depends on unknown stage "${dep}"`);
            assert.ok(
                STAGE_REGISTRY[dep].order < def.order,
                `${id} (order ${def.order}) must come after its dependency ${dep} (order ${STAGE_REGISTRY[dep].order})`
            );
        }
    }

    const orders = ALL_STAGES.map((id) => STAGE_REGISTRY[id].order);
    assert.deepEqual(
        orders,
        [...orders].sort((a, b) => a - b)
    );
});

await test('registry: every preset names every stage, and sandbox/limited match the defaults', async () => {
    const stageIds = Object.keys(DEFAULT_STAGES).sort();
    for (const [name, preset] of Object.entries(BOOT_PRESETS)) {
        assert.deepEqual(Object.keys(preset).sort(), stageIds, `preset ${name} is incomplete`);
        assert.equal(preset.core, true, `preset ${name} must keep core on`);
        for (const [id, on] of Object.entries(preset)) {
            assert.equal(typeof on, 'boolean', `${name}.${id}`);
        }
    }
    assert.deepEqual(BOOT_PRESETS.sandbox, DEFAULT_STAGES);
    assert.deepEqual(BOOT_PRESETS.limited, DEFAULT_STAGES);
    assert.notEqual(BOOT_PRESETS.sandbox, BOOT_PRESETS.limited, 'presets are independent copies');
    assert.equal(BOOT_PRESETS.full.worldGeneration, true);
});

// ---------------------------------------------------------------------------
// Wiring guard: the pipelines must keep calling runBootStage for every stage
// ---------------------------------------------------------------------------

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|js)$/.test(entry.name)) out.push(full);
    }
    return out;
}

await test('wiring: every registry stage has a runBootStage call site and no bypass remains', async () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = walk(srcDir);
    const wired = new Set();
    const bypasses = [];

    for (const file of files) {
        const rel = path.relative(srcDir, file).split(path.sep).join('/');
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/runBootStage\(\s*'(\w+)'/g)) wired.add(m[1]);
        if (
            /StageLoader\.loadStage(Sync)?\(/.test(text) &&
            rel !== 'debug/stages.ts' &&
            rel !== 'debug/progressive-bootstrap.ts'
        ) {
            bypasses.push(rel);
        }
    }

    assert.deepEqual(
        [...wired].sort(),
        Object.keys(STAGE_REGISTRY).sort(),
        'stages without a runBootStage call site would sit at "pending" forever'
    );
    assert.deepEqual(bypasses, [], 'call runBootStage, not StageLoader.loadStage, so halt applies');
});

// ---------------------------------------------------------------------------

let failed = 0;
for (const r of results) {
    if (r.ok) {
        console.log(`✅ PASS: ${r.name}`);
    } else {
        failed++;
        console.log(`❌ FAIL: ${r.name}\n   ${r.err?.stack ?? r.err}`);
    }
}
console.log(`\n📊 Progressive boot tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

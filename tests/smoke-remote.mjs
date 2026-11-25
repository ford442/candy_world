/**
 * Remote smoke: boots a DEPLOYED build (staging or stable) in headless Chromium and fails on
 * any console error, page error, unhandled rejection, failed request, response >= 400, or
 * `crossOriginIsolated === false`, then drives the core flows through real input events.
 *
 * Unlike `tests/smoke-runner.mjs` it never serves `dist/`, never freezes the frame loop, and
 * runs several scenarios against the same URL:
 *
 *   webgpu    boot, world health, enter, pointer lock, WASD, mouse-look, jump, day/night,
 *             generative music on the DSP worklet, build mode B open/close, save write/read
 *   no-dsp    `?no_dsp`: the soundtrack falls back to SynthVoice cleanly
 *   minimal   `?preset=minimal` (safe mode) boots
 *   webgl     navigator.gpu hidden: the WebGL2 fallback boots and shows `WEBGL2 FALLBACK`
 *
 * Usage:
 *   npm run test:smoke:remote -- --url https://storage.noahcohn.com/candy-world/staging/<sha>/
 *   SMOKE_URL=... npm run test:smoke:remote
 * Options:
 *   --url <u>            deployed build (or SMOKE_URL)
 *   --out <dir>          screenshots + smoke-log.json + smoke-summary.json (default smoke-artifacts/)
 *   --only a,b           run only these scenarios
 *   --expect-sha <sha>   fail unless BUILD_INFO.json at the URL names this commit
 *   --webgpu-required    fail the webgpu scenario if the browser has no WebGPU adapter
 *                        (default: on a runner without one it is reported as skipped-by-env)
 *
 * Exit code 0 only if every selected scenario passes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, request } from '@playwright/test';

// ---------------------------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const rawUrl = opt('url', process.env.SMOKE_URL ?? null);
if (!rawUrl) {
    console.error('usage: smoke-remote.mjs --url <deployed build URL> (or SMOKE_URL)');
    process.exit(2);
}
const BASE = rawUrl.replace(/[?#].*$/, '').replace(/\/?$/, '/');
const OUT = path.resolve(opt('out', process.env.SMOKE_OUT ?? 'smoke-artifacts'));
const ONLY = (opt('only') ?? (process.env.SMOKE_ONLY || null))?.split(',').map((s) => s.trim());
const EXPECT_SHA = opt('expect-sha', process.env.SMOKE_EXPECT_SHA ?? null);
const WEBGPU_REQUIRED = flag('webgpu-required') || process.env.SMOKE_WEBGPU_REQUIRED === '1';
const BOOT_TIMEOUT = Number(process.env.SMOKE_BOOT_TIMEOUT_MS ?? 180000);
fs.mkdirSync(OUT, { recursive: true });

// -------------------------------------------------------------------------------- allowlist
/**
 * Known, accepted noise. Each entry needs a reason; anything not matched here fails the run.
 * Keep it short: an entry that stops matching should be deleted, not left to rot.
 */
const ALLOWED_CONSOLE_ERRORS = [
    // { re: /pattern/, why: 'reason this is accepted, and the issue tracking it' },
];
const ALLOWED_REQUEST_FAILURES = [
    // A navigation away (page.close) aborts in-flight fetches; these are not server failures.
    { re: /net::ERR_ABORTED/, onlyAfterClose: true, why: 'aborted by page.close()' },
];

// ------------------------------------------------------------------------------- utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
function note(scenario, kind, text) {
    log.push({ t: new Date().toISOString(), scenario, kind, text });
}

async function launch() {
    // Behind an egress proxy (sandboxed agents, some CI), Chromium needs it named explicitly.
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    return chromium.launch({
        headless: true,
        ...(proxy ? { proxy: { server: proxy } } : {}),
        args: [
            '--no-sandbox',
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,WebGPU',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
        ],
    });
}

/** Open a page with every failure channel wired to `issues`. */
async function openPage(browser, scenario, { hideWebGPU = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const issues = { consoleErrors: [], pageErrors: [], rejections: [], failedRequests: [], badResponses: [] };
    const counts = { requests: 0, responses: 0, consoleMessages: 0 };
    let closing = false;

    page.on('console', (m) => {
        counts.consoleMessages++;
        const text = m.text();
        note(scenario, `console.${m.type()}`, text);
        if (m.type() !== 'error') return;
        if (text.startsWith('[smoke-unhandledrejection]')) {
            issues.rejections.push(text);
            return;
        }
        // A >=400 response is reported once, as a bad response; Chromium's duplicate
        // "Failed to load resource" console line would double-count it.
        if (/^Failed to load resource: the server responded with a status of/.test(text)) return;
        if (ALLOWED_CONSOLE_ERRORS.some((a) => a.re.test(text))) return;
        issues.consoleErrors.push(text);
    });
    page.on('pageerror', (e) => {
        note(scenario, 'pageerror', e.stack ?? e.message);
        issues.pageErrors.push(e.message);
    });
    page.on('request', () => counts.requests++);
    page.on('requestfailed', (r) => {
        const reason = r.failure()?.errorText ?? 'unknown';
        note(scenario, 'requestfailed', `${r.url()} ${reason}`);
        const allowed = ALLOWED_REQUEST_FAILURES.some(
            (a) => a.re.test(reason) && (!a.onlyAfterClose || closing)
        );
        if (!allowed) issues.failedRequests.push(`${r.url()} (${reason})`);
    });
    page.on('response', (r) => {
        counts.responses++;
        if (r.status() >= 400) {
            note(scenario, 'response', `${r.status()} ${r.url()}`);
            issues.badResponses.push(`${r.status()} ${r.url()}`);
        }
    });

    await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (e) => {
            const r = e.reason;
            console.error(`[smoke-unhandledrejection] ${r && r.stack ? r.stack : String(r)}`);
        });
    });
    if (hideWebGPU) {
        // The way a real browser without WebGPU reaches the fallback: the boot probe fails at
        // its `navigator` stage and createRenderer() falls back to WebGL2.
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
        });
    }
    return {
        page,
        issues,
        counts,
        async close() {
            closing = true;
            await context.close().catch(() => {});
        },
    };
}

async function boot(page, qs) {
    const url = `${BASE}?${qs}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: BOOT_TIMEOUT });
    return url;
}

async function enterWorld(page) {
    await page.waitForSelector('#startButton', { state: 'visible', timeout: 60000 });
    await page.evaluate(() => document.getElementById('startButton')?.click());
    await page.waitForFunction(() => window.__smokeProbe?.().worldEntered === true, null, {
        timeout: 60000,
    });
    // Population finishes after the first report; wait for the thresholds, then read the final one.
    await page
        .waitForFunction(
            () => {
                const h = window.__worldHealth;
                return h && h.succeeded >= 1000 && (h.batchers?.totalInstances ?? 0) >= 100;
            },
            null,
            { timeout: BOOT_TIMEOUT, polling: 500 }
        )
        .catch(() => {});
}

const probe = (page) => page.evaluate(() => window.__smokeProbe());
const camQuat = (page) =>
    page.evaluate(() => {
        const q = window.game?.camera?.quaternion;
        return q ? [q.x, q.y, q.z, q.w] : null;
    });

async function shot(page, name) {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file }).catch((e) => note('-', 'screenshot-failed', `${name}: ${e.message}`));
    return path.basename(file);
}

function checkIsolation(page) {
    return page.evaluate(() => window.crossOriginIsolated === true);
}

/** Runs named checks; a check throws to fail. Results land in `flows`. */
function flowRunner(flows) {
    return async (name, fn) => {
        const t0 = Date.now();
        try {
            const detail = await fn();
            flows.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? null });
            console.log(`   ✅ ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
        } catch (e) {
            flows.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
            console.log(`   ❌ ${name} — ${e.message}`);
        }
    };
}
const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

async function waitFor(page, fn, arg, timeout, what) {
    try {
        await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    } catch {
        throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    }
}

// ------------------------------------------------------------------------------- scenarios
const SCENARIOS = {
    async webgpu(browser, run, ctx) {
        const { page } = ctx;
        await run('boot to __sceneReady', async () => `${await boot(page, 'boot=explore&graphics=low')}`);
        await run('crossOriginIsolated === true', async () => assert(await checkIsolation(page), 'crossOriginIsolated is false (COOP/COEP headers missing?)'));
        const renderer = await page.evaluate(() => ({
            hasNavigatorGpu: !!navigator.gpu,
            usingWebGPU: window.usingWebGPU === true,
            badge: document.getElementById('renderer-badge')?.innerText ?? null,
            adapter: window.__gpuContext?.adapterName ?? null,
            fallbackReason: window.rendererFallbackReason ?? null,
        }));
        ctx.renderer = renderer;
        ctx.screenshots.push(await shot(page, 'webgpu-start-screen'));
        if (!renderer.usingWebGPU) {
            const msg = `no WebGPU adapter on this runner (badge=${renderer.badge}, reason=${renderer.fallbackReason})`;
            if (WEBGPU_REQUIRED) await run('renderer is WebGPU', async () => assert(false, msg));
            else {
                console.log(`   ⚠️ ${msg}; flows still run on the fallback renderer`);
                ctx.envNote = msg;
            }
        } else {
            await run('renderer is WebGPU', async () => `badge=${renderer.badge} adapter=${renderer.adapter}`);
        }

        await run('enter world + world health thresholds', async () => {
            await enterWorld(page);
            const h = await page.evaluate(() => window.__worldHealth);
            ctx.health = { succeeded: h?.succeeded, batcherInstances: h?.batchers?.totalInstances, healthy: h?.healthy };
            assert(h, '__worldHealth missing');
            assert(h.succeeded >= 1000, `succeeded ${h.succeeded} < 1000`);
            assert(h.batchers?.totalInstances >= 100, `batcher instances ${h.batchers?.totalInstances} < 100`);
            return ctx.health;
        });

        // The click is the user gesture that starts the generative soundtrack and pointer lock.
        await run('click to start / pointer lock', async () => {
            await page.mouse.click(640, 360);
            await sleep(500);
            const p = await probe(page);
            // Headless Chromium may refuse pointer lock without a focused window; mouse-look below
            // is the behavioural check either way.
            return p.pointerLocked ? 'pointer locked' : 'pointer lock refused by headless browser (mouse-look still checked)';
        });

        await run('WASD moves the player', async () => {
            const a = (await probe(page)).player;
            for (const key of ['KeyW', 'KeyD']) {
                await page.keyboard.down(key);
                await sleep(900);
                await page.keyboard.up(key);
            }
            const b = (await probe(page)).player;
            const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
            assert(d > 0.5, `player moved ${d.toFixed(2)} m on the ground plane`);
            return `${d.toFixed(2)} m`;
        });

        await run('mouse-look changes the camera', async () => {
            const a = await camQuat(page);
            // Under pointer lock the look axis reads movementX/Y. Headless Chromium reports 0 for
            // those on page.mouse moves, so send the same DOM events a real mouse produces.
            for (let i = 0; i < 10; i++) {
                await page.evaluate(() =>
                    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 25, movementY: -6, bubbles: true }))
                );
                await sleep(30);
            }
            await sleep(300);
            const b = await camQuat(page);
            assert(a && b, 'window.game.camera missing');
            const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
            assert(diff > 1e-3, `camera quaternion unchanged (Δ=${diff})`);
            return `Δquat=${diff.toFixed(4)}`;
        });

        await run('movement ability (jump) fires', async () => {
            const y0 = (await probe(page)).player[1];
            await page.keyboard.down('Space');
            let peak = y0;
            for (let i = 0; i < 12; i++) {
                await sleep(60);
                peak = Math.max(peak, (await probe(page)).player[1]);
            }
            await page.keyboard.up('Space');
            assert(peak - y0 > 0.2, `jump rose ${(peak - y0).toFixed(2)} m`);
            return `rose ${(peak - y0).toFixed(2)} m`;
        });

        await run('day/night toggle (N)', async () => {
            const before = (await probe(page)).isNight;
            await page.keyboard.press('KeyN');
            await waitFor(page, (b) => window.__smokeProbe().isNight !== b, before, 10000, 'isNight to flip');
            await page.keyboard.press('KeyN');
            await waitFor(page, (b) => window.__smokeProbe().isNight === b, before, 10000, 'isNight to flip back');
            return `${before ? 'night' : 'day'} → ${before ? 'day' : 'night'} → back`;
        });

        await run('generative music on the DSP worklet', async () => {
            await waitFor(page, () => window.AudioSystem?.generativeEngine?.running === true, null, 30000, 'generative engine running');
            await waitFor(page, () => window.AudioSystem.generativeEngine.voiceBackend === 'dsp', null, 30000, "voiceBackend === 'dsp'");
            return 'running, voices=dsp';
        });

        await run('build mode B opens and closes', async () => {
            await page.keyboard.press('KeyB');
            await waitFor(page, () => window.__smokeProbe().buildMode === true, null, 30000, 'build mode on');
            ctx.screenshots.push(await shot(page, 'webgpu-build-mode'));
            await page.keyboard.press('KeyB');
            await waitFor(page, () => window.__smokeProbe().buildMode === false, null, 10000, 'build mode off');
        });

        await run('save slot write and read', async () => {
            await waitFor(page, () => typeof window.saveGame === 'function', null, 30000, 'save system');
            const ok = await page.evaluate(() => window.saveGame('smoke-remote'));
            assert(ok === true, `saveGame returned ${ok}`);
            const data = await page.evaluate(async () => {
                const d = await window.loadGame('smoke-remote');
                return d ? { slotId: d.slotId ?? d.metadata?.slotId ?? null, keys: Object.keys(d) } : null;
            });
            assert(data, 'loadGame returned nothing');
            return data;
        });

        await sleep(1500);
        ctx.screenshots.push(await shot(page, 'webgpu-in-world'));
    },

    async 'no-dsp'(browser, run, ctx) {
        const { page } = ctx;
        await run('boot ?no_dsp', () => boot(page, 'boot=explore&graphics=low&no_dsp'));
        await run('enter world', () => enterWorld(page));
        await run('soundtrack falls back to SynthVoice', async () => {
            await page.mouse.click(640, 360);
            await waitFor(page, () => window.AudioSystem?.generativeEngine?.running === true, null, 30000, 'generative engine running');
            const v = await page.evaluate(() => window.AudioSystem.generativeEngine.voiceBackend);
            assert(v === 'synth', `voiceBackend=${v}`);
            return 'voices=synth';
        });
    },

    async minimal(browser, run, ctx) {
        const { page } = ctx;
        await run('boot ?preset=minimal', () => boot(page, 'preset=minimal'));
        await run('crossOriginIsolated === true', async () => assert(await checkIsolation(page), 'crossOriginIsolated is false'));
        ctx.screenshots.push(await shot(page, 'minimal-start-screen'));
    },

    async webgl(browser, run, ctx) {
        const { page } = ctx;
        await run('boot with navigator.gpu hidden', () => boot(page, 'boot=explore&graphics=low'));
        await run('WEBGL2 FALLBACK badge', async () => {
            const r = await page.evaluate(() => ({
                usingWebGL: window.usingWebGL === true,
                canvas: document.querySelector('#glCanvas')?.dataset?.renderer ?? null,
                reason: window.rendererFallbackReason ?? null,
                badge: document.getElementById('renderer-badge')?.innerText ?? null,
            }));
            ctx.renderer = r;
            assert(r.usingWebGL && r.badge === 'WEBGL2 FALLBACK', JSON.stringify(r));
            return r;
        });
        await run('crossOriginIsolated === true', async () => assert(await checkIsolation(page), 'crossOriginIsolated is false'));
        ctx.screenshots.push(await shot(page, 'webgl-start-screen'));
        await run('enter world (fallback)', async () => {
            await enterWorld(page);
            const h = await page.evaluate(() => window.__worldHealth);
            ctx.health = { succeeded: h?.succeeded, batcherInstances: h?.batchers?.totalInstances };
            assert(h.succeeded >= 1000, `succeeded ${h.succeeded} < 1000`);
            assert(h.batchers?.totalInstances >= 100, `batcher instances ${h.batchers?.totalInstances} < 100`);
            return ctx.health;
        });
        await run('WASD moves the player (fallback)', async () => {
            await page.mouse.click(640, 360);
            const a = (await probe(page)).player;
            await page.keyboard.down('KeyW');
            await sleep(1200);
            await page.keyboard.up('KeyW');
            const b = (await probe(page)).player;
            const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
            assert(d > 0.5, `moved ${d.toFixed(2)} m`);
            return `${d.toFixed(2)} m`;
        });
        await sleep(1000);
        ctx.screenshots.push(await shot(page, 'webgl-in-world'));
    },
};

// ------------------------------------------------------------------------------------ main
async function buildInfo() {
    // Playwright's request client, so the preflight takes the same network path as the browser.
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const api = await request.newContext(proxy ? { proxy: { server: proxy } } : {});
    try {
        const r = await api.get(`${BASE}BUILD_INFO.json`, { headers: { 'cache-control': 'no-cache' } });
        const page = await api.get(BASE, { headers: { 'cache-control': 'no-cache' } });
        const ph = page.headers();
        const pageHeaders = {
            status: page.status(),
            coop: ph['cross-origin-opener-policy'] ?? null,
            // A server that sends the header twice is joined with ", " here; both copies must agree.
            coep: ph['cross-origin-embedder-policy'] ?? null,
        };
        let info = null;
        if (r.ok()) info = await r.json().catch(() => null);
        return { status: r.status(), info, pageHeaders };
    } catch (e) {
        return { error: e.message };
    } finally {
        await api.dispose();
    }
}

const summary = { url: BASE, startedAt: new Date().toISOString(), scenarios: {} };
console.log(`🍭 Remote smoke against ${BASE}`);
summary.build = await buildInfo();
console.log(`   BUILD_INFO: ${JSON.stringify(summary.build.info ?? summary.build)}`);
console.log(`   index.html headers: ${JSON.stringify(summary.build.pageHeaders ?? null)}`);
let failed = false;
const pre = [];
const preRun = flowRunner(pre);
await preRun('index.html served with COOP same-origin + COEP require-corp', async () => {
    const h = summary.build.pageHeaders;
    assert(h && h.status === 200, `status ${h?.status}`);
    assert(h.coop === 'same-origin', `COOP=${h.coop}`);
    const coep = String(h.coep ?? '').split(/\s*,\s*/);
    assert(coep.length > 0 && coep.every((v) => v === 'require-corp'), `COEP=${h.coep}`);
});
if (EXPECT_SHA) {
    await preRun(`BUILD_INFO.json names ${EXPECT_SHA.slice(0, 12)}`, async () => {
        const info = summary.build.info ?? {};
        const sha = info.commit ?? info.sha ?? JSON.stringify(info);
        assert(String(sha).startsWith(EXPECT_SHA) || EXPECT_SHA.startsWith(String(sha)), `BUILD_INFO has ${sha}`);
    });
}
summary.preflight = pre;
if (pre.some((f) => !f.ok)) failed = true;

const browser = await launch();
try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
        if (ONLY && !ONLY.includes(name)) continue;
        console.log(`\n▶ ${name}`);
        const flows = [];
        const handle = await openPage(browser, name, { hideWebGPU: name === 'webgl' });
        const ctx = { page: handle.page, screenshots: [], renderer: null, health: null };
        const t0 = Date.now();
        try {
            await fn(browser, flowRunner(flows), ctx);
        } catch (e) {
            flows.push({ name: 'scenario', ok: false, error: e.message });
            console.log(`   ❌ scenario aborted — ${e.message}`);
            ctx.screenshots.push(await shot(handle.page, `${name}-failure`));
        }
        await sleep(500);
        const { issues, counts } = handle;
        const ok = flows.every((f) => f.ok) && Object.values(issues).every((list) => list.length === 0);
        for (const [k, list] of Object.entries(issues)) {
            for (const item of list.slice(0, 20)) console.log(`   ✗ ${k}: ${item}`);
        }
        summary.scenarios[name] = {
            ok,
            ms: Date.now() - t0,
            renderer: ctx.renderer,
            health: ctx.health,
            envNote: ctx.envNote ?? null,
            counts: {
                ...counts,
                consoleErrors: issues.consoleErrors.length,
                pageErrors: issues.pageErrors.length,
                unhandledRejections: issues.rejections.length,
                failedRequests: issues.failedRequests.length,
                badResponses: issues.badResponses.length,
            },
            issues,
            flows,
            screenshots: ctx.screenshots,
        };
        console.log(`${ok ? '✅' : '❌'} ${name}: ${JSON.stringify(summary.scenarios[name].counts)}`);
        if (!ok) failed = true;
        await handle.close();
    }
} finally {
    await browser.close().catch(() => {});
    summary.finishedAt = new Date().toISOString();
    summary.ok = !failed;
    fs.writeFileSync(path.join(OUT, 'smoke-summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT, 'smoke-log.json'), JSON.stringify(log, null, 2));
    console.log(`\nArtifacts in ${OUT}`);
}
console.log(failed ? '\n❌ Remote smoke FAILED' : '\n✅ Remote smoke passed');
process.exit(failed ? 1 : 0);

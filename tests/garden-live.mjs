/**
 * Music Garden slice B in a live page: boots the built app (`dist/`) in headless Chromium with a
 * handful of chime tulips and drum puffballs added to a throwaway copy of the map next to the
 * spawn, clicks to start the soundtrack, and checks that the lazy `garden` chunk loads, the
 * `garden-sequencer` frame system runs without errors, and planted notes are sent: to the DSP
 * worklet by default, to SynthVoice with `?no_dsp`.
 *
 * Not in `test:fast` (it needs `npm run build` and Chromium). `dist/` is restored afterwards.
 * It cannot hear anything: it reads `window.__gardenStats()` (the conductor's counters).
 *
 * Run: npm run build && npm run test:garden-live
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'assets');
const PORT = 4173;
/** The player spawns at about (32, -36); stay well inside the garden's 36 m earshot. */
const SPAWN = [32, -36];

const files = fs.readdirSync(DIST);
const chunkFile = path.join(
    DIST,
    files.find((f) => f.startsWith('map-chunks'))
);
const mapFile = path.join(
    DIST,
    files.find((f) => /^map-[A-Za-z0-9_-]+\.json$/.test(f) && !f.startsWith('map-chunks'))
);
const origChunks = fs.readFileSync(chunkFile, 'utf8');
const origMap = fs.readFileSync(mapFile, 'utf8');

function plant(type, id, dx, dz, params = {}) {
    return { id, type, position: [SPAWN[0] + dx, 0, SPAWN[1] + dz], params };
}
const planted = [
    plant('chime_tulip', 'live-t1', -4, 4, { degree: 4, step: 0 }),
    plant('drum_puffball', 'live-d1', -2, -2, { drum: 'kick' }),
    plant('drum_puffball', 'live-d2', 6, 2, { drum: 'hat' }),
    plant('chime_tulip', 'live-t2', 4, -4),
    plant('drum_puffball', 'live-d3', -6, 0),
    plant('chime_tulip', 'live-t3', 2, 3, { degree: 7, step: 6 }),
    plant('drum_puffball', 'live-d4', 1, 6, { drum: 'snare' }),
];

function patchMap() {
    const chunks = JSON.parse(origChunks);
    const map = JSON.parse(origMap);
    for (const e of planted) {
        map.entities.push(e);
        const key = `${Math.floor(e.position[0] / 32)},${Math.floor(e.position[2] / 32)}`;
        (chunks[key] ??= []).push(e.id);
    }
    fs.writeFileSync(mapFile, JSON.stringify(map));
    fs.writeFileSync(chunkFile, JSON.stringify(chunks));
}
function restoreMap() {
    fs.writeFileSync(mapFile, origMap);
    fs.writeFileSync(chunkFile, origChunks);
}

async function boot(browser, qs) {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (m) => {
        const t = m.text();
        if (
            m.type() === 'error' &&
            !/404|candy_native|Device Lost|Device was destroyed|Missing required export|AS init attempt/.test(
                t
            )
        ) {
            errors.push(t);
        }
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('request', (r) => {
        if (/garden/.test(r.url())) requests.push(r.url().split('/').pop());
    });
    await page.goto(`http://localhost:${PORT}/?boot=explore&graphics=low${qs}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
    await page.waitForSelector('#startButton', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('startButton')?.click());
    // The first gesture starts the generative soundtrack (and the DSP worklet with it).
    await page.mouse.click(300, 300);
    let stats = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
        stats = await page.evaluate(() => (window.__gardenStats ? window.__gardenStats() : null));
        if (stats && stats.sent.steps > 8) break;
        await page.waitForTimeout(500);
    }
    const system = await page.evaluate(() => {
        const s = window.__frameScheduler?.stats?.() ?? window.__frameScheduler?.getStats?.();
        return Array.isArray(s) ? (s.find((x) => x.id === 'garden-sequencer') ?? null) : null;
    });
    await page.close();
    return { stats, system, errors, requests };
}

let server = null;
let browser = null;
let failed = false;
try {
    patchMap();
    server = spawn('npm', ['run', 'preview'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('preview did not start')), 20000);
        server.stdout.on('data', (d) => {
            if (d.toString().includes('localhost')) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
    await new Promise((r) => setTimeout(r, 1500));
    browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,WebGPU',
            '--use-gl=angle',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
        ],
    });
    for (const [label, qs, voices] of [
        ['default (DSP worklet)', '', 'dsp'],
        ['?no_dsp (SynthVoice)', '&no_dsp', 'synth'],
    ]) {
        const r = await boot(browser, qs);
        console.log(`${label}:`, JSON.stringify(r.stats));
        assert.ok(r.stats, `${label}: the garden chunk loaded and reports stats`);
        assert.ok(
            r.requests.some((f) => /^garden-[A-Za-z0-9_-]+\.js$/.test(f)),
            `${label}: the garden chunk was fetched`
        );
        assert.equal(r.stats.scanned, planted.length, `${label}: every planted plant was found`);
        assert.ok(r.stats.plants >= 5, `${label}: plants in earshot (${r.stats.plants})`);
        assert.equal(r.stats.voices, voices, `${label}: voices`);
        assert.ok(r.stats.sent.steps > 8, `${label}: steps were played (${r.stats.sent.steps})`);
        assert.ok(
            r.stats.sent[voices] > 8,
            `${label}: notes reached ${voices} (${r.stats.sent[voices]})`
        );
        assert.equal(r.system?.errors, 0, `${label}: the frame system never threw`);
        assert.deepEqual(r.errors, [], `${label}: no console errors`);
        console.log(`✅ ${label}`);
    }
} catch (err) {
    failed = true;
    console.error(`❌ ${err instanceof Error ? err.stack : err}`);
} finally {
    restoreMap();
    await browser?.close().catch(() => {});
    server?.kill();
}
process.exit(failed ? 1 : 0);

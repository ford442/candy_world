#!/usr/bin/env node
// Release polish screenshot grid (#2181): boots a URL (deployed or `vite preview`) and captures
// the viewport matrix x UI surfaces, plus loading / empty / error states, into --out.
//
//   node scripts/capture-polish-grid.mjs --url <url> [--out polish-grid] [--dpr 1,2] [--only states]
//
// Writes <out>/*.png and <out>/grid.json (per-shot console errors and layout overflow checks).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : d;
};
const BASE = opt('url', 'http://localhost:4173/').replace(/\/?$/, '/');
const OUT = path.resolve(opt('out', 'polish-grid'));
const DPRS = opt('dpr', '1,2').split(',').map(Number);
const ONLY = opt('only', 'matrix,states').split(',');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
    [1024, 768],
    [800, 600],
    [600, 900],
];
const ARGS = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every visible fixed/absolute UI element must sit inside the viewport.
const layoutCheck = (page) =>
    page.evaluate(() => {
        const W = innerWidth,
            H = innerHeight,
            bad = [];
        for (const el of document.querySelectorAll('body *')) {
            if (el.tagName === 'CANVAS' || el.closest('canvas')) continue;
            const cs = getComputedStyle(el);
            if (
                cs.position !== 'fixed' ||
                cs.display === 'none' ||
                cs.visibility === 'hidden' ||
                +cs.opacity === 0
            )
                continue;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)
                bad.push(
                    `${el.id || el.className || el.tagName} [${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}]`
                );
        }
        const scroll = document.documentElement.scrollWidth > W + 1;
        return { offscreen: bad.slice(0, 10), hScroll: scroll };
    });

async function boot(dpr, query = '', init) {
    const browser = await chromium.launch({ args: ARGS });
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
    });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
    return { browser, page, errors };
}

async function shot(page, name, errors) {
    await sleep(600);
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const layout = await layoutCheck(page).catch(() => null);
    results.push({ name, file, errors: [...errors], layout });
    console.log(
        name,
        layout?.offscreen.length ? `OFFSCREEN ${layout.offscreen.join(' | ')}` : 'ok'
    );
}

async function matrix(dpr) {
    const { browser, page, errors } = await boot(dpr);
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 300000 });
    for (const [w, h] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: h });
        await shot(page, `start_${w}x${h}@${dpr}x`, errors);
    }
    await page.evaluate(() => document.getElementById('startButton')?.click());
    await sleep(4000);
    const surfaces = [
        ['hud', null, null],
        ['discovery', 'KeyL', 'KeyL'],
        ['journal', () => document.getElementById('ability-journal')?.click(), 'Escape'],
        ['a11y', () => document.getElementById('openA11yBtn')?.click(), 'Escape'],
        ['build', 'KeyB', 'KeyB'],
        ['photo', 'KeyP', 'KeyP'],
    ];
    for (const [w, h] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: h });
        for (const [name, open, close] of surfaces) {
            if (typeof open === 'string') await page.keyboard.press(open);
            else if (open) await page.evaluate(open);
            await sleep(name === 'build' || name === 'photo' ? 1500 : 500);
            await shot(page, `${name}_${w}x${h}@${dpr}x`, errors);
            if (typeof close === 'string') await page.keyboard.press(close);
            await sleep(300);
        }
    }
    // UI scale extremes (accessibility) at the smallest landscape window.
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const scale of [0.75, 2]) {
        await page.evaluate(
            (s) => document.documentElement.style.setProperty('--a11y-ui-scale', String(s)),
            scale
        );
        await shot(page, `uiscale-${scale}_1024x768@${dpr}x`, errors);
    }
    await browser.close();
}

async function states() {
    // Loading: sample the progress bar over the boot.
    {
        const { browser, page, errors } = await boot(1);
        const samples = [];
        const t0 = Date.now();
        for (let i = 0; i < 400; i++) {
            const s = await page
                .evaluate(() => ({
                    pct:
                        document
                            .querySelector(
                                '#loading-progress-fill, .loading-bar-fill, [role=progressbar]'
                            )
                            ?.getAttribute('aria-valuenow') ?? null,
                    text:
                        document
                            .querySelector('#loading-status, .loading-status')
                            ?.textContent?.trim() ?? null,
                    ready: window.__sceneReady === true,
                }))
                .catch(() => ({}));
            samples.push({ t: Date.now() - t0, ...s });
            if ([2, 10, 30].includes(i)) await shot(page, `loading_${i}`, errors);
            if (s.ready) break;
            await sleep(500);
        }
        fs.writeFileSync(path.join(OUT, 'loading-samples.json'), JSON.stringify(samples, null, 1));
        await shot(page, 'loading_ready', errors);
        await browser.close();
    }
    const cases = [
        [
            'error_no-gpu',
            '',
            () => {
                Object.defineProperty(navigator, 'gpu', { get: () => undefined });
                const orig = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function (t, ...a) {
                    return /webgl/.test(t) ? null : orig.call(this, t, ...a);
                };
            },
        ],
        [
            'webgl2-fallback',
            '',
            () => Object.defineProperty(navigator, 'gpu', { get: () => undefined }),
        ],
        [
            'error_wasm-fetch',
            '',
            () => {
                const f = window.fetch;
                window.fetch = (u, ...a) =>
                    String(u).includes('.wasm')
                        ? Promise.reject(new TypeError('Failed to fetch'))
                        : f(u, ...a);
            },
        ],
        ['error_bad-world-link', '?world=does-not-exist-000', null],
        ['safe-mode', '?preset=minimal', null],
        ['reduced-motion', '', null, true],
    ];
    for (const [name, q, init, reduce] of cases) {
        const { browser, page, errors } = await boot(1, q, init);
        if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
        await page
            .waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 })
            .catch(() => {});
        await sleep(3000);
        await shot(page, name, errors);
        await browser.close();
    }
}

if (ONLY.includes('states')) await states();
if (ONLY.includes('matrix')) for (const d of DPRS) await matrix(d);
fs.writeFileSync(path.join(OUT, 'grid.json'), JSON.stringify(results, null, 1));
console.log(`wrote ${results.length} shots to ${OUT}`);

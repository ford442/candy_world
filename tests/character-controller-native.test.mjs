#!/usr/bin/env node
/**
 * Native-assist ABI test for updatePhysicsCPP (emscripten/physics.cpp).
 *
 * This issue froze `updatePhysicsCPP` as an obstacle/trampoline assist only:
 * TS's `resolveCharacterMovement` (src/systems/physics/character-controller.ts)
 * owns gravity, ground-accel/air-accel smoothing, ground Y-snap, coyote time,
 * jump buffering, and jump on every default-state frame. This test drives the
 * real compiled native module (not a mock) through Playwright/Chromium — the
 * Emscripten glue (`public/candy_native_st.js`, MODULARIZE + ENVIRONMENT=web)
 * cannot run under plain Node, so a minimal static server + headless browser
 * page (tests/fixtures/native-physics-harness.html) stands in for the app's
 * own WASM loader — and asserts:
 *
 *   1. With no obstacles registered, native never claims ground contact from
 *      terrain alone (the old `groundY + 1.8f` Y-snap, and the onGround===1
 *      it used to return for it, no longer exist in updatePhysicsCPP).
 *   2. `jump=1` never changes vy (the immediate `onGround==1 && jump` gate
 *      that used to fire `vy = 10.0f` is gone).
 *   3. A trampoline mushroom (obj.type===0, param3>0.5) still reports
 *      onGround===2 with a bounce vy — the one case where native is still
 *      allowed to author vy, per the ABI this issue kept.
 *   4. A non-trampoline mushroom stem still pushes the player's XZ position
 *      away from it (obstacle collision, unaffected by this change).
 *
 * Targets the single-threaded (`_st`) build deliberately: it needs no
 * SharedArrayBuffer / cross-origin-isolation headers, so a plain static
 * file server is enough to load it in a real browser context.
 *
 * SKIPS CLEANLY (exit 0) when `public/candy_native_st.{js,wasm}` are not
 * present — this is a Tier-2 check that needs `npm run build:emcc`
 * (requires emsdk). See docs/CHARACTER_CONTROLLER.md.
 *
 * Run: npm run test:character-native
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WASM_JS = path.join(REPO_ROOT, 'public', 'candy_native_st.js');
const WASM_BIN = path.join(REPO_ROOT, 'public', 'candy_native_st.wasm');

function skip(reason) {
    console.log(`[test:character-native] SKIPPED — ${reason}`);
    console.log(
        '[test:character-native] Needs `npm run build:emcc` (requires emsdk). See docs/CHARACTER_CONTROLLER.md.'
    );
    process.exit(0);
}

if (!fs.existsSync(WASM_JS) || !fs.existsSync(WASM_BIN)) {
    skip('public/candy_native_st.{js,wasm} not found (no build:emcc output in this environment)');
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
};

function startStaticServer(root) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            const filePath = path.normalize(path.join(root, urlPath));
            if (!filePath.startsWith(root)) {
                res.writeHead(403);
                res.end();
                return;
            }
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

let passCount = 0;
let failCount = 0;
function check(name, ok, details = '') {
    if (ok) {
        console.log(`  ok - ${name}`);
        passCount++;
    } else {
        console.log(`  FAIL - ${name}${details ? `: ${details}` : ''}`);
        failCount++;
    }
}

async function main() {
    // Deferred: only imported once we know a build exists, so a machine with
    // neither emsdk output nor @playwright/test installed still skips
    // cleanly instead of crashing on a missing module.
    let chromium;
    try {
        ({ chromium } = await import('@playwright/test'));
    } catch (err) {
        skip(`@playwright/test unavailable (${err.message}) — cannot drive the browser harness`);
    }

    const server = await startStaticServer(REPO_ROOT);
    const { port } = server.address();
    let browser = null;

    try {
        browser = await chromium.launch();
        const page = await browser.newPage();
        page.on('pageerror', (err) => console.log(`[browser pageerror] ${err}`));

        await page.goto(`http://127.0.0.1:${port}/tests/fixtures/native-physics-harness.html`);
        await page.waitForFunction('window.__nativeModuleReady === true', { timeout: 20000 });
        const loadError = await page.evaluate(() => window.__nativeModuleError);

        check('candy_native_st.js loads and instantiates', !loadError, loadError || '');

        if (!loadError) {
            const DELTA = 1 / 60;
            const results = await page.evaluate((delta) => {
                const M = window.__nativeModule;
                const out = {};

                // 1+2. No obstacles: native must not author ground contact or a
                // jump from terrain alone.
                M._initPhysics(0, 50, 0);
                M._setPlayerState(0, 50, 0, 0, -5, 0);
                out.noObstacleOnGround = M._updatePhysicsCPP(delta, 0, 0, 6, 1, 0, 0, 1.0);
                out.noObstacleVy = M._getPlayerVY();

                // 3. Trampoline mushroom (type 0, param3 > 0.5): bounce impulse
                // is still native's to author.
                M._initPhysics(0, 0, 0);
                M._addCollisionObject(0, 0, 0, 0, 0.5, 3.0, 0.5, 2.0, 1);
                M._setPlayerState(0, 3.2, 0, 0, -5, 0);
                out.trampolineOnGround = M._updatePhysicsCPP(delta, 0, 0, 6, 0, 0, 0, 1.0);
                out.trampolineVy = M._getPlayerVY();

                // 4. Non-trampoline mushroom stem: still pushes XZ away.
                M._initPhysics(0, 0, 0);
                M._addCollisionObject(0, 0, 0, 0, 1.0, 3.0, 1.0, 2.0, 0);
                M._setPlayerState(0.3, 0.5, 0, 0, 0, 0);
                M._updatePhysicsCPP(delta, 0, 0, 6, 0, 0, 0, 1.0);
                out.pushedX = M._getPlayerX();
                out.pushedZ = M._getPlayerZ();

                return out;
            }, DELTA);

            check(
                'no obstacles + falling: native reports no ground contact (terrain Y-snap removed)',
                results.noObstacleOnGround === 0,
                `onGround=${results.noObstacleOnGround}`
            );
            check(
                'no obstacles + jump=1: vy untouched by native (jump gate removed)',
                Math.abs(results.noObstacleVy - -5) < 1e-3,
                `vy=${results.noObstacleVy}`
            );
            check(
                'trampoline mushroom: reports bounce contact (onGround === 2)',
                results.trampolineOnGround === 2,
                `onGround=${results.trampolineOnGround}`
            );
            check(
                'trampoline mushroom: bounce vy applied',
                results.trampolineVy > 0,
                `vy=${results.trampolineVy}`
            );
            check(
                'stem push: player pushed to stemR + playerRadius from stem center',
                Math.abs(Math.hypot(results.pushedX, results.pushedZ) - 1.5) < 1e-3,
                `x=${results.pushedX}, z=${results.pushedZ}`
            );
        }
    } finally {
        if (browser) await browser.close();
        server.close();
    }

    console.log('');
    console.log(`Passed: ${passCount}, Failed: ${failCount}`);
    process.exit(failCount > 0 ? 2 : 0);
}

main().catch((err) => {
    console.error('[test:character-native] runner error:', err);
    process.exit(2);
});

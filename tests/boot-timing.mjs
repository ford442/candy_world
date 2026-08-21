// tests/boot-timing.mjs
// Measures Play-path Enter → playable. Not a PR-required gate (headless GPU is flaky).
//
//   node tests/boot-timing.mjs
//   STRICT_BOOT_TIMING=1 node tests/boot-timing.mjs   # 8s product target
//
// Requires a built dist/ (vite preview on :4173), same as npm run test.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import { request } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(readFileSync(join(__dirname, 'boot-budgets.json'), 'utf8'));
const STRICT = process.env.STRICT_BOOT_TIMING === '1';
const playableBudget = STRICT ? budgets.playableAfterEnterMsStrict : budgets.playableAfterEnterMs;

function checkServerOnPort(port) {
    return new Promise((resolve) => {
        const req = request({ hostname: 'localhost', port, path: '/', method: 'GET' }, (res) => {
            resolve(res.statusCode !== undefined);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000);
        req.end();
    });
}

function startVitePreview() {
    return new Promise((resolve, reject) => {
        const proc = spawn('npm', ['run', 'preview'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
        let started = false;
        const timeout = setTimeout(() => {
            if (!started) {
                proc.kill();
                reject(new Error('Vite preview did not start in time'));
            }
        }, 20000);
        const onData = (data) => {
            if (!started && data.toString().includes('localhost')) {
                started = true;
                clearTimeout(timeout);
                resolve({ process: proc, port: 4173 });
            }
        };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('error', reject);
    });
}

async function main() {
    console.log('⏱  Candy World boot-timing (Play path)');
    console.log(`    budget playableAfterEnter=${playableBudget}ms${STRICT ? ' (STRICT)' : ''}\n`);

    let viteServer = null;
    let browser = null;
    let shouldKill = false;
    const report = {
        sceneReadyMs: null,
        playableAfterEnterMs: null,
        playSpawnCount: null,
        worldSize: null,
        streaming: null,
        walkPopEvents: null,
        walkHitchCount: null,
        phases: {},
        ok: true,
        failures: [],
    };

    try {
        if (!(await checkServerOnPort(4173))) {
            viteServer = await startVitePreview();
            shouldKill = true;
        }

        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--enable-unsafe-webgpu',
                '--enable-features=Vulkan,WebGPU',
            ],
        });
        const page = await browser.newPage();
        await page.addInitScript(() => {
            window.__IS_CI_TEST = true;
        });

        const url = 'http://localhost:4173/?boot=instant&graphics=low';
        console.log(`Navigating to ${url}`);
        const navStart = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        await page.waitForFunction(() => window.__sceneReady === true, { timeout: 25000 });
        report.sceneReadyMs = Date.now() - navStart;
        console.log(`✓ __sceneReady in ${report.sceneReadyMs}ms`);

        const enterAt = Date.now();
        await page.waitForFunction(
            () => {
                const el = document.getElementById('instructions');
                return !el || el.style.display === 'none';
            },
            { timeout: playableBudget + 5000 }
        );
        report.playableAfterEnterMs = Date.now() - enterAt;
        console.log(
            `✓ start-screen hidden (playable) in ${report.playableAfterEnterMs}ms after ready`
        );

        report.playSpawnCount = await page.evaluate(() => window.__playSpawnCount ?? null);
        report.worldSize = await page.evaluate(
            () => window.__startupCapabilities?.world?.size ?? window.__streamingTelemetry?.worldSize ?? null
        );
        report.streaming = await page.evaluate(() => window.__streamingTelemetry ?? null);
        console.log(`  spawn count: ${report.playSpawnCount}`);
        console.log(`  world size: ${report.worldSize}`);
        console.log('  streaming:', report.streaming);

        // Walk east across a few 32 m chunks to record pop/hitch telemetry.
        await page.evaluate(() => {
            const walk = window.__updateChunkStreamer;
            if (typeof walk !== 'function') return;
            for (let x = 16; x <= 96; x += 32) walk(x, -36);
        });
        const afterWalk = await page.evaluate(() => window.__streamingTelemetry ?? null);
        report.walkPopEvents = afterWalk?.popEvents ?? null;
        report.walkHitchCount = afterWalk?.hitchCount ?? null;
        console.log(`  after walk: popEvents=${report.walkPopEvents} hitchCount=${report.walkHitchCount}`);

        report.phases = await page.evaluate(() => {
            const names = [
                'Core Scene Setup',
                'Shader Warmup',
                'Map Generation',
                'Map Streaming Phase 1 (Spawn Chunk)',
            ];
            const out = {};
            for (const name of names) {
                const entries = performance.getEntriesByName(name);
                const last = entries[entries.length - 1];
                if (last && typeof last.duration === 'number')
                    out[name] = Math.round(last.duration);
            }
            return out;
        });
        console.log('  phases:', report.phases);

        if (report.sceneReadyMs > budgets.sceneReadyMs) {
            report.failures.push(
                `__sceneReady ${report.sceneReadyMs}ms > ${budgets.sceneReadyMs}ms`
            );
        }
        if (report.playableAfterEnterMs > playableBudget) {
            report.failures.push(
                `playableAfterEnter ${report.playableAfterEnterMs}ms > ${playableBudget}ms`
            );
        }
        if (
            typeof report.playSpawnCount === 'number' &&
            report.playSpawnCount > budgets.maxPlaySpawnCount
        ) {
            report.failures.push(
                `playSpawnCount ${report.playSpawnCount} > ${budgets.maxPlaySpawnCount}`
            );
        }
        report.ok = report.failures.length === 0;

        const fs = await import('fs');
        fs.writeFileSync(
            join(__dirname, 'boot-timing-report.json'),
            JSON.stringify(report, null, 2),
            'utf8'
        );

        console.log('\n' + JSON.stringify(report, null, 2));
        if (!report.ok) {
            console.error('\n❌ boot-timing failed:\n  • ' + report.failures.join('\n  • '));
            process.exitCode = 1;
        } else {
            console.log('\n✅ boot-timing within budget');
        }
    } catch (err) {
        console.error('❌ boot-timing error:', err.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (viteServer?.process && shouldKill) viteServer.process.kill();
    }
}

main();

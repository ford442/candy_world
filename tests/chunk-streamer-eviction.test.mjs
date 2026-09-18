// tests/chunk-streamer-eviction.test.mjs
// Regression test for ChunkStreamer eviction completeness (#foundation-3-of-5).
//
// Before this change, arpeggio ferns, portamento pines and gem-fruit-bearing
// trees had no removeInstance path: ChunkStreamer either left them classified
// as `never` (never evicted, walking the chunk-cell array forever) or, for the
// fern/pine "wrong discriminator" case, evicted the logic object via the
// generic `full` path while leaving their real InstancedMesh instance behind
// as a permanent visual ghost. Either way, repeated load/walk-away/evict
// cycles grow a batcher's live instance count without bound.
//
// This drives the real Play-path ChunkStreamer (via the already-exposed
// window.__updateChunkStreamer hook) through several out-and-back loops and
// asserts, via the already-exposed window.__getBatcherTelemetry() breadcrumb,
// that per-batcher instance counts stop growing once the loop has been
// walked once — i.e. freed slots are actually being reused, not leaked.
//
// Requires a built dist/ (vite preview on :4173), same as `npm run test`.
// Run: npm run test:stream-evict

import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import { request } from 'http';

const SPAWN_X = 8;
const SPAWN_Z = -36;
const CHUNK_SIZE_M = 32;
// PLAY_EVICT_RADIUS_M is 150 (world-extent.ts) → ~5 chunks. Walk well past
// that so evictFarChunks actually fires on the way out.
const FAR_X = SPAWN_X + 8 * CHUNK_SIZE_M;
const STEP_SETTLE_MS = 400;
// Tracked batchers: the ones this change gave a real removeInstance path.
const TRACKED_IDS = ['tree', 'arpeggio', 'portamento', 'gem_canopy', 'mushroom', 'lantern'];
// Small slack for async streaming order/timing noise across cycles — not a
// license for unbounded growth, just jitter tolerance.
const GROWTH_SLACK = 3;

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

function summarize(report) {
    const out = {};
    for (const e of report?.entries ?? []) {
        if (TRACKED_IDS.includes(e.id))
            out[e.id] = { instances: e.instances, capacity: e.capacity };
    }
    out.totalInstances = report?.totalInstances ?? null;
    return out;
}

async function main() {
    console.log('🧹 ChunkStreamer eviction regression (Play path)\n');

    let viteServer = null;
    let browser = null;
    let shouldKill = false;
    const capacityWarnings = [];

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
        // Scoped to the batchers this change touched — CloudBatcher and others
        // hit their own (unrelated, expected) caps independently of eviction.
        const WATCHED_WARNING_TAGS = [
            '[ArpeggioBatcher]',
            '[PortamentoBatcher]',
            '[GemFruitBatcher]',
        ];
        page.on('console', (msg) => {
            const text = msg.text();
            if (
                WATCHED_WARNING_TAGS.some((tag) => text.includes(tag)) &&
                /max (limit|capacity)/i.test(text)
            ) {
                capacityWarnings.push(text);
            }
        });

        const url = 'http://localhost:4173/?boot=instant&graphics=low';
        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForFunction(() => window.__sceneReady === true, { timeout: 25000 });
        console.log('✓ __sceneReady');

        // Let the spawn-ring + first background streams settle.
        await page.waitForTimeout(1500);

        const hasHook = await page.evaluate(
            () =>
                typeof window.__updateChunkStreamer === 'function' &&
                typeof window.__getBatcherTelemetry === 'function'
        );
        if (!hasHook) {
            throw new Error(
                'window.__updateChunkStreamer / window.__getBatcherTelemetry not found — streaming or telemetry hook missing'
            );
        }

        const walkTo = async (x, z) => {
            await page.evaluate(([wx, wz]) => window.__updateChunkStreamer(wx, wz), [x, z]);
            await page.waitForTimeout(STEP_SETTLE_MS);
        };

        const runLoop = async () => {
            for (let x = SPAWN_X; x <= FAR_X; x += CHUNK_SIZE_M) await walkTo(x, SPAWN_Z);
            for (let x = FAR_X; x >= SPAWN_X; x -= CHUNK_SIZE_M) await walkTo(x, SPAWN_Z);
        };

        const snapshot = async () =>
            summarize(await page.evaluate(() => window.__getBatcherTelemetry()));

        const before = await snapshot();
        console.log('baseline:', before);

        await runLoop();
        const afterCycle1 = await snapshot();
        console.log('after cycle 1 (out+back):', afterCycle1);

        await runLoop();
        const afterCycle2 = await snapshot();
        console.log('after cycle 2:', afterCycle2);

        await runLoop();
        const afterCycle3 = await snapshot();
        console.log('after cycle 3:', afterCycle3);

        const failures = [];
        for (const id of TRACKED_IDS) {
            const c0 = before[id]?.instances ?? 0;
            const c1 = afterCycle1[id]?.instances ?? 0;
            const c3 = afterCycle3[id]?.instances ?? 0;
            const capacity = afterCycle3[id]?.capacity ?? Infinity;
            console.log(`  ${id}: baseline=${c0} cycle1=${c1} cycle3=${c3} capacity=${capacity}`);
            // A single out-and-back lap should return to roughly the spawn-ring
            // steady state, not leave stray duplicate registrations behind — the
            // exact symptom of an entity that gets evicted via the generic path
            // (which frees its map-entity id so it respawns) without also being
            // freed from the InstancedMesh that actually rendered it.
            if (c1 > c0 + GROWTH_SLACK) {
                failures.push(
                    `${id}: instance count jumped after a single load/evict lap (baseline=${c0}, cycle1=${c1}, slack=${GROWTH_SLACK}) — evicted entities are respawning as duplicates instead of reusing a freed slot`
                );
            }
            // Repeating the identical lap must not keep piling on more instances.
            if (c3 > c1 + GROWTH_SLACK) {
                failures.push(
                    `${id}: instance count grew across repeated cycles (cycle1=${c1}, cycle3=${c3}, slack=${GROWTH_SLACK}) — eviction is leaking instances`
                );
            }
            if (c3 > capacity) {
                failures.push(`${id}: instances (${c3}) exceeded capacity (${capacity})`);
            }
        }

        if (capacityWarnings.length > 0) {
            failures.push(
                `Batcher "max capacity/limit reached" warning(s) fired during the loop — freed slots are not being reused:\n    ${capacityWarnings.slice(0, 5).join('\n    ')}`
            );
        }

        if (failures.length > 0) {
            console.error(
                '\n❌ chunk-streamer eviction regression:\n  • ' + failures.join('\n  • ')
            );
            process.exitCode = 1;
        } else {
            console.log(
                '\n✅ Batcher instance counts stayed bounded across repeated load/evict cycles'
            );
        }
    } catch (err) {
        console.error('❌ chunk-streamer-eviction test error:', err.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (viteServer?.process && shouldKill) viteServer.process.kill();
    }
}

main();

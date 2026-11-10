/**
 * Every exported C++ function with an OpenMP region, run in the
 * multi-threaded build (public/candy_native.js) with a count above its `if`
 * threshold, the way a cross-origin-isolated browser runs it.
 *
 * Regression for `[Native Err] Too many args to microtask: 20!`: the vendored
 * libomp's generic `__kmp_invoke_microtask` takes at most 15 captured
 * arguments and calls exit() past that, which threw ExitStatus out of
 * batchUpdateLodFactors_c and disabled animate:foliage. See
 * docs/NATIVE_LAYER.md ("OpenMP regions: the 15-argument limit").
 *
 * The MT build is ENVIRONMENT=web,worker, so it runs in headless Chromium
 * behind a COOP/COEP static server. Also checks the LOD batch against the JS
 * path in src/systems/batcher-lod.ts for the same input.
 *
 * Run: npm run test:native-omp-regions
 * Needs npm run build:emcc and Playwright's Chromium; skipped without them
 * unless CANDY_PARITY_REQUIRE_CPP=1.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const REQUIRE = process.env.CANDY_PARITY_REQUIRE_CPP === '1';

function skip(why) {
    if (REQUIRE) {
        console.error(`❌ native-omp-regions: ${why} (CANDY_PARITY_REQUIRE_CPP=1)`);
        process.exit(1);
    }
    console.log(`⏭  native-omp-regions: skipped — ${why}`);
    process.exit(0);
}

if (!fs.existsSync(path.join(pub, 'candy_native.js')) || !fs.existsSync(path.join(pub, 'candy_native.wasm'))) {
    skip('public/candy_native.{js,wasm} missing; run npm run build:emcc');
}

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    skip('playwright is not installed');
}

// ---- COOP/COEP static server: only the MT module and a blank page ----------
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (url.pathname === '/') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><title>omp</title>');
        return;
    }
    const file = path.join(pub, path.basename(url.pathname));
    if (!/^\/candy_native\.(js|wasm)$/.test(url.pathname) || !fs.existsSync(file)) {
        res.writeHead(404, headers);
        res.end();
        return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
    browser = await chromium.launch();
} catch (err) {
    server.close();
    skip(`chromium failed to launch: ${err.message.split('\n')[0]}`);
}

const failures = [];
try {
    const page = await browser.newPage();
    const errs = [];
    page.on('console', (m) => errs.push(m.text()));
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(origin + '/');
    assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'test page must be cross-origin isolated');

    const results = await page.evaluate(async () => {
        const { default: create } = await import('/candy_native.js');
        const native = [];
        // A fresh module per function: exit() in one must not hide another.
        let em = null;
        const fresh = async () => {
            em = await create({
                print: (t) => native.push(String(t)),
                printErr: (t) => native.push(String(t)),
            });
        };
        const f32 = () => new Float32Array(em.HEAPF32.buffer);
        const i32 = () => new Int32Array(em.HEAP32.buffer);
        const alloc = (floats) => em._malloc(floats * 4);
        // Deterministic xorshift so the JS comparison sees the same input.
        let s = 0x2545f491;
        const rnd = () => {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            return ((s >>> 0) / 4294967296) * 2 - 1;
        };
        const out = {};
        const run = async (name, fn) => {
            await fresh();
            const before = native.length;
            try {
                out[name] = { ok: true, value: fn() };
            } catch (err) {
                out[name] = { ok: false, error: String(err?.message ?? err) };
            }
            out[name].native = native.slice(before);
        };

        // LOD factors (if count > 100). Matrices carry translation only.
        const N = 2048;
        const mats = new Float32Array(N * 16);
        const smooth = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            mats[i * 16] = mats[i * 16 + 5] = mats[i * 16 + 10] = mats[i * 16 + 15] = 1;
            mats[i * 16 + 12] = rnd() * 200;
            mats[i * 16 + 13] = rnd() * 10;
            mats[i * 16 + 14] = rnd() * 200;
            smooth[i] = Math.abs(rnd()) * 3;
        }
        const lodArgs = { cam: [3, 2, -5], heroMax: 30, midMax: 80, blendWidth: 6, farCullSq: 150 * 150, blendT: 0.35 };
        await run('batchUpdateLodFactors_c', () => {
            const pm = alloc(N * 16), ps = alloc(N), pst = alloc(6);
            f32().set(mats, pm >> 2);
            f32().set(smooth, ps >> 2);
            const a = lodArgs;
            em._batchUpdateLodFactors_c(pm, ps, N, a.cam[0], a.cam[1], a.cam[2], a.heroMax, a.midMax, a.blendWidth, a.farCullSq, a.blendT, pst);
            const r = { smoothed: Array.from(f32().subarray(ps >> 2, (ps >> 2) + N)), stats: Array.from(i32().subarray(pst >> 2, (pst >> 2) + 6)) };
            em._free(pm); em._free(ps); em._free(pst);
            return r;
        });

        // Matrix compose (if count > 100).
        await run('batchComposeMatrices_c', () => {
            const pp = alloc(N * 3), pq = alloc(N * 4), psc = alloc(N * 3), pm = alloc(N * 16);
            const q = f32();
            for (let i = 0; i < N; i++) { q[(pq >> 2) + i * 4 + 3] = 1; q[(psc >> 2) + i * 3] = q[(psc >> 2) + i * 3 + 1] = q[(psc >> 2) + i * 3 + 2] = 1; q[(pp >> 2) + i * 3] = i; }
            em._batchComposeMatrices_c(pp, pq, psc, pm, N);
            const r = f32()[(pm >> 2) + 5 * 16 + 12];
            em._free(pp); em._free(pq); em._free(psc); em._free(pm);
            return r;
        });

        // Instance pose (if count > 100).
        await run('batchWriteInstancePose_c', () => {
            const pp = alloc(N * 3), pq = alloc(N * 4), psc = alloc(N * 3), pc = alloc(N * 3), pm = alloc(N * 16), pco = alloc(N * 3);
            const q = f32();
            for (let i = 0; i < N; i++) { q[(pq >> 2) + i * 4 + 3] = 1; q[(psc >> 2) + i * 3] = 1; q[(psc >> 2) + i * 3 + 1] = 1; q[(psc >> 2) + i * 3 + 2] = 1; }
            em._batchWriteInstancePose_c(pp, pq, psc, pc, pm, pco, 1.5, N);
            em._free(pp); em._free(pq); em._free(psc); em._free(pc); em._free(pm); em._free(pco);
            return true;
        });

        // Distance cull (if count > 500).
        await run('batchDistanceCull_c', () => {
            const pp = alloc(N * 3), pf = alloc(N);
            const q = f32();
            for (let i = 0; i < N * 3; i++) q[(pp >> 2) + i] = rnd() * 100;
            const v = em._batchDistanceCull_c(pp, pf, N, 0, 0, 0, 50 * 50);
            em._free(pp); em._free(pf);
            return v;
        });

        // Fluid (unconditional regions).
        await run('fluidStep', () => {
            em._fluidInit(128);
            em._fluidAddDensity(64, 64, 10);
            em._fluidAddVelocity(64, 64, 1, 1);
            em._fluidStep(0.016, 0.0001, 0.0001);
            return true;
        });

        // CPU particles (unconditional region), every particle type.
        await run('updateCpuParticlesWASM', () => {
            const P = 4096;
            const ptrs = [alloc(P * 3), alloc(P * 3), alloc(P), alloc(P), alloc(P * 4), alloc(P)];
            const q = f32();
            for (let i = 0; i < P; i++) q[(ptrs[2] >> 2) + i] = (i % 7) * 0.5;
            for (let type = 0; type < 6; type++) {
                em._updateCpuParticlesWASM(...ptrs, P, type, 0.016, 0, 5, 0, 60, 20, 60, 0.1, 0.4, 1, 2, 3, 0.5, 0.5, 0.2, 0.1, 1, 2, 3);
            }
            ptrs.forEach((p) => em._free(p));
            return true;
        });

        return { out, mats: Array.from(mats), smooth: Array.from(smooth), lodArgs };
    });

    for (const [name, r] of Object.entries(results.out)) {
        const bad = r.native.filter((l) => /Too many args to microtask|abort|exit/i.test(l));
        if (!r.ok || bad.length) {
            failures.push(`${name}: ${r.ok ? '' : `threw ${r.error}; `}${bad.join(' | ')}`);
        } else {
            console.log(`✓ ${name}`);
        }
    }

    // ---- LOD parity with the JS path in batcher-lod.ts ---------------------
    const lod = results.out.batchUpdateLodFactors_c;
    if (lod?.ok) {
        const { computeTargetLodFactorSq } = await import('../src/systems/batcher-lod.ts').catch(() => ({}));
        const a = results.lodArgs;
        const cfg = { heroMax: a.heroMax, midMax: a.midMax, blendWidth: a.blendWidth, farCull: Math.sqrt(a.farCullSq) };
        const target = computeTargetLodFactorSq ?? null;
        if (!target) {
            failures.push('computeTargetLodFactorSq is not exported from batcher-lod.ts; cannot compare to JS');
        } else {
            const N = results.smooth.length;
            let maxErr = 0;
            for (let i = 0; i < N; i++) {
                const dx = results.mats[i * 16 + 12] - a.cam[0];
                const dy = results.mats[i * 16 + 13] - a.cam[1];
                const dz = results.mats[i * 16 + 14] - a.cam[2];
                const t = target(dx * dx + dy * dy + dz * dz, cfg);
                const cur = results.smooth[i];
                const want = Math.abs(t - cur) > 1e-3 ? cur + (t - cur) * a.blendT : t;
                maxErr = Math.max(maxErr, Math.abs(want - lod.value.smoothed[i]));
            }
            if (maxErr > 1e-4) failures.push(`LOD smoothed factors differ from the JS path by ${maxErr}`);
            else console.log(`✓ LOD factors match the JS path (max |Δ| ${maxErr.toExponential(1)})`);
            assert.equal(lod.value.stats[5], N, 'stats total');
            assert.equal(lod.value.stats.slice(0, 4).reduce((x, y) => x + y, 0), N, 'every instance lands in one bucket');
        }
    }
    const stray = errs.filter((l) => /Too many args to microtask/.test(l));
    if (stray.length && !failures.length) failures.push(stray.join(' | '));
} finally {
    await browser.close();
    server.close();
}

if (failures.length) {
    console.error('❌ native-omp-regions:\n  ' + failures.join('\n  '));
    process.exit(1);
}
console.log('✓ native-omp-regions: every OpenMP region runs in the MT build');

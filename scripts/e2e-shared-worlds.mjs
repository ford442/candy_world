#!/usr/bin/env node
/**
 * Shared worlds end to end (#1975), in three browsers against a running
 * Supabase stack: A (owner) publishes and opens the link, B joins through an
 * editor invite, C opens the link in a fresh context (a private window).
 * Checks the acceptance criteria in a real browser: same entities for the
 * same link (snapshot hash), 50 interleaved place/move/remove/undo ops
 * converging, shared progress within 1 s, the host's write-back, viewer
 * lock, and malformed / over-cap / rate-limited commands dropped and logged.
 *
 * Needs: a stack with the migrations applied (`supabase start`), its URL and
 * publishable key, and the app dev server built against them:
 *
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<key> npx vite --port 5173
 *   npm run e2e:shared-worlds
 *
 * Env: CANDY_E2E_APP_URL (default http://127.0.0.1:5173/), CANDY_E2E_SUPABASE_URL
 * (default http://127.0.0.1:54321), CANDY_E2E_FUNCTIONS_URL (serve
 * validate-world from elsewhere, e.g. `deno run` of
 * supabase/functions/validate-world/index.ts, when the stack has no edge runtime).
 * Not part of test:fast: it needs the stack and a WebGPU-capable Chromium.
 */

import { chromium } from 'playwright';

const BASE = process.env.CANDY_E2E_APP_URL ?? 'http://127.0.0.1:5173/';
const SUPABASE_URL = (process.env.CANDY_E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(
    /\/$/,
    ''
);
const FN = process.env.CANDY_E2E_FUNCTIONS_URL ?? null;
const FLAGS = 'boot=instant&graphics=low';

const UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const results = [];
const check = (ok, label, detail = '') => {
    results.push({ ok, label });
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withFlags = (url) => `${url}${url.includes('?') ? '&' : '?'}${FLAGS}`;

const browser = await chromium.launch({
    headless: true,
    args: [
        '--no-sandbox',
        '--enable-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--enable-unsafe-webgpu',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
    ],
});

async function player(name) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 640, height: 400 } });
    // Present as a player, not automation: the awakened store is off under automation.
    await ctx.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
    );
    if (FN) {
        // validate-world served outside the stack (no edge runtime): forward to it.
        await ctx.route(`${SUPABASE_URL}/functions/v1/validate-world`, async (route) => {
            const req = route.request();
            const headers = { ...req.headers() };
            delete headers.host;
            delete headers['content-length'];
            const res = await fetch(FN, {
                method: req.method(),
                headers,
                body: req.method() === 'POST' ? req.postData() : undefined,
            });
            await route.fulfill({
                status: res.status,
                headers: Object.fromEntries(res.headers),
                body: Buffer.from(await res.arrayBuffer()),
            });
        });
    }
    const page = await ctx.newPage();
    const p = { name, ctx, page, errors: [], logs: [] };
    page.on('console', (m) => {
        const t = m.text();
        if (m.type() === 'error') p.errors.push(t.slice(0, 240));
        if (/SharedWorlds|Presence\]/.test(t)) p.logs.push(t.slice(0, 240));
    });
    page.on('pageerror', (e) => p.errors.push('pageerror ' + e.message.slice(0, 240)));
    return p;
}

async function boot(p, url) {
    await p.page.goto(withFlags(url), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 300000 });
    await p.page.waitForFunction(
        async () => (await import('/src/world/document/lazy.ts')).isWorldEntered(),
        null,
        { timeout: 300000, polling: 500 }
    );
}

async function waitRoom(p) {
    await p.page.waitForFunction(
        () => !!window.__sharedWorld && window.__sharedWorld.subscribedOnce,
        null,
        { timeout: 120000, polling: 250 }
    );
}

const roomInfo = (p) =>
    p.page.evaluate(() => {
        const r = window.__sharedWorld;
        return {
            peer: r.peerId,
            host: r.hostId,
            hash: r.hash(),
            role: r.role,
            stats: JSON.parse(JSON.stringify(r.stats)),
        };
    });

async function op(p, kind, args) {
    return p.page.evaluate(
        async ({ kind, args }) => {
            const { editHistory } = await import('/src/systems/edit-history.ts');
            const wc = await import('/src/systems/world-commands.ts');
            const snap = (id, x, z) => ({
                schemaVersion: 2,
                id,
                entity: {
                    type: 'mushroom',
                    position: [x, 0.5, z],
                    rotation: { quat: [0, 0, 0, 1] },
                    scale: 1,
                    variant: 'regular',
                    hasFace: false,
                    placement: 'absolute',
                    params: {},
                },
            });
            const replica = window.__sharedWorld.replica;
            if (kind === 'place')
                return editHistory.execute(new wc.PlaceCommand(snap(args.id, args.x, args.z)));
            if (kind === 'undo') return editHistory.undo();
            const live = [...replica.materialize().entries()].filter(([, s]) => s);
            if (live.length === 0) return 'empty';
            const [id, from] = live[Math.floor(args.pick * live.length)];
            if (kind === 'move') {
                const to = JSON.parse(JSON.stringify(from));
                to.entity.position = [args.x, 0.5, args.z];
                return editHistory.execute(new wc.MoveCommand(from, to));
            }
            if (kind === 'remove') return editHistory.execute(new wc.RemoveCommand(from));
            return 'unknown ' + id;
        },
        { kind, args }
    );
}

/** Positions of every authored entity the replica knows, read off the live world objects. */
const liveWorld = (p) =>
    p.page.evaluate(async () => {
        const { animatedFoliage } = await import('/src/world/state.ts');
        const states = window.__sharedWorld.replica.materialize();
        const out = {};
        for (const id of states.keys()) out[id] = null;
        for (const obj of animatedFoliage) {
            const id = obj?.userData?.mapEntityId;
            if (typeof id === 'string' && id in out)
                out[id] = [
                    Math.round(obj.position.x * 10) / 10,
                    Math.round(obj.position.z * 10) / 10,
                ];
        }
        const expected = {};
        for (const [id, s] of states)
            expected[id] = s
                ? [
                      Math.round(s.entity.position[0] * 10) / 10,
                      Math.round(s.entity.position[2] * 10) / 10,
                  ]
                : null;
        return { live: out, expected };
    });

const sortJson = (o) =>
    JSON.stringify(
        Object.keys(o)
            .sort()
            .map((k) => [k, o[k]])
    );

try {
    // 1. A publishes this seed's world.
    const A = await player('A');
    await boot(A, `${BASE}?seed=12345`);
    const pub = await A.page.evaluate(async () => {
        const m = await import('/src/systems/net/shared-worlds.ts');
        const r = await m.publishCurrentWorld({ title: 'E2E Grove', visibility: 'unlisted' });
        if (!r.ok) return { error: `${r.code}: ${r.message}` };
        return { url: r.url, invite: await m.createInviteLink(r.world), id: r.world.id };
    });
    check(!pub.error, 'A publishes an unlisted world', pub.error ?? pub.url);
    if (pub.error) throw new Error(pub.error);

    // 2. A opens the share link (live room); B joins through an invite.
    await boot(A, pub.url);
    await waitRoom(A);
    const B = await player('B');
    await boot(B, pub.invite);
    await waitRoom(B);
    await sleep(1500);
    let a = await roomInfo(A);
    let b = await roomInfo(B);
    check(
        a.role === 'owner' && b.role === 'editor',
        'roles: A owner, B editor (invite redeemed)',
        `${a.role}/${b.role}`
    );
    check(
        a.host === b.host && a.host === a.peer,
        'both elect A (first joiner) as host',
        `A sees ${a.host}, B sees ${b.host}; A is ${a.peer}`
    );

    // 3. 50 interleaved ops, sent concurrently.
    let seq = 0;
    const rnd = (() => {
        let s = 7;
        return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    })();
    const pending = [];
    for (let i = 0; i < 50; i++) {
        const who = rnd() < 0.5 ? A : B;
        const r = rnd();
        const kind = i < 6 || r < 0.35 ? 'place' : r < 0.7 ? 'move' : r < 0.85 ? 'remove' : 'undo';
        const args = {
            id: `e2e-${who.name}-${seq++}`,
            x: Math.round(rnd() * 400 - 200) / 10,
            z: Math.round(rnd() * 400 - 200) / 10,
            pick: rnd(),
        };
        pending.push(op(who, kind, args));
        if (i % 3 === 2) await Promise.all(pending.splice(0));
        await sleep(Math.floor(rnd() * 120));
    }
    await Promise.all(pending);
    let converged = false;
    for (let t = 0; t < 40 && !converged; t++) {
        await sleep(250);
        a = await roomInfo(A);
        b = await roomInfo(B);
        converged = a.hash === b.hash;
    }
    check(
        converged,
        '50 interleaved place/move/remove/undo ops converge (equal snapshot hash)',
        `${a.hash} / ${b.hash}; A sent ${a.stats.sent} applied ${a.stats.applied}, B sent ${b.stats.sent} applied ${b.stats.applied}`
    );
    const wa = await liveWorld(A);
    const wb = await liveWorld(B);
    check(
        sortJson(wa.live) === sortJson(wa.expected),
        "A's live world shows what its replica holds",
        `${Object.keys(wa.live).length} authored entities`
    );
    check(
        sortJson(wb.live) === sortJson(wb.expected),
        "B's live world shows what its replica holds"
    );
    check(
        sortJson(wa.live) === sortJson(wb.live),
        'A and B show the same entities in the same places'
    );

    // 4. Shared progress within 1 s.
    const t0 = Date.now();
    await A.page.evaluate(async () =>
        (await import('/src/systems/discovery.ts')).discoverySystem.discover(
            'e2e_shared_find',
            'Shared find',
            '🧪'
        )
    );
    await B.page.waitForFunction(
        async () =>
            (await import('/src/systems/discovery.ts')).discoverySystem.isDiscovered(
                'e2e_shared_find'
            ),
        null,
        { timeout: 5000, polling: 20 }
    );
    const discoveryMs = Date.now() - t0;
    check(discoveryMs < 1000, 'a discovery in A shows in B within 1 s', `${discoveryMs} ms`);
    const t1 = Date.now();
    const marked = await B.page.evaluate(async () => {
        const api = await import('/src/systems/awakened-persistence-api.ts');
        api.initAwakenedPersistenceIfNeeded();
        await new Promise((r) => setTimeout(r, 200));
        return api.awakenedPersistence.markAwakened(424242, { type: 'luminous_plant' });
    });
    let awakenedMs = -1;
    try {
        await A.page.waitForFunction(
            async () =>
                (
                    await import('/src/systems/awakened-persistence-api.ts')
                ).awakenedPersistence.isAwakened(424242),
            null,
            { timeout: 5000, polling: 20 }
        );
        awakenedMs = Date.now() - t1 - 200;
    } catch {
        /* reported below */
    }
    check(
        marked && awakenedMs >= 0 && awakenedMs < 1000,
        'awakening a flower in B awakens it in A within 1 s',
        `${awakenedMs} ms`
    );

    // 4b. A builder's cursor shows for the other builder.
    await B.page.evaluate(async () => {
        const state = await import('/src/systems/build-mode-state.ts');
        state.reportBuildModeState(true, false);
        state.reportBuildCursor(true, 3, 1, -4, 'place');
    });
    let cursorSeen = false;
    try {
        await A.page.waitForFunction(
            async () => {
                const { presenceSystem } = await import('/src/systems/net/presence.ts');
                const root = presenceSystem.scene?.getObjectByName('remote-build-cursors');
                return !!root?.children.some((c) => c.visible && Math.abs(c.position.x - 3) < 0.01);
            },
            null,
            { timeout: 3000, polling: 50 }
        );
        cursorSeen = true;
    } catch {
        /* reported below */
    }
    check(cursorSeen, "B's build cursor shows in A's world");
    await B.page.evaluate(async () => {
        const state = await import('/src/systems/build-mode-state.ts');
        state.reportBuildCursor(false, 0, 0, 0, 'place');
        state.reportBuildModeState(false, false);
    });

    // 5. Host writes back; a private window opens the link and sees the same world.
    await A.page.evaluate(async () => {
        window.__sharedWorld.dirty = true;
        await window.__sharedWorld.writeBack();
    });
    await sleep(800);
    a = await roomInfo(A);
    check(a.stats.writes >= 1, 'the host wrote the merged world back', `${a.stats.writes} writes`);
    const C = await player('C');
    await boot(C, pub.url);
    await waitRoom(C);
    await sleep(1500);
    const c = await roomInfo(C);
    check(c.role === null, 'a fresh browser opens the unlisted link as a stranger');
    check(
        c.hash === a.hash,
        'C (private window) holds the same entities (snapshot hash equal)',
        `${c.hash} vs ${a.hash}`
    );
    const wc = await liveWorld(C);
    check(sortJson(wc.live) === sortJson(wa.live), "C's live world matches A's");
    const lock = await C.page.evaluate(async () =>
        (await import('/src/systems/build-mode-state.ts')).getBuildModeLock()
    );
    check(!!lock, 'build mode is locked for a viewer', lock ?? '');
    const seasons = await Promise.all(
        [A, C].map((p) =>
            p.page.evaluate(async () => {
                const s = (await import('/src/systems/season-controller.ts')).getSeasonState();
                return JSON.stringify({
                    seed: (await import('/src/world/world-seed.ts')).getWorldSeed(),
                    current: s.current ?? s.season ?? null,
                    next: s.next ?? null,
                });
            })
        )
    );
    check(seasons[0] === seasons[1], 'same seed and season for the same moment', seasons[0]);
    const viewerEdit = await op(C, 'place', { id: 'viewer-try', x: 1, z: 1, pick: 0 }).catch((e) =>
        String(e)
    );
    await sleep(1000);
    a = await roomInfo(A);
    const aHas = await A.page.evaluate(
        () => window.__sharedWorld.replica.stateOf('viewer-try') !== undefined
    );
    check(!aHas, "a viewer's edit is never broadcast", `local result ${viewerEdit}`);

    // 6. Rejected inbound commands are dropped and logged, never applied.
    const before = (await roomInfo(A)).stats.dropped;
    await B.page.evaluate(async () => {
        const room = window.__sharedWorld;
        const send = (payload) =>
            room.editChannel.send({ type: 'broadcast', event: 'cmd', payload });
        const snap = (id, x, z) => ({
            schemaVersion: 2,
            id,
            entity: { type: 'mushroom', position: [x, 0.5, z], placement: 'absolute', params: {} },
        });
        await send({
            author: room.peerId,
            seq: 900001,
            rev: 1,
            baseRev: 0,
            command: { type: 'explode' },
        });
        await send({
            author: room.peerId,
            seq: 900002,
            rev: 1,
            baseRev: 0,
            command: {
                type: 'batch',
                commands: Array.from({ length: 70 }, (_, i) => ({
                    type: 'place',
                    snapshot: snap(`flood-${i}`, i, 50),
                })),
            },
        });
        for (let i = 0; i < 80; i++)
            await send({
                author: 'spammer-peer',
                seq: i + 1,
                rev: 1,
                baseRev: 0,
                command: { type: 'place', snapshot: snap(`spam-${i}`, 60 + i, 60) },
            });
    });
    await sleep(1500);
    const after = (await roomInfo(A)).stats.dropped;
    const flood = await A.page.evaluate(
        () => window.__sharedWorld.replica.stateOf('flood-0') !== undefined
    );
    const spamApplied = await A.page.evaluate(
        () =>
            Array.from({ length: 80 }, (_, i) =>
                window.__sharedWorld.replica.stateOf(`spam-${i}`)
            ).filter(Boolean).length
    );
    check(
        (after.malformed ?? 0) > (before.malformed ?? 0),
        'a malformed command is dropped and logged'
    );
    check(
        (after.over_cap ?? 0) > (before.over_cap ?? 0) && !flood,
        'an over-cap command is dropped, never applied'
    );
    check(
        (after.rate_limited ?? 0) > 0 && spamApplied < 80,
        'a flood beyond the rate limit is dropped',
        `${spamApplied}/80 within the burst`
    );
    const logged = A.logs.filter((l) => l.includes('Dropped inbound')).length;
    check(logged > 0, 'drops are logged', `${logged} log lines`);

    for (const p of [A, B, C])
        check(
            p.errors.length === 0,
            `${p.name}: no console errors`,
            p.errors.slice(0, 3).join(' | ')
        );
} catch (err) {
    check(false, 'harness', err.stack);
} finally {
    await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

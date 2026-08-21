# Capstone roadmap — Presence + Part II door (#1492)

**Epic tracker** for Siphon Part I → Part II. Landed on `main` 2026-08-12; leftover
CI + docs hygiene closed 2026-08-19. This is **not one PR** — it sequenced
multiplayer polish with the next signature content layer so foundation work was
not skipped.

## North-star vision

Candy World (“Siphon Part I”) is becoming a **music-reactive candy nature preserve** with
vertical exploration (Sky Islands), living fauna (boids), awakened flora memory, and optional
co-presence.

| Horizon             | Experience                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Now (scaffolds)** | Opt-in Supabase presence (`src/systems/net/presence.ts`), remote avatars, share URL + seed; fauna flocks; sky roosts                             |
| **Near**            | Rooms that feel alive: emoji avatars → candy silhouette explorers, biome-tinted trails, “someone is listening to the same grove” cues            |
| **Mid**             | **Part II door**: a new major biome layer (e.g. _Subterranean Sugar Caves_ or _Festival Night Market_) unlocked by discovery / awakened progress |
| **Far**             | Seeded persistent worlds, seasonal weather narratives, lightweight social photo gallery, optional VR/WebXR look-around                           |

## What already exists

| Area                  | Location / notes                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Supabase client       | `@supabase/supabase-js`; `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`                               |
| Presence core         | `PresenceSystem` — ~10 Hz pose, ephemeral session ids, no accounts, room = world seed                 |
| Avatars + UI          | `remote-avatars.ts`, `src/ui/presence-panel.ts`, start-screen opt-in, recent ARIA                     |
| Fauna                 | C++ boids (#1478), `src/systems/fauna/*`, sky-island roosts                                           |
| Awakened flora        | `awakened-persistence` (flagged `?awakened`)                                                          |
| Vertical exploration  | Sky Islands — `docs/SKY_ISLANDS.md`, `sky-island-graph.ts`                                            |
| Lazy net (foundation) | `src/systems/net/lazy.ts` (`import()` when flag on) → `presence` chunk; see `docs/APP_CHUNK_SPLIT.md` |
| Content layer         | Sugar Caves — `docs/SUGAR_CAVES_SHIP.md`, `part-ii-unlock.ts`                                         |

## Prerequisites (do not skip)

| #   | Gate                                                              | Status (2026-08-19)                                                                              |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | TS / ESLint ratchets green + CI blocks regressions (#1493)        | **Landed** — `tsc` 0 errors; ESLint fail-closed (`lint.yml` + `typecheck.yml`)                   |
| 2   | App-chunk + flag lazy net / photo / generative (#1495)            | **Landed** — `app` ~617 KB raw; `budget:check` 620 KB (600 KB peels TDZ); stretch 500 KB remains |
| 3   | Shared WebGPU device stable (#1448) + GPU foliage default (#1496) | **Landed** — `gpu-context.ts` singleton; GPU foliage default-on                                  |
| 4   | Issue hygiene — close/narrow stale split tickets                  | #1492 closed as shipped; mechanical splits remain in `weekly_plan.md`                            |

**Sequence (executed):** foundation gates → **Workstream A (Presence)** → **Workstream B (Sugar Caves)** → Part II unlock.

## Workstreams

### A. Presence productization (code — medium)

| Step | Deliverable              | Notes                                                                                                                                |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A1   | Lazy net stack           | Runtime: `import()` from `net/lazy.ts` when `FEATURE_FLAGS.presence`. Rollup: `presence` chunk.                                      |
| A2   | Candy remote avatar mesh | **Landed** — instanced `CapsuleGeometry` + `SphereGeometry` explorer, `MeshPhysicalNodeMaterial` clearcoat, per-peer `instanceColor` |
| A3   | Rate limits / privacy    | Mute remote, hide self, `CONFIG.presence.maxPeers` (16), `tickHz` 10, stale GC 15s                                                   |
| A4   | Biome ambient cue        | Peer enters region → announcer + `spawnImpact` spore (`getBiomeAtPosition`)                                                          |
| A5   | CI mock test             | `tests/presence-protocol.test.mjs`; `pnpm test:presence` in `test:integration` + `.github/workflows/node-protocol-tests.yml`         |

### B. Living-world content layer (large — pick **one**)

Shipped **Option 1 — Subterranean Sugar Caves**. Festival Night Market and Weather Ecosystem v2 stay **Near/Far** (not this epic).

| Option                                      | Pitch                                                                                                                     | Status                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **1 — Subterranean Sugar Caves** _(chosen)_ | Descent under lake; crystal ribs; muffled tracker / generative reverb; new `music-bindings` biome; god-rays from fissures | **Landed** — see `docs/SUGAR_CAVES_SHIP.md` |
| **2 — Festival Night Market**               | Night-only stalls, lantern batcher, chord-strike hooks, discovery stamps → awakened                                       | Deferred                                    |
| **3 — Weather Ecosystem v2**                | Seasonal cycle → foliage palette + fauna + generative profiles                                                            | Deferred                                    |

### C. Libraries (only if justified)

- **Keep Supabase** — do not add a second realtime stack
- **bitecs** — only if AS ECS insufficient for fauna + peers; prefer extend `assembly/ecs.ts`
- **Map authoring** — expand `?debugPlace` + `tools/map-generator/` rather than external editor deps

## Part II door (explicit sequence)

1. **Part I foundation** — ratchet, chunks, WebGPU device, GPU foliage default
2. **Presence feels human** — A2–A4 (avatars, privacy, biome cues)
3. **One new major layer** — Sugar Caves
4. **Unlock narrative** — `part-ii-unlock.ts` (awakened threshold / discovery)
5. **Part II teaser** — README + in-world stamp; `weekly_plan.md` sequences the door

Ship note: `docs/SUGAR_CAVES_SHIP.md` (same pattern as `GEM_CANOPY_SHIP.md`).

## Epic acceptance

- [x] Presence: opt-in join with env keys; graceful “backend not configured” (no console errors)
- [x] ≥1 polished remote avatar + peer list a11y
- [x] CI mock test for presence protocol (`tests/presence-protocol.test.mjs` + GitHub Actions)
- [x] One new content layer: music-bindings + VR viewpoint + traversal/smoke coverage (Sugar Caves; `test:sugar-caves` in CI)
- [x] `docs/` narrative updated (README + `docs/SUGAR_CAVES_SHIP.md`)
- [x] `weekly_plan.md` sequences Part II door explicitly

**Close #1492:** epic complete. Next product work is not another Part II biome.

## Refs

- `src/systems/net/*`, `src/ui/presence-panel.ts`, `CONFIG.presence`
- `src/systems/fauna/*`, `docs/SKY_ISLANDS.md`, `docs/GEM_CANOPY_SHIP.md`
- `docs/APP_CHUNK_SPLIT.md`, `docs/SUGAR_CAVES_SHIP.md`
- GitHub: #1353 co-presence, #1352 fauna, #1363 sky islands, #1492 capstone, #1495 app-chunk, #1496 GPU foliage

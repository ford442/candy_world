# Capstone roadmap — Presence + Part II door (#1492)

**Epic tracker** for Siphon Part I → Part II. This is **not one PR** — it sequences
multiplayer polish with the next signature content layer so foundation work is not skipped.

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

| Area                  | Location / notes                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Supabase client       | `@supabase/supabase-js`; `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`                        |
| Presence core         | `PresenceSystem` — ~10 Hz pose, ephemeral session ids, no accounts, room = world seed          |
| Avatars + UI          | `remote-avatars.ts`, `src/ui/presence-panel.ts`, start-screen opt-in, recent ARIA              |
| Fauna                 | C++ boids (#1478), `src/systems/fauna/*`, sky-island roosts                                    |
| Awakened flora        | `awakened-persistence` (flagged `?awakened`)                                                   |
| Vertical exploration  | Sky Islands — `docs/SKY_ISLANDS.md`, `sky-island-graph.ts`                                     |
| Lazy net (foundation) | `src/systems/net/lazy.ts`, `presence` chunk when `?presence=1` — see `docs/APP_CHUNK_SPLIT.md` |

## Prerequisites (do not skip)

| #   | Gate                                                            | Status (2026-08-05)                                                     |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | TS / ESLint ratchets green + CI blocks regressions (#1493)      | In progress — baseline 206 tsc; `lint.yml` wired                        |
| 2   | App-chunk + flag lazy net / photo / generative (#1495)          | **Landed** — `app` ~599 KB raw, `budget:check` 600 KB ceiling; PR #1522 |
| 3   | Shared WebGPU device stable (#1448) + GPU foliage pilot (#1496) | Device unified ✅; foliage pilot open                                   |
| 4   | Issue hygiene — close/narrow stale split tickets                | Open sweep in `weekly_plan.md` backlog                                  |

**Sequence:** finish foundation gates → **Workstream A (Presence)** → **Workstream B (content)**.

## Workstreams

### A. Presence productization (code — medium)

| Step | Deliverable | Notes |
|------|-------------|-------|
| A1 | Lazy net stack | Done when flags off — `presence` chunk + `net/lazy.ts` |
| A2 | Candy remote avatar mesh | **Status: Implemented ✅** Instanced low-poly clearcoat pastel; replace placeholders in `remote-avatars.ts` <br/> * Implementation Details: Replaced `THREE.SphereGeometry` with a merged `CapsuleGeometry` + `SphereGeometry` low-poly explorer shape and added per-peer `instanceColor` tinting. |
| A3 | Rate limits / privacy | Mute remote, hide self, `CONFIG.presence.maxPeers`, stale GC (partial) |
| A4 | Biome ambient cue | Peer enters region → announcer + soft particle (`getBiomeAtPosition`) |
| A5 | CI mock test | Mock Realtime channel; no live Supabase in CI |

**Proposed sub-issues (file when starting A):** `presence-candy-avatars`, `presence-biome-cue`, `presence-ci-mock`.

### B. Living-world content layer (large — pick **one**)

After foundation GPU/chunk work, ship **one** signature biome:

| Option                                           | Pitch                                                                                                                     | Fit                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **1 — Subterranean Sugar Caves** _(recommended)_ | Descent under lake; crystal ribs; muffled tracker / generative reverb; new `music-bindings` biome; god-rays from fissures | Vertical continuity after Sky Islands (up → down) |
| **2 — Festival Night Market**                    | Night-only stalls, lantern batcher, chord-strike hooks, discovery stamps → awakened                                       | Social / night-energy; more instanced UI mesh     |
| **3 — Weather Ecosystem v2**                     | Seasonal cycle → foliage palette + fauna + generative profiles                                                            | Systems depth over new scenery                    |

**Recommendation:** Option 1 for vertical narrative; Option 3 if prioritizing systems over meshes.

**Proposed sub-issues (file when starting B):** `biome-sugar-caves` (or chosen option), `music-bindings-sugar-caves`, `vr-viewpoint-sugar-caves`, traversal/smoke tests.

### C. Libraries (only if justified)

- **Keep Supabase** — do not add a second realtime stack
- **bitecs** — only if AS ECS insufficient for fauna + peers; prefer extend `assembly/ecs.ts`
- **Map authoring** — expand `?debugPlace` + `tools/map-generator/` rather than external editor deps

## Part II door (explicit sequence)

1. **Part I foundation** — ratchet, chunks, WebGPU device, GPU foliage default
2. **Presence feels human** — A2–A4 (avatars, privacy, biome cues)
3. **One new major layer** — Workstream B (recommended: Sugar Caves)
4. **Unlock narrative** — discovery / awakened progress gates the descent or market opening
5. **Part II teaser** — README + in-world stamp / loading-screen line; `weekly_plan` tracks Part II biome name

Document the chosen Part II hook in `docs/BIOME_SHIP.md` (new file per biome, same pattern as `GEM_CANOPY_SHIP.md`).

## Epic acceptance (close #1492 later)

- [x] Presence: opt-in join with env keys; graceful “backend not configured” (no console errors)
- [x] ≥1 polished remote avatar + peer list a11y
- [x] CI mock test for presence protocol (`tests/presence-protocol.test.mjs`)
- [x] One new content layer: music-bindings + VR viewpoint + traversal/smoke coverage (Sugar Caves)
- [x] `docs/` narrative updated (README + `docs/SUGAR_CAVES_SHIP.md`)
- [x] `weekly_plan.md` sequences Part II door explicitly

## Refs

- `src/systems/net/*`, `src/ui/presence-panel.ts`, `CONFIG.presence`
- `src/systems/fauna/*`, `docs/SKY_ISLANDS.md`, `docs/GEM_CANOPY_SHIP.md`
- `docs/APP_CHUNK_SPLIT.md`
- GitHub: #1353 co-presence, #1352 fauna, #1363 sky islands, #1492 capstone, #1495 app-chunk, #1496 GPU foliage

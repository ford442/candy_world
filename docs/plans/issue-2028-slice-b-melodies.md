# Objectives layer, first cut: "Melodies" quest chains, a journal, and quest announcements (#2028 slice B)

Expanded 2026-11-10 from three model reviews (Gemini, gpt-oss-120b, Grok). Every code claim below was re-checked against `main` @ `d70caf5`. The reviews disagreed on three design points; the calls are in "Decisions". Grok's ecosystem notes were not checked here and none of them changes the plan.

## Context / motivation

The progression loop is: harvest from musical flora → item counts unlock abilities (`src/systems/unlocks.ts`) → awakened flora open the Sugar Caves. Slice A of #2028 made every unlock reachable and effective. There are still no objectives: `src/gameplay/objectives/` and `assets/melodies/` do not exist, and `docs/PROGRESSION.md` says the layer is not built. Slice B was sequenced after #1973 slice 3 (landed 11-04/07) and the `WorldDocument` (#1974, landed), so nothing blocks it.

This cut ships the data format, a state machine, persistence, announcements and a journal, with three starter Melodies. Fauna guides, seasonal Melodies, rewards and the `visit` / `play-on-beat` / `build` triggers are later cuts.

## Findings that shape the design (verified on `main`)

1. **`announceQuest` has two callers, not one:** `src/systems/unlocks.ts:203` (`'unlocked'`) and `src/world/sugar-caves-traversal.ts:100` (`'locked'`). The output is `"Quest ${action}: ${quest}"`.
2. **There is no harvest event.** `UnlockSystem.harvest(itemId, amount = 1, displayName)` (`unlocks.ts:143`) is the one entry point. `save-integration.ts:201-205` replaces the method with a wrapper that calls the bound original, so a listener called from inside the original still runs. `chime_shard` is harvested 3 per call, so anything that counts must use `amount`.
3. **The progress bus only reports first-time gains made live.** `emitProgress` fires from `discoverySystem.discover` (`discovery-optimized.ts:134`) and `AwakenedStore.set` (`awakened-persistence.ts:199`). Loading a save, `restore`, `deserialize`, `merge` and anything inside `applyRemoteProgress` do not emit. Events alone therefore miss everything the player already had, and everything that happens before a lazy chunk has loaded.
4. **Every save and every shared-world merge passes through `unionProgress`** (`src/world/document/progress-union.ts`; called from `session.ts:149`, `shared-sync.ts:186` and `:335`). It rebuilds the progress object field by field. A field it does not copy is dropped on the next autosave.
5. **`ProgressKind` is mirrored in the network protocol** (`world-sync-protocol.ts:177`, `v.picklist(['awakened', 'stamp', 'discovery'])`). A peer only accepts discovery ids that are keys of `DISCOVERY_MAP` and stamp ids matching `^night_market_stamp:[A-Za-z0-9_.:-]{1,96}$` (`:311`).
6. **Chunking.** `vite.config.js:79-83` sends every `/src/gameplay/` module except `gameplay/lazy.ts` to `gameplay`, and `:51-53` sends valibot to `save-ui`. `src/core/main.ts:18` is `void runBootstrap()` on purpose: awaiting a lazy chunk that imports `app` during bootstrap deadlocks the `weather ↔ app` cycle. `preloadGameplay()` runs at `shader-warmup.ts:69`, after `__sceneReady` is set at `:52`.
7. **UI.** `Panel.trapFocus` (`src/ui/kit/panel.ts:51`, `:130-134`) is typed to accept only `skipAutoFocus`. Closing on Escape is the `onEscape` option of `trapFocusInside` (`src/utils/focus-trap.ts:15`, `:32-35`), so the journal calls `trapFocusInside` itself, as `presence-panel.ts` does. `isInteractiveTarget` (`menu-helpers.ts:44-46`) already treats `[role="dialog"]` and `#ability-hud` as UI. The discovery log opens with `input.pushContext('menu')` (`discovery-log.ts:43`). Photo mode hides the ids in `HUD_SELECTORS` (`photo-mode.ts:63-70`).
8. **`src/core/hud.ts` does not build buttons**; the ability HUD is built in `src/ui/ability-hud.ts` (`id: 'ability-hud'`, `:199`).
9. **Scheduler:** phases are `input, fixed, simulate, animate, audio, render-prep, postfx, ui`. There is no `GAMEPLAY` phase. Adding a frame system changes the order snapshot in `tests/scheduler-order.test.ts`.
10. **Budget:** `tools/build-optimizer/budgets.json` enforces `app` ≤ 850 KB. The 817.88 KB figure is a measurement from 11-04, not a constant; measure before and after on this branch.

## Decisions

| Question | Call | Why |
| --- | --- | --- |
| Harvest signal | `onHarvest(listener)` on `UnlockSystem`, called at the end of `harvest`. Do **not** add `'harvest'` to `ProgressKind`. | Widening `ProgressKind` also means the protocol picklist and broadcasts every harvest to editors. Harvest counts already reach other players through `inventory` in the document. (gpt-oss-120b recommended the opposite without seeing the protocol.) |
| How steps complete | **Derived from persisted progress, not counted from events.** A step is satisfied when the current state says so: inventory count ≥ `count`, id discovered, stamp held, awakened records ≥ `count`. Events are only the cue to re-evaluate. | Removes the reload, catch-up, lazy-load-gap and double-count problems in one move (finding 3). This is gpt-oss-120b's "derived objectives" idea without its expression language. Consequence: `harvest … count: 3` means "have 3", so a player who already has them passes the step at once. |
| Stored state | `progress.melodies = { completed: string[], step: Record<melodyId, number> }`. No per-step counter. | With derived steps the only things worth saving are which Melodies are done and how far each has been announced. |
| Per world or per player | Per world, in `WorldDocument.progress`, merged by union. | Matches how inventory, stamps and awakened flora already behave. A visitor who is not an editor sees the owner's chains; an editor's completion merges into the world. Per-player would be a different slice (local storage, no schema field). **Noah to confirm before implementation.** |
| Rewards | None in this cut; no `reward` field in the schema. | A reward that calls `harvest` re-enters `onHarvest`. Slice C defines rewards (instrument voices). |
| Journal placement | Its own dialog panel inside the lazy `objectives` chunk. Not a tab in the discovery log. | `discovery-log.ts` is in `app`; a tab would put the journal there too. |
| Frame system | None. | Event-driven; keeps `scheduler-order` untouched. |

## Files

**New**

- `src/gameplay/objectives/schema.ts` — `MelodySchema`, `parseMelodyFile(name, json)`.
- `src/gameplay/objectives/objective-system.ts` — `createObjectiveSystem(deps)`.
- `src/gameplay/objectives/journal.ts` — `mountJournal(system)`.
- `src/gameplay/objectives/index.ts` — loads the JSON, builds the system, mounts the journal.
- `src/gameplay/objectives-lazy.ts` — `preloadObjectives()`; the only part that stays in `app`.
- `src/systems/melody-progress.ts` — import-free leaf in `app`: `registerMelodyStore({ read, apply })`, `readMelodyProgress()`, `applyMelodyProgress(p)`. Same role as `progress-events.ts`.
- `assets/melodies/meadow.json`, `sugar-caves.json`, `night-market.json`.
- `tests/objectives.test.ts`, `tests/fixtures/melodies/bad.json`.

**Edited**

- `src/systems/unlocks.ts` — `onHarvest`.
- `src/world/document/schema.ts` — optional `melodies` on `ProgressSchema`, and in `emptyProgress()`.
- `src/world/document/progress-union.ts` — union rule for `melodies`.
- `src/world/document/progress-bridge.ts` — `readLiveProgress` / `mergeLiveProgress` go through `melody-progress.ts`. Must not import `src/gameplay/objectives/**`.
- `src/world/document/migrations.ts` — only if `migrateLegacySave` (`:164-171`) no longer typechecks.
- `src/core/main/shader-warmup.ts` — `void preloadObjectives()` next to `preloadGameplay()`.
- `src/systems/photo-mode/photo-mode.ts` — journal root id in `HUD_SELECTORS`.
- `vite.config.js` — `objectives` rule ahead of the `gameplay` rule; exclude `objectives-lazy.ts` from the `gameplay` rule.
- `package.json` — `test:objectives`, appended to the END of `test:fast`.
- `docs/PROGRESSION.md`.

**Do not edit:** `src/core/hud.ts`, `src/core/game-loop-systems.ts`, `src/systems/discovery-log.ts`, `src/systems/progress-events.ts`, `src/systems/net/**`, `src/core/input/actions/**`, `emscripten/**`, `src/rendering/**`, `src/systems/batcher-lod.ts`, `tests/smoke-runner.mjs`, `tests/webgpu-probe.test.mjs`.

## Design

### Data

```ts
type Trigger =
    | { kind: 'harvest'; item: string; count: number }
    | { kind: 'awaken'; count: number; type?: 'luminous_plant' | 'gem_canopy_tree' }
    | { kind: 'stamp'; id: string }
    | { kind: 'discover'; id: string };

interface Melody {
    id: string;
    title: string;
    season?: 'spring' | 'summer' | 'autumn' | 'winter';
    prereq?: string[];
    steps: { id: string; text: string; trigger: Trigger }[];
}
```

Use `v.variant('kind', [...])` for `Trigger`. On failure throw an `Error` whose message contains the file name and `v.getDotPath(issue)`, the same shape `validateWorldDocument` produces.

### State machine

`createObjectiveSystem({ melodies, snapshot, announce, initial })` where `snapshot` is `{ itemCount(id), isDiscovered(id), awakenedCount(type?) }`.

- A Melody is active when every `prereq` is completed. Steps are sequential.
- `evaluate()` advances each active Melody while its current step is satisfied by `snapshot`, then marks it completed. It is idempotent.
- The stored step index only moves forward. `UnlockSystem.consume` (`unlocks.ts:164`) can lower an item count; a step already passed stays passed.
- `evaluate()` runs once on load, on every `onHarvest`, on every `onProgress`, and after `applyMelodyProgress` (a loaded or merged document).
- `announce('started' | 'step' | 'completed', title)` fires only for transitions made by the local `evaluate()`, never for state arriving through `applyMelodyProgress`. On first load, a Melody that fast-forwards several steps announces once, not once per step.
- `awakenedCount` reads the awakened store's records. That store reports 0 until its own chunk has loaded, so the count can only rise; re-evaluation on the next awakened event or document apply covers it.

### Persistence

- `ProgressSchema.melodies`: `v.optional(v.object({ completed: IdList, step: v.record(Id, non-negative integer) }), { completed: [], step: {} })`. `WORLD_DOCUMENT_SCHEMA` stays 1.
- `unionProgress`: `completed` is a set union; `step` keeps the larger index per id; an id in `completed` is removed from `step`. The empty value is the identity, so an autosave taken before the objectives chunk loads cannot erase saved chains. Either side may lack the field.
- Known cost: a client built before this change strips the unknown key when it saves the document. Accepted for this cut; state it in the docs.

### Loading and chunks

- `vite.config.js`: before the `gameplay` rule, `id.includes('/src/gameplay/objectives/')` → `'objectives'`. Add `&& !id.endsWith('/gameplay/objectives-lazy.ts')` to the `gameplay` condition so the stub stays in `app`.
- `objectives-lazy.ts` contains only a dynamic `import('./objectives/index.ts')`. Call it with `void`, never `await`, from `shader-warmup.ts`.
- The objectives chunk may import `unlocks.ts`, `progress-events.ts`, `discovery-optimized.ts`, the awakened API, `announcer.ts`, `src/ui/kit`, `focus-trap.ts`, `melody-progress.ts` and valibot (which makes it depend on `save-ui`, one direction only). It must not import `world/document/**` or `systems/net/**`.

### Journal

- `createPanel` with `role: 'dialog'` and a close button. Call `trapFocusInside(root, { onEscape: close })` so Escape closes it.
- The open button is appended inside `#ability-hud`. While open, hold `input.pushContext('menu')`; release on close.
- Lists active Melodies with the current step text, then completed ones. Re-renders on system change.
- No new action binding in this cut.

## Starter content

Only ids that exist on `main` and that a shared-world peer will accept.

1. **Meadow** — three steps: harvest `fern_core` ×1, `vibrato_nectar` ×1, `tremolo_bulb` ×1.
2. **Sugar Caves** — one step: `{ kind: 'awaken', count: 3 }` (equals `AWAKENED_THRESHOLD` in `part-ii-unlock.ts:10`; nothing emits when the door itself opens).
3. **Night Market** — six steps, one per stall, `night_market_stamp:setpiece:night_market:stall:0` … `:5`.

No `season`, no `prereq`, so all three start active.

Reference lists for authors and for the test:

- **Harvest ids:** `fern_core`, `vibrato_nectar`, `tremolo_bulb`, `chime_shard` (3 per harvest), `snap_shard`, `shrine_token`, `harmony_orb`, `bounce_shroom`, `lake_core`, `heavy_stone`.
- **Discovery ids (keys of `DISCOVERY_MAP`):** `ability_sonic_clap`, `arpeggio_fern`, `portamento_pine`, `vibrato_violet`, `tremolo_tulip`, `cymbal_dandelion`, `kick_drum_geyser`, `snare_trap`, `retriggerMushroom`, `strobe_sickness`, `panning_pad`, `silence_spirit`, `subwoofer_lotus`, `harmony_orb`, `instrument_shrine`, `melody_mirror`, `lake_island`, `sky_island`, `cave`, `waterfall`, `wisteria_cluster`, `groove_boots`, `wind_anchor`.
- **Do not use** discovery ids outside that map (for example `night_market`, `glass_mushroom`, `vine_swing`): peers drop them.
- **Awaken types:** `luminous_plant`, `gem_canopy_tree`.

## Ordered plan

Each step leaves `npm run typecheck` and `npm run test:cycles` green. `test:objectives` is `tsx tests/objectives.test.ts`, node only.

1. **Schema, three JSON files, bad fixture.** Test: every `assets/melodies/*.json` parses; `bad.json` throws naming the file and the path; every trigger target resolves (harvest ids by scanning `src/` with the same regex as `progression-reachability.test.ts`, discovery ids from `DISCOVERY_MAP`, stamp ids from the `night_market` stall ids in `assets/map.json`, awaken types from the two-type set). Do not import `night-market-stamps.ts` or `progression-reachability.test.ts` from the test.
2. **`onHarvest` and the state machine**, not yet wired to boot. Test: a fake snapshot walks Meadow from start to completed with the expected `announce` calls; a snapshot that already satisfies everything completes with one announcement; calling `evaluate()` twice changes nothing; `chime_shard` at 3 per harvest satisfies `count: 3` after one call. Also run `test:progression`.
3. **Document field and union.** Test: a document without `melodies` validates and gets the default; union with the empty value is the identity in both argument orders; larger step wins; completed removes the step entry. Also run `test:world-document`, `test:world-sync`, `test:shared-worlds`.
4. **Lazy chunk and preload.** `melody-progress.ts` leaf, the stub, the vite rules, the `shader-warmup.ts` call. Proof: `test:cycles`, `build:ci`, and the built `app` chunk does not contain the objectives modules.
5. **Journal.** Test in the mock style of `tests/focus-trap.test.ts`: open, Escape, panel hidden, trap released, menu context popped.
6. **Docs and `test:fast`.** `docs/PROGRESSION.md`: Melodies, the derived-step rule, the union rule, authoring a Melody. Append `&& npm run test:objectives` to the end of `test:fast`.
7. **Size gates.** `npm run budget:check` before and after; `npm run check:net-chunk`; `npm run lint`.

## Acceptance criteria

- [ ] `assets/melodies/*.json` load through a valibot schema; a malformed file fails `npm run test:objectives` with the file name and the path of the bad field.
- [ ] Every trigger in the three starter files resolves to an id that exists on `main`; the test fails if one is renamed or removed.
- [ ] Steps complete from current progress, so a save that already satisfies a step passes it on load, and reloading never repeats or loses a step.
- [ ] `announceQuest` fires on start, step and complete for local transitions only, and not at all for state applied from a document or a peer.
- [ ] `progress.melodies` round-trips through `validateWorldDocument`; a document without the field loads; `unionProgress` with the empty value changes nothing.
- [ ] `test:world-document`, `test:world-sync` and `test:shared-worlds` pass unchanged.
- [ ] The journal opens from a button in the ability HUD, traps focus, closes on Escape and on its close button, and is hidden in photo mode.
- [ ] `objectives` is a lazy chunk loaded after `__sceneReady`; `app` grows by ≤ 10 KB (before and after from `budget:check` in the PR); `check:net-chunk` passes; `test:cycles` stays 0/0.
- [ ] `typecheck` 0, `lint` at or below baseline, `test:fast` green apart from suites already red on `main` when the branch was cut (name them).
- [ ] `docs/PROGRESSION.md` no longer says the layer is unbuilt and explains how to add a Melody.
- [ ] No edits to the "Do not edit" list.

## Not verified in a container

- The journal with a real screen reader, and that opening it does not cut off a quest announcement.
- Two browsers in one shared world: an editor completes a Melody, the owner sees it after the next sync.
- A fresh save played from spawn through all three Melodies.

## Open questions for Noah

1. Per world (as specified) or per player? This decides whether a visitor sees the owner's Melodies.
2. Is "have N" acceptable for harvest steps, or must a step mean "harvest N more from now"? The second needs a stored counter and brings back the catch-up problem.
3. Step text and titles for the three starters.

## Reviewer notes not acted on

- **gpt-oss-120b:** event-log rule engine (too large for this cut); harvest in `ProgressKind`; per-player state; rewards through `harvest`; journal as a discovery-log tab. Reasons are in "Decisions".
- **Grok (unchecked here):** valibot 1.5.0 is current and `v.variant` / `v.getDotPath` are the right tools; hand-written state machines are still normal at this size; Vite 5 is out of support; three r187 is out. Its note that the generic libomp microtask path is limited to 15 arguments on Emscripten 4.x is consistent with today's foliage-crash diagnosis.

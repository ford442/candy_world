# Player Authoring: Build Mode and the WorldDocument

Players can build in Candy World: place mushrooms, trees, flowers, lights and
music objects, move and recolour them, and keep the result. Everything they
make lives in one versioned **WorldDocument** (`src/world/document/`), saved
to IndexedDB and exportable as a `.candyworld` file. Issue #1974; Phase 0 was
#1761.

## Playing

Press **B** (or the 🏗️ HUD button) to toggle build mode. Pointer lock stays
on: the reticle is the cursor. WASD still walks.

| Input                               | Action                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `1` `2` `3` `4`                     | Place · Select & move · Paint · Remove tools                                  |
| Left click / `Enter`                | Use the tool at the cursor                                                    |
| Right click / `Del`                 | Remove the targeted piece (or the selection)                                  |
| `[` `]`                             | Previous / next piece in the category                                         |
| `Shift` + `[` `]`                   | Previous / next category                                                      |
| Wheel, `R` / `Shift+R`              | Rotate 15° / 45°                                                              |
| `Shift` + wheel, `+` `-`            | Scale (0.2–5)                                                                 |
| `G`                                 | Snap the cursor to a 0.5 m grid                                               |
| Arrow keys, `Home`                  | Nudge the cursor from the reticle (keyboard placement) / reset                |
| `Shift` + click (Select)            | Add to the selection (up to 32)                                               |
| `M`                                 | Pick up the target or selection; click / `Enter` drops it                     |
| `F`                                 | Transform gizmo for one piece (`T` move, `Y` rotate, `U` scale, `Enter` done) |
| `C` / `Shift+C`                     | Next / previous paint colour                                                  |
| `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` | Undo, redo                                                                    |
| `Esc`                               | Drop a pick-up (and pause, as always)                                         |

The ghost turns green (fine), yellow (on a platform or underwater) or red
(too steep, or the base would clip uneven ground: refused). The strip at the
bottom of the screen has the same tools, categories, pieces and colours as
buttons, so it also works with a free cursor, touch, or keyboard focus.

The gizmo needs a free cursor, so `F` releases pointer lock; the pause menu
stays closed while it is open (`isBuildGizmoOpen()` feeds the input layer's
`shouldPreventMenuOnUnlock`), and closing it re-locks. Each finished drag is
one `MoveCommand`, so it undoes like any other edit.

## How an edit flows

```
input (build-mode.ts) ─▶ WorldCommand ─▶ editHistory.execute()
                                              │
                         processMapEntity ◀───┤ apply / revert
                         despawnEntity    ◀───┘
                                              │ 'execute' / 'undo' / 'redo'
                                              ▼
                               WorldDocumentSession (command log)
                                              │ debounced, 30 s, pagehide
                                              ▼
                                 DocumentStore (IndexedDB)
```

- **Commands** (`src/systems/world-commands.ts`): `PlaceCommand`,
  `RemoveCommand`, `MoveCommand`, `PaintCommand` (a move whose `to` has a new
  `params.color`), and `BatchCommand` (several commands as one undo step, all
  or nothing). They target snapshot ids (`mapEntityId`), never array indices,
  and spawn and tear down through the same paths map loading and chunk
  streaming use. `deserializeWorldCommand` rebuilds any of them from its
  `serialize()` output.
- **Claimed ids** (`src/world/authored-entities.ts`): once a command has
  touched an entity id, `ChunkStreamer` no longer spawns the map's copy of it,
  so a removed or moved map entity stays removed or moved when its chunk
  streams back in. `despawnEntity` marks what it tore down, so a streamer
  eviction never tears the same object down twice.
- **History** (`src/systems/edit-history.ts`): 100 steps. `subscribe()`
  reports `execute` / `undo` / `redo`; the document session listens.
- **Session** (`src/world/document/session.ts`): the document's `commands`
  are a `base` run (replayed at load, pushed past the history cap, or folded)
  followed by the commands the history can still undo, matched by identity. A
  command whose revert throws stays in the log, because its effect is still in
  the world. Once 64 unreachable commands pile up they are compacted
  (`compaction.ts`): per entity id, the state before its first change and
  after its last becomes one `place`, `remove` or `move`.

## Placement pipeline (one implementation)

`src/systems/authoring/placement-core.ts` holds the raycast (march + bisect
against the unified ground), the ghost evaluation (the same `plantOnSurface`
that `processMapEntity` runs, plus slope and footprint checks), the snapshot
builder, and the ghost visuals. Build mode and the `?debugPlace=1` dev
overlay (`src/debug/debug-place.ts`) both use it; the dev overlay only adds
the dev sidecar and the map.json export on top.

## Palette

`src/systems/authoring/palette.ts` builds the palette from the foliage
registry's types, so a new species appears without code here. Categories:
mushrooms, trees, flowers, lights, music objects, props; an unlisted type goes
to music when its registry metadata says `supportsMusic`, else props. Clouds,
sky islands, caves and grass are not offered. Musical flora is hidden under
`?no_musical`. Defaults fix anything `processMapEntity` would roll at random
(a mushroom's face), so replaying a document rebuilds the same entity.

**Paint** is limited to `CANDY_PAINT_PALETTE`: eight saturated pastels that
pass the season-palette rules from `CANDY_AESTHETIC_GUARDRAILS.md` (HSL
saturation ≥ 0.25, lightness 0.4–0.95; `tests/build-mode.test.ts`). Only
types whose factory reads `params.color` can be painted today: mushrooms (cap
colour through the mushroom batcher), accordion palms and Night Market
stalls. Other batchers need a per-instance colour hook first.

**Music:** a placed piece goes through `processMapEntity` and
`registerWorldObject` exactly like a map entity, so it joins its species'
binding from `assets/music-bindings.json` and the map music context
(`docs/MUSIC_MAP_BINDING.md`): a player-built grove plays. Per-entity `music`
hints in a placed record are kept in the document, but are only folded into
the map music context at map load.

## Budgets

`SYSTEM_BUDGETS.authoring` (`docs/PERF_BUDGETS.md`): 1 ms per frame for the
ghost (it runs every other frame, as a `render-prep` scheduler system that is
gated off while build mode is closed), and caps of **48 authored entities per
32 m chunk** and **600 per world**. A placement past either is refused with a
"this grove is full" toast and recorded for the `?debug=1` overlay. Batched
species also stop at their batcher's fixed capacity (an `InstancedBatcher`
base that grows capacity is #1973 slice 4, not landed).

## Accessibility

Every tool works from the keyboard: arrows move the cursor away from the
reticle in camera-relative steps, `Enter` acts, `Del` removes, `[` `]` pick
pieces. Edits, refusals, tool and piece changes are announced through
`src/ui/announcer.ts`. The status line, which follows the cursor every other
frame, is deliberately not a live region. The palette strip uses real
buttons with `aria-pressed` / `aria-selected` / `aria-checked` state.

## Loading

Build mode is the lazy `authoring` chunk (with `TransformControls`); `app`
keeps only `build-mode-lazy.ts` and `build-mode-state.ts`. The document code
and `valibot` ride the lazy `save-ui` chunk, opened after world generation by
`src/world/document/lazy.ts`. Automated runs (`isAutomation()`) start from
the generated world unless they pass `?authoring=1`; build mode and the save
menu still open a document on demand.

## Not done yet

- Palette thumbnails rendered to a `RenderTarget` and cached: pieces show an
  emoji icon.
- Picking through the C++ `batchRaycast_c`: targeting is the nearest
  identified entity within 2.5 m of the ground hit.
- Paint for batchers without a colour hook; growable batcher capacity.
- Shared worlds and live co-editing (#1975) are in
  [`SHARED_WORLDS.md`](./SHARED_WORLDS.md): a remote `DocumentStore`, and the
  same commands broadcast between builders.

## Tests

- `npm run test:world-document`: schema, migrations, codec, compaction,
  session log, the legacy importer, and the replay round trip
  (`tests/world-document-replay.test.ts`).
- `npm run test:build-mode`: palette, paint rules, chunk caps, the shared
  snapshot builder, and the Sugar Caves door.
- `npm run test:world-commands`, `npm run test:edit-history`.

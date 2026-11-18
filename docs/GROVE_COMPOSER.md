# Grove Composer

Player-made music (#1976 slice C, from the #2028 progression plan): a **music stone** holds an
8-voice × 16-step pattern that the player writes in an in-world editor. Standing near the stone,
everyone hears it through the generative soundtrack, in the key of the grove around it.

The composer composes systems that already existed. It adds no audio engine and no persistence
path of its own:

| Need                   | Reused                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Sound, timing, visuals | `GenerativeEngine` / `GenerativeSequencer` (`src/audio/generative/`), the shared master bus   |
| Music reactivity       | The engine's note callbacks and visual state, exactly as for the generated score              |
| Cues                   | `fireScoreCue(id)` in `systems/living-score.ts`: the Living Score's own events and `unlock`s  |
| Saving, undo, replay   | A `compose` world command through the shared `editHistory` and the `WorldDocument` log        |
| Shared worlds          | The co-editing replica (last writer wins per entity) and `validateSharedWorld`                |
| Edit permission        | `getBuildModeLock()`: the lock that already keeps build mode shut in a view-only shared world |
| Voice unlocks          | `unlockSystem` and finished Melodies (`systems/melody-progress.ts`)                           |
| Input                  | The action layer's `menu` context (`docs/INPUT.md`)                                           |

No new library; no `.xm` export (a separate follow-up).

## Playing

1. Open build mode (**B**) and place a **Music stone** (🎼, _Music objects_).
2. Walk up to it and interact. The editor opens and pointer lock is released.
3. Light keys, change their pitch, bind a Living Score cue to a row, **Audition**, **Save**.
4. Walk within 14 m of the stone: its pattern replaces the generated soundtrack until you are 17 m
   away (the gap stops the edge flickering). The nearest stone in earshot wins.

A stone nobody has composed for plays a default pattern rolled from its id
(`defaultGrovePattern(grovePatternSeed(id))`), so every client hears the same thing.

## The pattern

`src/world/document/grove-pattern.ts`, renderer-free and imported by the document schema (so the
`validate-world` edge function loads it unchanged):

```ts
interface GrovePattern {
    v: 1;
    seed: number; // what Reset rolls the default from
    channels: Array<{
        notes: number[]; // 16 steps: a scale degree 0..13, or -1 for a rest
        cue?: string; // a Living Score cue id, fired on the steps this row plays
    }>; // 8, one per tracker channel (CHANNEL_VOICES)
}
```

Cells hold **scale degrees, not pitches**. `authoredNote(profile, channel, degree)`
(`sequencer.ts`) resolves a degree against the root and scale of the biome profile the engine is
playing, at the voice's octave. The same pattern is in G lydian in the Arpeggio Grove and in
C major in the meadow, so an authored pattern always fits the music around it.

The pattern lives on the stone's map record, in `entity.params.pattern`. Because it is entity
state, everything that already handles entities handles it: snapshots, compaction, the shared-world
entity merge, `.candyworld` export.

## The `compose` command

`{ type: 'compose', from: EntitySnapshot, to: EntitySnapshot }`: `to` is `from` with a new
`params.pattern`, nothing else. `ComposeCommand` (`systems/authoring/world-commands.ts`) re-places
the stone like a paint, so the live stone and its snapshot never disagree.

Checked at every boundary, by the same function (`composeIssue`):

- **The document schema** (`schema.ts`): a compose must keep its id, edit a `music_stone` on both
  sides, carry a valid pattern, and change only the pattern. Every snapshot of a music stone
  anywhere in the log (a place, a move, inside a batch) must carry a valid pattern or none.
- **`ComposeCommand`'s constructor**: a bad compose is never built, so it never becomes an undo
  step or reaches a peer.
- **Room messages** (`parseCmdMessage`) and **`validateSharedWorld`**, which both parse with the
  document schema.

Composes undo and redo like any edit, replay idempotently (re-placing a stone onto its own id), and
merge per entity in a shared world (last writer wins, as for a move or a paint).

`WORLD_DOCUMENT_SCHEMA` stays 1: a build without `compose` refuses a document that has one ("from an
unsupported build"), which is the honest answer. A deployed `validate-world` function has to be
redeployed before it accepts worlds with composes.

## Permissions

- **Own world, or a shared world you can edit:** edit, audition, save, undo.
- **A view-only shared world** (`getBuildModeLock()` set): the editor opens read-only. Keys are
  `aria-disabled`, Save refuses with the lock's message, Audition still works. Visitors hear the
  owner's pattern by walking up to the stone. Nothing a viewer does reaches the document or a peer.

## Voices

`src/systems/composer/composer-voices.ts`. Three voices are open from the start, which is all the
default pattern uses; the rest come from progress the player already earns:

| Channel | Voice         | Unlocked by                                          |
| ------- | ------------- | ---------------------------------------------------- |
| 0       | Kick          | open                                                 |
| 1       | Lead pad      | finishing the Meadow Melody (`meadow`)               |
| 2       | Melody        | open                                                 |
| 3       | Arpeggio      | open                                                 |
| 4       | High arpeggio | `arpeggio_shield`                                    |
| 5       | Hue pad       | finishing Garden Rhythm (`garden-rhythm`)            |
| 6       | Shimmer       | `resonance_tuner`                                    |
| 7       | Sparkle       | collecting every Night Market stamp (`night-market`) |

A lock only stops a player writing to a row. Playback plays every row, so a visitor hears the
whole pattern whatever they have unlocked. Nothing new is stored: availability is read from that
state each time the editor opens.

## Cues

A row can be bound to any cue in `assets/score-cues.json`. When the row plays, `fireScoreCue(id)`
runs that cue's event with the same day/night gates and the same `unlock` rule as a tracker row
(an `island.*` cue stays silent until Island Scholar). One step fires each cue at most once, however
many rows share it. A cue id this build does not know stays bound and is shown as unknown.

## The editor

`src/systems/composer/composer-ui.ts`: a Candy UI Kit dialog (`role="dialog"`, `aria-modal`,
described by its key help). Each row is a labelled group of 16 toggle buttons; each key is named
"Melody, step 3: E5, on", and every change is spoken through the announcer and shown in a
`role="status"` line. Locked rows say what unlocks them.

| Input         | How                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard      | Arrows move (roving tabindex; Home/End along a row), Enter/Space toggle, `+`/`-` or PageUp/PageDown pitch, Delete clears, Escape closes |
| Gamepad       | The `menu` context: d-pad walks the controls, A toggles, B backs out; LB/RB pitch, X audition, Y save (`composer.*` actions)            |
| Touch / mouse | Every key and tool is a button; ♭ Lower / ♯ Raise act on the selected key                                                               |

While open it holds the `menu` input context, traps Tab, consumes Escape (so the pause overlay
does not rise) and tells the input session not to raise the pause menu when it releases pointer
lock (`isComposerOpen()`). Closing stops any audition, pops the context and gives focus back. An
unsaved draft is kept per stone until the editor is opened on it again. If a co-editor composes the
same stone while the editor is open, a clean draft follows their pattern; a pending one is kept.

## Loading

The `composer` chunk (`systems/composer/`, about 14 KB) loads only in a world that has a music
stone: `foliage/music-stone.ts` calls `musicStoneSpawned()` in the import-free leaf
`systems/music-stone-hooks.ts`, which the `composer-lazy.ts` stub (in `app`) installs at boot.
The leaf exists to keep the stone from importing the stub: the stub's dynamic import would
otherwise close an import cycle through the foliage registry. The chunk registers the
`grove-composer` frame system (`audio` phase, scans for stones at 4 Hz).

## Tests

`npm run test:composer` (in `test:fast`):

- `tests/grove-composer.test.ts`: the model and seeded defaults; `compose` through the document
  schema, the shared-world validator, the room parser and three converging replicas; authored
  playback through the sequencer and the engine (deterministic, in the biome key, resuming the
  generated score); `ComposerPlayback` (audition over proximity, hysteresis, cues once per step);
  the voice table.
- `tests/grove-composer-ui.test.ts`: the editor against a mock DOM with the real focus trap and
  input layer: labels, keyboard, touch, gamepad, locked voices, cues, save/undo, read-only, focus
  and close.
- `tests/grove-composer-replay.test.ts`: the real spawn and despawn paths: place a stone, compose,
  undo, redo, save, export, revert, reload, replay; a forged compose is never built.

## Not done yet

- `.xm` / `.mid` export of a pattern.
- More than one bar, per-step velocity, swing.
- A stone in the base world; today stones are placed in build mode.

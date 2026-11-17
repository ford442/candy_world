# Progression

How the player earns abilities, and what each one does, and the objectives
("Melodies") layered on top: authored quest chains, a journal and quest
announcements (#2028 slice B), with `visit` / `play-on-beat` / `build`
triggers, seasonal Melodies and item rewards. The grove composer (#1976 slice
C) is built: finished Melodies and unlocks open its voices, see
[Grove composer voices](#grove-composer-voices) and
[`GROVE_COMPOSER.md`](./GROVE_COMPOSER.md). Fauna-guided Melodies are not built
yet; see [Melodies](#melodies).

## The loop

Harvest items from the world → item counts unlock abilities → abilities open
the world up.

- **Items** are counted in `UnlockSystem.inventory` (`src/systems/unlocks.ts`).
  A source calls `unlockSystem.harvest(itemId, amount, displayName)`.
- **Unlocks** are declared in `UNLOCK_DEFINITIONS` (same file). Each lists the
  item counts it needs; `checkUnlocks()` runs after every harvest.
- **Effects** are code that asks `unlockSystem.isUnlocked(id)`.

Both are stored in the `candy_world_unlocks` localStorage key and merged into
saved worlds by `restore()`. The same key holds `sites`: one-shot sources that
were already harvested (`unlockSystem.markSiteHarvested(id)`), so a lifted
stone or a picked mushroom stays spent across reloads. `reset()` clears them.

Every unlock is announced to screen readers (`announceQuest('unlocked', name)`)
as well as toasted.

## Unlocks, sources and effects

| Unlock            | Needs               | Where the items come from                                                                                         | What it does                                                                           |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `arpeggio_shield` | `fern_core` ×3      | Arpeggio Ferns, once unfurled (`foliage/musical-flora.ts`)                                                        | Shield ability (`core/game-loop-physics.ts`)                                           |
| `jitter_mines`    | `vibrato_nectar` ×5 | Vibrato Violets (`foliage/flowers.ts`)                                                                            | Places mines (`gameplay/jitter-mines.ts`)                                              |
| `shrine_master`   | `shrine_token` ×3   | Activating Instrument Shrines (`foliage/instrument.ts`)                                                           | An activated shrine carries you to the next activated one (`systems/shrine-travel.ts`) |
| `chord_strike`    | `harmony_orb` ×3    | Harmony Orbs (`systems/physics/physics-updates.ts`)                                                               | **V** fires Chord Strike, which spends 3 more orbs (`gameplay/chord-strike.ts`)        |
| `resonance_tuner` | `chime_shard` ×10   | Chime flora, Sonic Clap (`foliage/musical-flora.ts`, `physics-abilities.ts`)                                      | The Discovery Log shows hidden harmonics (`systems/discovery/discovery-log.ts`)        |
| `snap_core`       | `snap_shard` ×3     | Snare traps (`foliage/musical-flora.ts`)                                                                          | Reflects projectiles (`gameplay/rainbow-blaster.ts`)                                   |
| `island_scholar`  | `lake_core` ×1      | The Lake Island core (`world/generation-setpieces.ts`)                                                            | Unlocks the island Living Score cues (`assets/score-cues.json`)                        |
| `groove_boots`    | `bounce_shroom` ×5  | Trampoline mushrooms you have bounced on 3 times (`systems/bounce-shrooms.ts`)                                    | Faster when the groove gravity is strong (`physics-core.ts`)                           |
| `wind_anchor`     | `heavy_stone` ×3    | Heavy stones around the Sugar Caves door on the lake island, and one on the cave floor (`foliage/heavy-stone.ts`) | Immunity to the BPM wind (`physics-core.ts`)                                           |

### Bounce shrooms

Land on a trampoline mushroom (giant or `isBouncy`) three times (bounces less
than 400 ms apart count once). It ripens: its prompt becomes _Harvest Bounce
Shroom_, and interacting with it gives one `bounce_shroom`, once. Five ripe
mushrooms make Groove Boots. Bounce counts live on the mushroom's `userData` and
reset on reload; a harvested mushroom is remembered by its rounded position
(`bounce_shroom:<x>,<z>`, world generation is seeded) and does not ripen again.

### Heavy stones

Three stones ring the Sugar Caves door on the lake island, between the geyser
ring and the flower ring (`heavyStoneIslandSites()`), and a fourth rests on the
cave floor (`populateSugarCaves`). The island is reachable before the door
opens, so Wind Anchor does not wait on the Part II gate. Each stone has a site
id (`heavy_stone:island:<i>`, `heavy_stone:caves:0`); lifted stones are not
placed again.

### Shrine Master

Activating an Instrument Shrine records its position (`candy_world_visited_shrines`).
With Shrine Master, interacting with any recorded shrine moves you next to the
next one in the order you activated them, wrapping round.

### Resonance Tuner

`DISCOVERY_MAP` entries marked `hidden: true` are left out of the Discovery Log
until found. With the tuner they appear as dimmed _(hidden harmonic)_ rows with
their names.

### Island Scholar

Score cues in `assets/score-cues.json` may carry `"unlock": "<id>"`; they stay
silent until that unlock is earned. The `lake_island` cues use
`island_scholar`.

## Grove composer voices

A music stone's pattern editor (`docs/GROVE_COMPOSER.md`) has eight voices.
Kick, Melody and Arpeggio are open from the start; the others are earned with
progress the player already has, read fresh each time the editor opens
(`systems/composer/composer-voices.ts`), so nothing new is stored:

| Voice         | Unlocked by                                          |
| ------------- | ---------------------------------------------------- |
| Lead pad      | finishing the Meadow Melody (`meadow`)               |
| High arpeggio | `arpeggio_shield`                                    |
| Hue pad       | finishing Garden Rhythm (`garden-rhythm`)            |
| Shimmer       | `resonance_tuner`                                    |
| Sparkle       | collecting every Night Market stamp (`night-market`) |

A lock stops writing to a row, not hearing it: visitors hear every row of an
owner's pattern.

## Gates

- **Sugar Caves (Part II door).** Opens when `AWAKENED_THRESHOLD` flora are
  awake. Awakened persistence is on by default (`?no_awakened` opts out); only
  standing at the lake checks the gate. Below the threshold the door announces
  itself as locked (`announceQuest('locked', …)`) once per visit. See
  `world/sugar-caves-traversal.ts`.

## Melodies

A Melody is a short, ordered chain of steps that points the player at the
world: harvest three things, awaken three flora, collect six stamps. Each is a
JSON file in `assets/melodies/`; the layer that runs them is the lazy
`objectives` chunk (`src/gameplay/objectives/`), started by `preloadObjectives()`
after `__sceneReady`. Five ship: **Meadow Melody** (`fern_core`,
`vibrato_nectar`, `snap_shard`, one each), **Sugar Caves** (awaken 3 flora),
**Night Market Stamps** (one stamp per stall, six), **Garden Rhythm** (after
Meadow: reach the Sky Islands, clap on the beat 4 times, place a mushroom in
build mode; rewards a fern core) and **Winter Song** (winter only: visit the
Night Market, dance on the beat 3 times; rewards vibrato nectar).

### Steps are derived, not counted

A step is satisfied when the player's **current progress** says so, not when an
event is counted:

| Trigger                                   | Satisfied when                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `{ kind: 'harvest', item, count }`        | the inventory holds at least `count` of `item`                                          |
| `{ kind: 'awaken', count, type? }`        | at least `count` flora (of `type`, if given) are awakened                               |
| `{ kind: 'stamp', id }`                   | the Night Market stamp `night_market_stamp:<stall id>` is held                          |
| `{ kind: 'discover', id }`                | the discovery `id` (a key of `DISCOVERY_MAP`) has been found                            |
| `{ kind: 'build', count, type? }`         | at least `count` authored entities (of map entity `type`) placed in build mode are live |
| `{ kind: 'visit', biome }`                | the player is standing in `biome` right now (`getBiomeAtPosition`)                      |
| `{ kind: 'play-on-beat', action, count }` | the current run of on-beat presses of `action` is at least `count`                      |

Events (`UnlockSystem.onHarvest`, the progress bus, a document being applied)
are only the cue to look again; `evaluate()` is idempotent. So a save that
already satisfies a step passes it on load, a reload cannot lose or repeat a
step, a lazy chunk that loads late misses nothing, and nothing is counted
twice. The price is that **`harvest … count: 3` means "have 3"**, not "harvest 3
more from now". Steps run in order; the stored step index only ever moves
forward, so spending an item later (`UnlockSystem.consume`) never un-passes a
step.

`build` counts the ids `PlaceCommand` has placed and not undone
(`world/authored-entities.ts`). Replaying the command log (a load, a
shared-world catch-up) places the same ids again, so a replay cannot inflate
it; an undo lowers the count, but a step already passed stays passed.

`visit` and `play-on-beat` are **present-tense**: they read state that is only
true for a moment, the biome under the player (sampled every 10 frames in
`game-loop-audio.ts`, cued only on a change) and the live on-beat streak (a
press of `clap`, `strike`, `dance`, `jump` or `fire` within
`ON_BEAT_WINDOW` = 0.15 of a beat extends it, any other press of that action
resets it; the streak is never saved). They pass only when they are the current
step and true at an evaluate, and the step index is what remembers that they
happened. A save cannot satisfy them retroactively, and nothing replayed can.
The cues come from `systems/objective-signals.ts`, an import-free leaf in
`app` that the producers write to without importing the chunk.

Because of that, do not build a step on an item an ability spends
(`tremolo_bulb`, `harmony_orb`): "have 1" can stop being true before the player
reaches the step. `tests/objectives.test.ts` fails if a Melody does.

### Seasonal Melodies

A Melody with `"season": "winter"` (any of `spring`, `summer`, `autumn`,
`winter`, as `seasonController.getName()` reports it) is evaluated only in that
season. Out of season it is **dormant**: the journal lists it under _Waiting
for their season_, and it keeps its step index, so progress pauses rather than
resets. The season controller cues a re-evaluation when the season changes (or
is pinned with `?season=` / `setSeason`). A completed seasonal Melody stays
completed in every season and satisfies a `prereq` all year. A file written
before this cut that already carried a `season` now activates only in it.

### Rewards

`"reward": { "items": [{ "item": "fern_core", "count": 1 }] }` (1 to 8 items,
each a harvestable item id) is granted through `unlockSystem.harvest` when this
client's own evaluation completes the Melody, once: the completed set only
grows, and the grant happens after the Melody is marked completed, so a grant
that re-enters `evaluate` (harvest listeners) cannot repeat it. Completion that
arrives by merge (a document or a peer, `apply`) grants nothing; that state
carries its own inventory. Inventory unions by max, so two clients completing
the same Melody apart end up with the reward once, not twice. Unlocks are not a
reward type: they follow from items (`UNLOCK_DEFINITIONS`).

### Fauna-given Melodies

Not built. A Melody handed out and turned in by a fauna NPC needs its own
"offered" and "turned in" state; that would be a second objective store next to
`progress.melodies`, which this layer avoids. It waits for a slice that can
express both as steps (for example a `discover` of the NPC) in the one store.

### Stored state

`WorldDocument.progress.melodies = { completed: string[], step: Record<melodyId, number> }`,
per world, next to inventory, stamps and awakened flora. `step` is how many steps
of an open Melody are passed (and announced); there is no per-step counter.

- It merges as a **union** (`unionMelodyProgress`, `systems/melody-progress.ts`,
  used by `unionProgress` for saves and shared-world sync): `completed` is a set
  union, `step` keeps the larger index per id, and a completed id has no `step`
  entry. The empty state is the identity and either side may lack the field, so
  an autosave taken before the objectives chunk has loaded cannot erase saved
  chains.
- The document layer never imports the chunk. `systems/melody-progress.ts` (an
  import-free leaf in `app`, like `progress-events.ts`) holds state applied before
  the chunk registers its store and hands it over when it does.
- The chunk also keeps a `localStorage` mirror (`candy_world_melodies`), like
  the other live systems. A document opens only after the player enters the
  world, long after the chunk loads; without the mirror every reload would
  announce every Melody as started again.
- `WORLD_DOCUMENT_SCHEMA` stays 1: the field is optional and defaults to empty.
  **Known cost:** a client built before this change drops the unknown key the next
  time it saves a document, so Melody state is lost if an older build saves over
  it. Accepted for this cut.
- Per world, not per player: a visitor who is not an editor sees the owner's
  chains, and an editor's completion merges into the world.

### Announcements and the journal

`announceQuest` fires for transitions made by the player's own progress: _Quest
started_, _Quest updated_ (naming the next step) and _Quest completed_. At most
one per Melody per evaluation, so a save that jumps several steps announces
once, and in the order things happened (a completion before the Melody it
opens). State arriving from a document or a peer is applied silently
(`applyMelodyProgress`), never announced.

The **Melody journal** is a dialog (`gameplay/objectives/journal.ts`) opened from
the 📖 button in the ability HUD. It lists the Melodies in progress with the step
to do next, then the completed ones. While open it holds the `menu` input
context, traps focus, and closes on **Esc** or its close button. Photo mode
hides it. There is no key binding yet.

### Adding a Melody

1. Add `assets/melodies/<name>.json`; the chunk picks up every file in that
   directory, so no code changes:

    ```json
    {
        "id": "shrine-walk",
        "title": "Shrine Walk",
        "prereq": ["meadow"],
        "steps": [
            {
                "id": "first-shrine",
                "text": "Activate an Instrument Shrine.",
                "trigger": { "kind": "harvest", "item": "shrine_token", "count": 1 }
            }
        ]
    }
    ```

    `id` and step ids are lowercase slugs (`[a-z0-9_-]`, they are record keys in
    the document). `prereq` lists Melodies that must be completed first; a
    Melody with none starts active. `season` limits it to one season;
    `reward` grants items once on completion. Unknown keys are refused.

2. Use ids that exist, and that a shared-world peer will accept. Harvest ids:
   anything with a `.harvest('<id>'` call in `src/`. Discovery ids: keys of
   `DISCOVERY_MAP` only (a peer drops any other). Stamp ids:
   `night_market_stamp:` plus a stall's map entity id. Awaken types:
   `luminous_plant`, `gem_canopy_tree`. Visit biomes: a `regions[].biome` of
   `assets/map.json` or a procedural region in `world/generation-core.ts`
   (`sky_islands`, `sugar_caves`, `night_market`). Beat actions: `clap`,
   `strike`, `dance`, `jump`, `fire`. Build types: a map entity type
   (`mushroom`, …), or omit `type` for any. Reward items: harvestable ids.
3. Run `npm run test:objectives`. A malformed file fails with its file name and the
   dot path of the bad field (`Melody file "x.json" is invalid at
"steps.1.trigger.count": …`); a trigger naming an id that does not exist, a
   duplicate id, an unknown or looping `prereq` fail too.

## Defaults that used to be flags

| Feature              | Now                                                                                                        | Opt out / force                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Awakened persistence | on                                                                                                         | `?no_awakened`                                                                                                  |
| Generative music     | on until you load a tracker file; starts on the first click or key press (`audio/generative/autostart.ts`) | `?no_generative`, `?music=tracker`, or `localStorage['candy.musicMode'] = 'tracker'`. `?generative=1` forces it |
| Photo mode           | **Photo Mode** HUD button (and **P**); the button carries `aria-pressed` while active                      | `?photo` / `?mode=photo` preload it                                                                             |

Loading a tracker file always takes over from the generative engine
(`AudioSystem.loadModule`).

## Adding an unlock

1. Add it to `UNLOCK_DEFINITIONS`.
2. Add a source: call `unlockSystem.harvest('<item>', …)` from a spawner's
   interact hook, a harvest hook or a set-piece. Make sure the world spawns at
   least as many as the unlock needs.
3. Add an effect: check `unlockSystem.isUnlocked('<id>')` where the ability
   applies, or gate data on it with `"unlock": "<id>"` in `assets/`.
4. Run `npm run test:progression`.

`tests/progression-reachability.test.ts` scans `src/` and `assets/` and fails
for any unlock whose required item has no `harvest(...)` call, or that nothing
checks, and when `announceQuest` loses its last caller. It also runs the check
on a synthetic unlock and fails if that is not flagged. It runs in `test:fast`. `tests/progression-effects.test.ts` covers the
mechanics above.

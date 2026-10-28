# Progression

How the player earns abilities, and what each one does. Objectives ("Melodies"),
the journal and the grove composer (#1976 slices B and C) are not built yet;
this page covers the unlock loop that is in the game.

## The loop

Harvest items from the world → item counts unlock abilities → abilities open
the world up.

- **Items** are counted in `UnlockSystem.inventory` (`src/systems/unlocks.ts`).
  A source calls `unlockSystem.harvest(itemId, amount, displayName)`.
- **Unlocks** are declared in `UNLOCK_DEFINITIONS` (same file). Each lists the
  item counts it needs; `checkUnlocks()` runs after every harvest.
- **Effects** are code that asks `unlockSystem.isUnlocked(id)`.

Both are stored in the `candy_world_unlocks` localStorage key and merged into
saved worlds by `restore()`.

## Unlocks, sources and effects

| Unlock | Needs | Where the items come from | What it does |
| --- | --- | --- | --- |
| `arpeggio_shield` | `fern_core` ×3 | Arpeggio Ferns, once unfurled (`foliage/musical-flora.ts`) | Shield ability (`core/game-loop-physics.ts`) |
| `jitter_mines` | `vibrato_nectar` ×5 | Vibrato Violets (`foliage/flowers.ts`) | Places mines (`gameplay/jitter-mines.ts`) |
| `shrine_master` | `shrine_token` ×3 | Activating Instrument Shrines (`foliage/instrument.ts`) | An activated shrine carries you to the next activated one (`systems/shrine-travel.ts`) |
| `chord_strike` | `harmony_orb` ×3 | Harmony Orbs (`systems/physics/physics-updates.ts`) | **V** fires Chord Strike, which spends 3 more orbs (`gameplay/chord-strike.ts`) |
| `resonance_tuner` | `chime_shard` ×10 | Chime flora, Sonic Clap (`foliage/musical-flora.ts`, `physics-abilities.ts`) | The Discovery Log shows hidden harmonics (`systems/discovery-log.ts`) |
| `snap_core` | `snap_shard` ×3 | Snare traps (`foliage/musical-flora.ts`) | Reflects projectiles (`gameplay/rainbow-blaster.ts`) |
| `island_scholar` | `lake_core` ×1 | The Lake Island core (`world/generation-setpieces.ts`) | Unlocks the island Living Score cues (`assets/score-cues.json`) |
| `groove_boots` | `bounce_shroom` ×5 | Trampoline mushrooms you have bounced on 3 times (`systems/bounce-shrooms.ts`) | Faster when the groove gravity is strong (`physics-core.ts`) |
| `wind_anchor` | `heavy_stone` ×3 | Heavy stones on the Sugar Caves floor (`foliage/heavy-stone.ts`) | Immunity to the BPM wind (`physics-core.ts`) |

### Bounce shrooms

Land on a trampoline mushroom (giant or `isBouncy`) three times (bounces less
than 400 ms apart count once). It ripens: its prompt becomes _Harvest Bounce
Shroom_, and interacting with it gives one `bounce_shroom`, once. Five ripe
mushrooms make Groove Boots. Progress lives on the mushroom's `userData`, so it
resets on reload; the items you already harvested do not.

### Heavy stones

Four stones rest beside the path on the Sugar Caves floor
(`populateSugarCaves`). The floor is only walkable once the lake door has
opened (see below), so Wind Anchor sits behind the Part II gate.

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

## Gates

- **Sugar Caves (Part II door).** Opens when `AWAKENED_THRESHOLD` flora are
  awake. Awakened persistence is on by default (`?no_awakened` opts out); only
  standing at the lake checks the gate. See `world/sugar-caves-traversal.ts`.

## Defaults that used to be flags

| Feature | Now | Opt out / force |
| --- | --- | --- |
| Awakened persistence | on | `?no_awakened` |
| Generative music | on until you load a tracker file; starts on the first click or key press (`audio/generative/autostart.ts`) | `?no_generative`, `?music=tracker`, or `localStorage['candy.musicMode'] = 'tracker'`. `?generative=1` forces it |
| Photo mode | **Photo Mode** HUD button (and **P**) | — |

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
checks. It runs in `test:fast`. `tests/progression-effects.test.ts` covers the
mechanics above.

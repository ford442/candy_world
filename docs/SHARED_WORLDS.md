# Shared Worlds: publish, share, co-edit

A world a player builds (a `WorldDocument`, see [`SAVE_SYSTEM.md`](./SAVE_SYSTEM.md)
and [`AUTHORING.md`](./AUTHORING.md)) can be published to Supabase, opened by
anyone with its link, and edited live by several builders at once. Issue #1975;
it builds on #1974 (the document and build mode), #1973 (the scheduler and
fixed step) and the opt-in presence in `src/systems/net/presence.ts`.

## Playing

- **Worlds panel** (start screen, shown when a Supabase backend is configured):
  _My worlds_, _Shared with me_, _Public_ (a thumbnail grid, paged). Each card
  opens the world, copies its link, and for its owner invites builders, changes
  who can see it, or deletes it. Other people's worlds can be **remixed**: a
  copy you own, with `remix_of` pointing back.
- **Publish this world** publishes the world for the current seed (the open
  one, or the stored one on the start screen) as _unlisted_, _private_ or
  _public_, and copies its link.
- **Links.** `?world=<uuid>&seed=<seed>` opens a world. The seed is in the link
  so its terrain generates before the document is fetched; a link without it
  (or with the wrong one) reloads once on the document's seed. An editor invite
  adds `&invite=<token>` (valid 7 days); the invitee becomes an editor when the
  page opens and the token is removed from the address bar.
- **Accounts.** Players sign in anonymously the first time they use shared
  worlds. An anonymous player can publish private and unlisted worlds; the
  public gallery needs a permanent account: _Keep my worlds_ links an email
  (Supabase sends a confirmation), and the worlds stay with the account on any
  browser.
- **Viewers** (anyone who can read the world but is not an editor) see the
  world, every live edit and the builders' progress, but build mode is locked
  with a "remix it" hint, and their own progress stays theirs.
- **Photo mode** (`P`, or `?photo`) has _Set as world thumbnail_ while an
  editable shared world is open: the frame is uploaded as a 640 px JPEG and
  becomes the world's card image.

## Data model

`supabase/migrations/20261027000000_shared_worlds.sql`, with
`20261028000000_shared_worlds_write_path.sql` on top (one write path for the
document, the owner topic, deletable remix sources):

| Table             | Columns that matter                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds`          | `id` (= the document's id), `owner`, `title` (≤ 80), `seed`, `map_version`, `doc` (WorldDocumentV1), `visibility` (`private` / `unlisted` / `public`), `remix_of`, `rev` and `entity_clock` (co-editing, below), `command_count` (generated, for lists), `created_at`, `updated_at` (server time, the conflict check) |
| `world_editors`   | `(world_id, user_id)`, `role` (`editor` / `viewer`), `invite` (the token redeemed)                                                                                                                                                                                                                                    |
| `world_invites`   | `token`, `world_id`, `role`, `expires_at` (≤ 30 days)                                                                                                                                                                                                                                                                 |
| `world_snapshots` | `world_id`, `ts`, `image_path` (`<world id>/<file>` in the `world-thumbnails` bucket)                                                                                                                                                                                                                                 |

A trigger (`private.guard_world_write`) refuses, from any writer, a document
that is not a JSON object of schema 1, whose `id`, `seed` or `mapVersion`
disagree with the row, with more than 20 000 commands or larger than 8 MiB,
and a malformed or oversized `entity_clock`. It keeps `owner` and
`created_at` fixed, lets `remix_of` only clear (`on delete set null` when the
source world is deleted), lets only the owner change `title`, `visibility`,
`seed` or `map_version` (validate-world, as `service_role`, checks that
itself), and sets the timestamps.

## Access (RLS)

| Who                     | `worlds` (direct)                                                             | through `validate-world`                           | members / invites                     | thumbnails                        | Realtime                                                          |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| owner                   | reads; renames, changes visibility (not to `public` while anonymous); deletes | publishes, writes the document                     | manages members, creates invites      | uploads                           | sends on all three topics                                         |
| editor                  | reads                                                                         | writes the document                                | sees and drops own membership         | uploads                           | sends on `world:<id>` and `:edit`; listens on `:owner`            |
| viewer (private worlds) | reads                                                                         | —                                                  | sees and drops own membership         | reads                             | `world:<id>`; listens on `:edit` and `:owner`                     |
| anyone signed in        | reads `public`; reads `unlisted` **by id**                                    | publishes their own (not `public` while anonymous) | redeems a valid invite for themselves | reads where the world is readable | `world:<id>` of a readable world; listens on `:edit` and `:owner` |
| no session (`anon`)     | reads `public`                                                                | —                                                  | none                                  | reads public                      | none                                                              |

- **The document has one write path.** Clients have no insert grant on
  `worlds` and an update grant on `title` and `visibility` only (and the
  update policy is the owner's), so a document, its `rev` and its
  `entity_clock` reach the table only through validate-world, which checks
  them and writes as `service_role` (below).

- **Unlisted means "needs its id".** The select policy lets an unlisted row
  through only when the request names it in the `x-candy-world-id` header
  (`private.requested_world_id()`), so `select * from worlds` never lists one.
  The client sends the header on every read of a world it was linked to.
- Policy helpers that must read across tables (`private.world_role`,
  `can_read_world`, `can_edit_world`, `invite_is_valid`) are `SECURITY
DEFINER` with `search_path = ''` and live in the `private` schema, which the
  Data API does not expose, so none is callable over REST.
- **Storage**: the `world-thumbnails` bucket is public (objects are served by
  URL) and has no select, update or delete policy: it cannot be listed, and a
  thumbnail cannot be overwritten or removed by a client. Editors insert under
  their world's folder; `world_snapshots` points at the newest.
- **Realtime Authorization** (private channels): `world:<id>` (presence and
  poses) is joinable by anyone who can read the world; `world:<id>:edit`
  (edits, cursors, sync, shared progress) can be heard by readers and sent to
  only by editors; `world:<id>:owner` (kicks) can be heard by readers and sent
  to only by the owner. Policies cannot see a message's event, which is why
  each sender class has its own topic. Ambient presence (`candy:<seed>`) stays
  a public channel.

`npm run test:supabase-rls` applies the migration to a plain Postgres (with
`supabase/tests/platform-stubs.sql` standing in for the platform's `auth`,
`storage` and `realtime`), runs local versions of the database advisors'
lints (`supabase/tests/advisor_lints.sql`: RLS on, no mutable `search_path`,
no `SECURITY DEFINER` in an exposed schema, `auth.uid()` wrapped for initplan,
one permissive policy per action, covering indexes for every foreign key) and
then checks every policy above as each kind of user
(`supabase/tests/shared_worlds_rls.sql`). CI runs it against a `postgres:16`
service.

## Writing: the `validate-world` edge function

Every write to `worlds.doc` (a publish, an offline sync, the co-editing host's
write-back, a remix) is a POST to `supabase/functions/validate-world`, and
nothing else can write one:

```jsonc
{ "doc": WorldDocumentV1, "title"?: "…", "visibility"?: "unlisted",
  "remixOf"?: "<uuid>", "rev"?: 12, "entityClock"?: { "<entity id>": [12, "<peer>"] },
  "expectedUpdatedAt"?: "<updated_at last seen>", "dryRun"?: false }
```

It validates with `validateSharedWorld` (`src/world/document/shared-validation.ts`,
the same function the client runs before publishing and again on every
document it fetches): a current-schema document, a UUID id, at most
`SYSTEM_BUDGETS.authoring` pieces (600 per world, 48 per 32 m chunk; a piece
moved back to where the base world had it does not count), paint only from
`CANDY_PAINT_PALETTE` (a paint, a placement, or a move that changes the
colour), at most 8 MB. Then it checks the write itself, because it writes
**as `service_role`** (no RLS):

- the caller comes from the request's JWT (`auth.getUser`), and must own the
  world or edit it (`world_editors`); a new world is the caller's;
- only the owner renames the world or changes its visibility, and `public`
  needs a permanent account;
- an existing world is never written without `expectedUpdatedAt` (a blind
  first publish over it is `409 exists`);
- `rev` moves at most 100 000 per write and never back, and no
  `entity_clock` stamp is past the rev it is written with (a forged stamp would
  pin an entity forever);
- `remix_of` is kept only when the source is public: readers of the remix see
  it, and an unlisted world's id is its access key.

Answers: `201` created, `200` updated, `401` no caller, `403 forbidden` /
`account_needed`, `404` (deleted meanwhile), `409 conflict` (the row moved
past `expectedUpdatedAt`; the body has the current row), `409 exists`, `409
terrain`, `422` (with the validator's `code`: `schema`, `identity`,
`over_cap`, `palette`, `too_large`, or `clock`). On the hosted platform the
function gets `SUPABASE_SERVICE_ROLE_KEY` from its environment; served by hand
(`deno run`), pass it.

The function imports the validator from `src/` (the same module, not a copy).
`src/systems/entity-snapshot-types.ts` keeps its type graph free of three.js,
so `npm run check:validate-world` (`deno check`) passes; the handler itself is
web-standard Request/Response and `tests/shared-worlds.test.ts` drives it from
Node.

## The client

- **`RemoteDocumentStore`** (`src/world/document/remote-store.ts`) implements
  the `DocumentStore` interface from #1974 (`load` / `save` / `list` /
  `delete`) and adds `publish`, `fetch(id)` (document, `entity_clock`, the
  caller's role), `listMine`, `listShared`, `listPublic(cursor)` (keyset paged
  on `updated_at, id`) and `remix`. Its transport is a `SharedWorldsBackend`:
  `SupabaseWorldsBackend` (`src/systems/net/supabase-worlds-backend.ts`) in the
  app, an in-memory one (through the real edge handler) in tests.
- **Offline first** (`src/world/document/shared-sync.ts`). The local IndexedDB
  copy is the source of truth while editing. `SharedWorldSync.push` sends it on
  save (a published world's autosave pushes too, at most every 20 s) with the
  `updated_at` last seen; on a conflict it fetches the row, **merges per entity**
  against what was last synced and tries once more. The merge is three-way:
  `SyncMeta` keeps the entity hashes and the `entity_clock` of the last synced
  row; an entity this copy changed since keeps its version **unless the row's
  stamp for it changed too**, in which case the row wins (that change is one
  other people already have; a copy that never synced counts every stamp as
  news). Every other entity takes the row's version; progress is a union.
  `open` does the same when a link boots: remote only, local only (nothing new
  on the server, or offline), or merged; a viewer's copy always takes the row.
  Entities changed outside a live room get fresh co-editing stamps
  (`sync-<user>` as the author), so a live room orders them against its own
  writes. When the host's `sync` hash matches this copy's, the room's state
  becomes the new base, so a builder who leaves the room doesn't carry the
  room's edits into the next merge as their own.
- **Boot.** `src/world/document/lazy.ts` sees `?world=` and hands off to the
  `net` chunk (`openSharedWorldFromLink`): sign in, redeem the invite, open the
  world (validated), push a builder's unsynced edits, replay its commands on the
  generated base world, join the room. Anything that fails falls back to the
  player's own world for the seed. If the push fails (offline, or refused), the
  world opens without a room: this copy is not the stored world, and the next
  save tries again. A shared world is not remembered as the seed's active world.

## Live co-editing protocol

`src/systems/net/world-sync-protocol.ts` is the protocol, pure and
unit-tested; `src/systems/net/shared-world-session.ts` binds it to Realtime,
the `EditHistory` and the live world.

| Event      | Topic              | Payload                                                                             | Rate (per sender)                      |
| ---------- | ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `pose`     | `world:<id>`       | `{ id, pos, quat, biome, ts }` (unchanged)                                          | `CONFIG.presence.tickHz`               |
| `cmd`      | `world:<id>:edit`  | `{ author, seq, rev, baseRev, command: SerializedWorldCommand, origins?, resend? }` | 12/s, burst 40                         |
| `cursor`   | `world:<id>:edit`  | `{ author, pos \| null, selection: id[] (≤ 32), tool }`                             | 4/s sent, 8/s accepted                 |
| `progress` | `world:<id>:edit`  | `{ author, kind: 'awakened' \| 'stamp' \| 'discovery', id, type? }`                 | 10/s, burst 30; the room 4/s, burst 40 |
| `sync`     | `world:<id>:edit`  | `{ author, rev, hash, updatedAt }` (host only)                                      | after each write-back                  |
| `kick`     | `world:<id>:owner` | `{ author, target }` (owner only, enforced)                                         | —                                      |

**Conflict model: last writer wins per entity.** Every authored entity is a
register keyed by its `EntityId` (the snapshot id). A write carries the
Lamport stamp `(rev, author)`: `rev` is one more than the highest rev the
author has seen, ties go to the larger author id, and the register keeps the
write with the larger stamp. Commands are idempotent by `(author, seq)`, so
reordered or repeated delivery ends in the same state
(`SharedWorldReplica.hash()`, a hash of every authored entity's canonical
snapshot). A batch is one write: each entity it touches takes its final state
from the batch. An undo is a new write (the inverse command), not a retraction,
so "undo restores my version" holds even after someone else changed the piece.

**Base states.** To tell an authored change from the base world, each replica
remembers every entity's base state: the `before` of its earliest write. A
peer that missed that write learns it from `origins`, which every later write
carries for entities whose base its author already knew.

**Late joiners.** The issue sketched "apply buffered `cmd`s with `rev >
doc.rev`". A Lamport rev does not say whether the host had _received_ a write
when it saved, so that filter can drop a write the document lacks. Instead the
stored row keeps, per entity, the stamp of the write its state came from
(`entity_clock`): a joiner opens the document with those stamps, and every
buffered `cmd` goes through the same last-writer-wins rule, so the ones the
document already holds change nothing and the ones it lacks apply. The
document and the clock always come from the same write (what this copy opened
or pushed, `SharedWorldSync.syncedState`); a clock read later against an
older document would mark writes as held that the document lacks. Once
subscribed, the joiner reconciles with the row, which brings in anything
written in between.

**The host.** The editor who joined the edit topic first (ties: the smaller
peer id) is host. Every 15 s while the world changed, when the tab hides and
on leave, it writes the merged document back (`documentCommands()`: one
`place`, `move` or `remove` per authored entity, plus `rev` and
`entity_clock`) through `validate-world` with its last `updated_at`, then
announces `sync` with the hash it wrote. The document, clock, rev and hash
are taken in the same tick, and edits that arrive while the write is in
flight mark the world dirty for the next one. A conflict reconciles and
retries; any other refusal waits a minute. When the host leaves, the next
editor takes over. Viewers are never host. The write on `pagehide` is a
`fetch` the browser may cut off; the one on `visibilitychange` (hidden) comes
first and usually lands, and otherwise the next host writes the same state.

**Anti-entropy.** Broadcast is best-effort. A replica whose hash differs from
the host's `sync` fetches the row (at most every 10 s; a request inside that
window runs at its end) and `reconcile`s: it adopts every entity whose stored
stamp is newer than its own, and re-sends its own writes the row lacks,
marked `resend` so a peer whose dedupe window gave up on them still takes
them (applying one twice is a no-op). A join or reconnect reconciles too. The
protocol tests drop 15% of messages across three peers and converge after the
host's syncs.

**Inbound checks.** Every inbound message is dropped and logged (never
applied) when it is malformed (valibot, against the document schema), larger
than its limit (`cmd` 96 KB, others 2 KB), touches more than 64 entities,
moves one id onto another, comes from a kicked peer, exceeds its sender's
rate, claims a rev more than 100 000 ahead of the room, or would take the
world past the entity caps. A colour outside `CANDY_PAINT_PALETTE` (a paint,
a placement, a recolouring move) is clamped to the nearest candy colour
(deterministic, so every replica clamps alike). `progress` must also come
from an editor present on the edit topic, stay within the room-wide budget
(rotating author ids doesn't buy more), and name something real: a discovery
in `DISCOVERY_MAP`, a well-formed stamp id, or an awakenable flora (when the
flora is placed here, its own type is used). Counters are on
`window.__sharedWorld.stats.dropped`.

**Caps under concurrency.** Two builders can each place the 600th piece before
hearing of the other's. Each replica refuses the one that would go past the
cap; the host's refusal is final: it answers with a compensating write that
takes the piece back out for anyone who applied it, and its `sync` repairs the
rest. Build mode checks moves as well as placements (a piece moved into a full
grove, or a map piece nudged so it becomes authored), and a local edit the
replica would refuse anyway (a redo, an undo, a room fuller than this scene
shows) is stepped back out before it is broadcast.

**Mute and kick.** _Mute_ (the peer list) hides a peer's avatar and cursor and
ignores their progress, locally; their edits still apply, so the world stays
one world. _Remove_ (the world owner only) first deletes the peer's
`world_editors` row, so their next write, join or token refresh is refused,
then sends `kick` on the owner topic. Only the owner can send there, so every
peer ignores that peer from then on; the removed player's own client checks
its role with the database and leaves.

**Shared progress.** A builder's first-time discovery, Night Market stamp or
awakened flower is reported on `src/systems/progress-events.ts` and broadcast
on the edit topic; peers check it (above), apply it inside
`applyRemoteProgress` (so it is not echoed back) and it lands in the shared
document's progress at the next save. Visitors receive the builders' progress
but don't send theirs: anyone can read a public world, and progress persists
into each player's own journal.

## Loading

All of it is the lazy `net` chunk: supabase-js (moved out of `vendor` by the
`manualChunks` rule for `@supabase/`), presence, the protocol, the session, the
backend and both start-screen panels. `app` keeps only the stubs:
`src/systems/net/shared-worlds-lazy.ts`, `src/systems/net/supabase-config.ts`
(reads the env), `src/ui/worlds-panel-lazy.ts`, `progress-events.ts` and the
`?world=` reader in `world-seed.ts`. Single-player boot never loads supabase-js;
`npm run check:net-chunk` walks the built page's static imports and fails if
it reaches `net` or supabase code (CI runs it after the budget check).

## Setting up a backend

1. `.env.local`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the
   publishable key). If the Realtime server is older than supabase-js (its log
   shows `decode_binary` errors and channels drop on the first send, as with
   some local CLI stacks), add `VITE_SUPABASE_REALTIME_VSN=1.0.0` (JSON frames).
2. Local: `supabase start` (uses `supabase/config.toml`: anonymous sign-ins and
   manual linking on, the `world-thumbnails` bucket, `validate-world` with JWT
   verification), which applies the migration and serves the function.
3. Hosted: `supabase link`, `supabase db push`, `supabase functions deploy
validate-world`; in the dashboard enable **Anonymous sign-ins** and
   **Manual linking** (Auth → Providers), and add CAPTCHA for anonymous
   sign-ins against abuse. Then run the security and performance advisors.
   Run against a migrated local stack, Supabase's own advisor SQL
   ([splinter](https://github.com/supabase/splinter)) reports no security
   findings, only INFO "unused index" on the new, empty tables. On a hosted
   project, also expect the INFO-level "anonymous sign-ins enabled" notice (the
   public-gallery policy is the deliberate answer to it).

The second migration drops `pg_graphql`: the game never uses `/graphql/v1`, and
with the extension installed every table the app's roles can read shows up in
GraphQL introspection (advisor lints 0026/0027), whatever RLS says. Re-create
the extension if a later feature needs GraphQL.

## Not done yet

- A Yjs transport (`y-supabase` / `y-webrtc`) if broadcast latency or ordering
  falls short. `SerializedWorldCommand` stays the app contract, so it would be
  a transport swap.
- Authors are self-reported in broadcasts. Realtime Authorization keeps
  non-editors off the edit topic and non-owners off the owner topic, but one
  editor could still send under another editor's peer id; validate-world
  bounds what any write can store.
- Presence identities are self-reported too: _Remove_ deletes the membership
  of the account the peer's presence names. An editor posing as another
  account could get that account removed instead (the owner can re-invite it).
- A kicked editor's open connection keeps listening until its token refreshes.
- Progress made in a shared world also stays with the player (progress only
  grows; the live progress systems are per player, not per world).
- Thumbnails of deleted worlds stay in the bucket until a server-side sweep.

## Tests

- `npm run test:world-sync`: the protocol. Two replicas, 50 interleaved
  place/move/remove/paint/undo ops with reordered and duplicated delivery
  (40 seeds), reversed double delivery, late joiners, lost messages repaired by
  a sync, a re-send past the dedupe window, three peers with 15% loss (60
  seeds), caps at the limit with the host's compensation and for local edits,
  inbound validation, the palette clamp on paints, placements and moves, rate
  limits, host election.
- `npm run test:shared-worlds`: the validator (caps count no-op moves), the
  edge handler (who may write what, the clock bounds, `remix_of`), the
  `RemoteDocumentStore`, offline-first sync and the clock-aware merge (a
  co-editor's stale copy reopening, a push after a reload, the room's state as
  the next base), share links.
- `npm run test:supabase-rls`: the migration, advisor-style lints and RLS
  (needs Postgres; skipped without one unless `CANDY_RLS_REQUIRED=1`).
- `npm run check:net-chunk` (after `vite build`), `npm run check:validate-world`
  (needs Deno).
- `npm run e2e:shared-worlds`: three browsers against a running stack (see the
  script header): publish, open the link in a fresh context (equal snapshot
  hash, same season), an invited editor and the owner co-editing 50 interleaved
  ops to the same hash and the same live world, a discovery and an awakening
  crossing in well under a second, the host's write-back, the viewer lock, and
  malformed, over-cap and flooding commands dropped and logged.

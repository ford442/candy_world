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
  world and every live edit, and share progress, but build mode is locked with
  a "remix it" hint.
- **Photo mode** (`P`, or `?photo`) has _Set as world thumbnail_ while an
  editable shared world is open: the frame is uploaded as a 640 px JPEG and
  becomes the world's card image.

## Data model

`supabase/migrations/20261027000000_shared_worlds.sql`:

| Table             | Columns that matter                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds`          | `id` (= the document's id), `owner`, `title` (≤ 80), `seed`, `map_version`, `doc` (WorldDocumentV1), `visibility` (`private` / `unlisted` / `public`), `remix_of`, `rev` and `entity_clock` (co-editing, below), `command_count` (generated, for lists), `created_at`, `updated_at` (server time, the conflict check) |
| `world_editors`   | `(world_id, user_id)`, `role` (`editor` / `viewer`), `invite` (the token redeemed)                                                                                                                                                                                                                                    |
| `world_invites`   | `token`, `world_id`, `role`, `expires_at` (≤ 30 days)                                                                                                                                                                                                                                                                 |
| `world_snapshots` | `world_id`, `ts`, `image_path` (`<world id>/<file>` in the `world-thumbnails` bucket)                                                                                                                                                                                                                                 |

A trigger (`private.guard_world_write`) refuses a document that is not a JSON
object of schema 1, whose `id`, `seed` or `mapVersion` disagree with the row,
with more than 20 000 commands or larger than 8 MiB. It keeps `owner`,
`created_at` and `remix_of` fixed, lets only the owner change `title`,
`visibility`, `seed` or `map_version`, and sets the timestamps itself.

## Access (RLS)

| Who                     | `worlds`                                                                                 | members / invites                     | thumbnails                        | Realtime                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| owner                   | everything                                                                               | manages members, creates invites      | uploads                           | sends on both topics                                 |
| editor                  | reads; updates `doc`, `rev`, `entity_clock`                                              | sees and drops own membership         | uploads                           | sends on both topics                                 |
| viewer (private worlds) | reads                                                                                    | sees and drops own membership         | reads                             | `world:<id>` only                                    |
| anyone signed in        | reads `public`; reads `unlisted` **by id**; publishes own (not `public` while anonymous) | redeems a valid invite for themselves | reads where the world is readable | `world:<id>` of a readable world; listens on `:edit` |
| no session (`anon`)     | reads `public`                                                                           | none                                  | reads public                      | none                                                 |

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
- **Realtime Authorization** (private channels): `world:<id>` (presence,
  poses, shared progress) is joinable by anyone who can read the world;
  `world:<id>:edit` (edits, cursors, sync, kicks) can be heard by readers and
  sent to only by editors. Policies cannot see a message's event, which is why
  edits have their own topic. Ambient presence (`candy:<seed>`) stays a public
  channel.

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
write-back) is a POST to `supabase/functions/validate-world`:

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
`CANDY_PAINT_PALETTE`, at most 8 MB. Then it writes **with the caller's own
JWT**, so RLS still decides who may write what. Answers: `201` created, `200`
updated, `409 conflict` (the row moved past `expectedUpdatedAt`; the body has
the current row), `409 terrain`, `403`, `422` (with the validator's `code`:
`schema`, `identity`, `over_cap`, `palette`, `too_large`).

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
  against what was last synced (`SyncMeta.entityHashes`: the entities this copy
  changed since keep its version, every other entity takes the remote one,
  progress is a union) and tries once more. `open` does the same when a link
  boots: remote only, local only (offline), or merged. Entities changed outside
  a live room get fresh co-editing stamps (`sync-<user>` as the author), so a
  live room orders them against its own writes.
- **Boot.** `src/world/document/lazy.ts` sees `?world=` and hands off to the
  `net` chunk (`openSharedWorldFromLink`): sign in, redeem the invite, open the
  world (validated), replay its commands on the generated base world, join the
  room. Anything that fails falls back to the player's own world for the seed.
  A shared world is not remembered as the seed's active world.

## Live co-editing protocol

`src/systems/net/world-sync-protocol.ts` is the protocol, pure and
unit-tested; `src/systems/net/shared-world-session.ts` binds it to Realtime,
the `EditHistory` and the live world.

| Event      | Topic             | Payload                                                                    | Rate (per sender)        |
| ---------- | ----------------- | -------------------------------------------------------------------------- | ------------------------ |
| `pose`     | `world:<id>`      | `{ id, pos, quat, biome, ts }` (unchanged)                                 | `CONFIG.presence.tickHz` |
| `progress` | `world:<id>`      | `{ author, kind: 'awakened' \| 'stamp' \| 'discovery', id, type? }`        | 10/s, burst 30           |
| `cmd`      | `world:<id>:edit` | `{ author, seq, rev, baseRev, command: SerializedWorldCommand, origins? }` | 12/s, burst 40           |
| `cursor`   | `world:<id>:edit` | `{ author, pos \| null, selection: id[] (≤ 32), tool }`                    | 4/s sent, 8/s accepted   |
| `sync`     | `world:<id>:edit` | `{ author, rev, hash, updatedAt }` (host only)                             | after each write-back    |
| `kick`     | `world:<id>:edit` | `{ author, target }` (owner only)                                          | —                        |

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
document already holds change nothing and the ones it lacks apply.

**The host.** The editor who joined the edit topic first (ties: the smaller
peer id) is host. Every 15 s while the world changed, when the tab hides and
on leave, it writes the merged document back (`documentCommands()`: one
`place`, `move` or `remove` per authored entity, plus `rev` and
`entity_clock`) through `validate-world` with its last `updated_at`, then
announces `sync` with the hash it wrote. When the host leaves, the next editor
takes over. Viewers are never host.

**Anti-entropy.** Broadcast is best-effort. A replica whose hash differs from
the host's `sync` fetches the row (at most every 10 s) and `reconcile`s: it
adopts every entity whose stored stamp is newer than its own, and re-sends its
own writes the row lacks. A reconnect reconciles too. The protocol tests drop
15% of messages across three peers and converge after the host's syncs.

**Inbound checks.** Every inbound message is dropped and logged (never
applied) when it is malformed (valibot, against the document schema), larger
than its limit (`cmd` 96 KB, others 2 KB), touches more than 64 entities,
moves one id onto another, comes from a kicked peer, exceeds its sender's
rate, claims a rev more than 100 000 ahead of the room, or would take the
world past the entity caps. Paint outside `CANDY_PAINT_PALETTE` is clamped to
the nearest candy colour (deterministic, so every replica clamps alike).
Counters are on `window.__sharedWorld.stats.dropped`.

**Caps under concurrency.** Two builders can each place the 600th piece before
hearing of the other's. Each replica refuses the one that would go past the
cap; the host's refusal is final: it answers with a compensating write that
takes the piece back out for anyone who applied it, and its `sync` repairs the
rest.

**Mute and kick.** _Mute_ (the peer list) hides a peer's avatar and cursor and
ignores their progress, locally; their edits still apply, so the world stays
one world. _Remove_ (the world owner only) broadcasts `kick`: every peer
ignores that peer from then on, and the owner's client deletes their
`world_editors` row, so their next join (or token refresh) is refused.

**Shared progress.** A first-time discovery, Night Market stamp or awakened
flower is reported on `src/systems/progress-events.ts` and broadcast; peers
apply it inside `applyRemoteProgress` (so it is not echoed back) and it lands
in the shared document's progress at the next save.

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
  non-editors off the edit topic, but one editor could still forge another's
  stamp; the host's sync and the row's RLS bound the damage.
- A kicked editor's open connection keeps listening until its token refreshes.
- Progress made in a shared world also stays with the player (progress only
  grows; the live progress systems are per player, not per world).
- Thumbnails of deleted worlds stay in the bucket until a server-side sweep.

## Tests

- `npm run test:world-sync`: the protocol. Two replicas, 50 interleaved
  place/move/remove/paint/undo ops with reordered and duplicated delivery
  (40 seeds), reversed double delivery, late joiners, lost messages repaired by
  a sync, three peers with 15% loss (60 seeds), caps at the limit with the
  host's compensation, inbound validation, palette clamp, rate limits, host
  election.
- `npm run test:shared-worlds`: the validator, the edge handler, the
  `RemoteDocumentStore`, offline-first sync and the per-entity merge, share
  links.
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

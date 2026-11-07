-- Shared worlds (#1975), follow-up: one write path for a world's document,
-- an owner-only kick topic, and deletable remix sources.
--
-- 1. Clients could update `doc`, `rev` and `entity_clock` directly over the
--    Data API (as owner or editor), skipping the validate-world edge function
--    and its checks (entity caps, palette, size, clock bounds). Now clients
--    have no insert grant and may update `title` and `visibility` only, as
--    the owner; validate-world checks its caller and writes as service_role.
-- 2. Kicks move to `world:<id>:owner`, which only the owner can send on, so a
--    peer can act on one (on the edit topic any editor could forge it).
--    Shared progress moves from `world:<id>` to the edit topic in the client.
-- 3. `remix_of ... on delete set null` updates the remix, and the write guard
--    refused any change to remix_of, so a remixed world could not be deleted.
--    remix_of may now clear.
--
-- docs/SHARED_WORLDS.md describes the result; supabase/tests/shared_worlds_rls.sql
-- checks it.

-- ---------------------------------------------------------------------------
-- 1. Writes
-- ---------------------------------------------------------------------------

revoke insert, update on table public.worlds from authenticated;
grant update (title, visibility) on table public.worlds to authenticated;
-- validate-world (and only it) publishes and writes documents.
grant select, insert, update on table public.worlds to service_role;
grant select on table public.world_editors to service_role;

drop policy worlds_insert on public.worlds;
drop policy worlds_public_needs_account_insert on public.worlds;

-- The owner renames and changes visibility (the column grants allow nothing
-- else); every document write is validate-world's.
alter policy worlds_update on public.worlds
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

comment on policy worlds_public_needs_account_update on public.worlds is
    'An anonymous owner keeps a world private or unlisted; validate-world applies the same rule to publishing.';

-- Limits mirror src/world/document/schema.ts and shared-validation.ts.
create or replace function private.guard_world_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    commands jsonb := new.doc -> 'commands';
begin
    if jsonb_typeof(new.doc) is distinct from 'object' then
        raise exception 'world document must be a JSON object' using errcode = '22023';
    end if;
    if new.doc ->> 'schema' is distinct from '1' then
        raise exception 'world document schema must be 1' using errcode = '22023';
    end if;
    if new.doc ->> 'id' is distinct from new.id::text then
        raise exception 'world document id must equal the world id' using errcode = '22023';
    end if;
    if jsonb_typeof(new.doc -> 'seed') is distinct from 'number'
        or (new.doc ->> 'seed')::numeric is distinct from new.seed::numeric then
        raise exception 'world document seed must equal the world seed' using errcode = '22023';
    end if;
    if new.doc ->> 'mapVersion' is distinct from new.map_version then
        raise exception 'world document mapVersion must equal map_version' using errcode = '22023';
    end if;
    if jsonb_typeof(commands) is distinct from 'array' or jsonb_array_length(commands) > 20000 then
        raise exception 'world document commands must be an array of at most 20000'
            using errcode = '22023';
    end if;
    if octet_length(new.doc::text) > 8 * 1024 * 1024 then
        raise exception 'world document is larger than 8 MiB' using errcode = '22023';
    end if;
    if jsonb_typeof(new.entity_clock) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(new.entity_clock)) > 50000 then
        raise exception 'entity_clock must be an object of at most 50000 entries'
            using errcode = '22023';
    end if;

    if tg_op = 'UPDATE' then
        -- remix_of only ever clears: `on delete set null` when the source goes.
        if new.owner is distinct from old.owner
            or new.created_at is distinct from old.created_at
            or (new.remix_of is distinct from old.remix_of and new.remix_of is not null) then
            raise exception 'owner, created_at and remix_of cannot change' using errcode = '42501';
        end if;
        -- Only the owner names the world, picks who sees it, or moves its
        -- terrain. validate-world (service_role) checks its caller itself.
        if current_user <> 'service_role' and auth.uid() is distinct from old.owner and (
            new.title is distinct from old.title
            or new.visibility is distinct from old.visibility
            or new.seed is distinct from old.seed
            or new.map_version is distinct from old.map_version
        ) then
            raise exception 'only the owner can change title, visibility, seed or map_version'
                using errcode = '42501';
        end if;
        new.updated_at := now();
    else
        new.created_at := now();
        new.updated_at := new.created_at;
    end if;
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Realtime: world:<id>:owner
-- ---------------------------------------------------------------------------

-- `world:<uuid>`, `world:<uuid>:edit` and `world:<uuid>:owner` → the uuid;
-- anything else → null.
create or replace function private.topic_world_id(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
    select case
        when topic ~ '^world:[0-9a-fA-F-]{36}(:edit|:owner)?$'
            then private.try_uuid(substr(topic, 7, 36))
        else null
    end;
$$;

-- `world:<id>`: readers. `:edit` (commands, cursors, sync, shared progress):
-- editors. `:owner` (kicks): the owner. world_rooms_receive is unchanged:
-- every reader listens on all three.
alter policy world_rooms_send on realtime.messages
    with check (
        realtime.messages.extension in ('broadcast', 'presence')
        and case
            when (select realtime.topic()) like '%:edit'
                then private.can_edit_world(private.topic_world_id((select realtime.topic())))
            when (select realtime.topic()) like '%:owner'
                then coalesce(
                    private.world_role(private.topic_world_id((select realtime.topic()))) = 'owner',
                    false
                )
            else private.can_read_world(private.topic_world_id((select realtime.topic())))
        end
    );

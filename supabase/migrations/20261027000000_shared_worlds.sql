-- Shared worlds (#1975): published WorldDocuments, their editors, invite
-- links, photo-mode thumbnails, and the Realtime rooms that co-edit them.
-- docs/SHARED_WORLDS.md describes the access model; this file is its source
-- of truth. supabase/tests/shared_worlds_rls.sql exercises every policy.
--
-- Access model
--   worlds          owner: everything. Editors: update the document. Anyone:
--                   read `public` worlds; read an `unlisted` world only by
--                   naming its id (the `x-candy-world-id` request header), so
--                   unlisted worlds cannot be listed. `private`: owner and
--                   members only. A `public` world needs a permanent (not
--                   anonymous) account.
--   world_editors   owner manages members; a member can see and drop their own
--                   row; an invite token adds yourself.
--   world_invites   owner only.
--   world_snapshots readable wherever the world is; editors add them.
--   storage         `world-thumbnails/<world id>/<file>`: editors upload,
--                   served by public URL, never listable, append-only.
--   realtime        `world:<id>` (presence, poses, shared progress): readers.
--                   `world:<id>:edit` (commands, build cursors): readers
--                   listen, editors send.
--
-- Every SECURITY DEFINER helper lives in the `private` schema, which the Data
-- API does not expose, so none of them is callable over REST.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.worlds (
    id uuid primary key default gen_random_uuid(),
    owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 80),
    seed bigint not null,
    map_version text not null check (char_length(map_version) between 1 and 64),
    -- WorldDocumentV1 (src/world/document/schema.ts). Fully validated by the
    -- validate-world edge function and by every client that loads it; the
    -- trigger below keeps the shape and size honest for any other writer.
    doc jsonb not null,
    visibility text not null default 'unlisted'
        check (visibility in ('private', 'unlisted', 'public')),
    remix_of uuid references public.worlds (id) on delete set null,
    -- Live co-editing (src/systems/net/world-sync-protocol.ts): the Lamport
    -- high-water mark and, per entity id, the (rev, author) stamp of the write
    -- the document holds, so a late joiner can drop buffered commands the
    -- document already includes.
    rev bigint not null default 0 check (rev >= 0),
    entity_clock jsonb not null default '{}'::jsonb,
    -- For world lists, which select everything but `doc`.
    command_count integer generated always as (
        case when jsonb_typeof(doc -> 'commands') = 'array'
            then jsonb_array_length(doc -> 'commands') else 0 end
    ) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.worlds is 'Published Candy World WorldDocuments (#1975).';

create index worlds_owner_updated_idx on public.worlds (owner, updated_at desc);
create index worlds_remix_of_idx on public.worlds (remix_of);
create index worlds_public_updated_idx on public.worlds (updated_at desc, id desc)
    where visibility = 'public';

create table public.world_editors (
    world_id uuid not null references public.worlds (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null default 'editor' check (role in ('editor', 'viewer')),
    -- The invite a member redeemed to add themselves (null when the owner
    -- added them directly).
    invite uuid,
    created_at timestamptz not null default now(),
    primary key (world_id, user_id)
);

create index world_editors_user_idx on public.world_editors (user_id);

create table public.world_invites (
    token uuid primary key default gen_random_uuid(),
    world_id uuid not null references public.worlds (id) on delete cascade,
    role text not null default 'editor' check (role in ('editor', 'viewer')),
    created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '7 days'
);

create index world_invites_world_idx on public.world_invites (world_id);
create index world_invites_created_by_idx on public.world_invites (created_by);

create table public.world_snapshots (
    id bigint generated always as identity primary key,
    world_id uuid not null references public.worlds (id) on delete cascade,
    ts timestamptz not null default now(),
    -- Object path inside the `world-thumbnails` bucket: `<world id>/<file>`.
    image_path text not null check (char_length(image_path) <= 200),
    created_by uuid default auth.uid() references auth.users (id) on delete set null
);

create index world_snapshots_world_ts_idx on public.world_snapshots (world_id, ts desc);
create index world_snapshots_created_by_idx on public.world_snapshots (created_by);

-- ---------------------------------------------------------------------------
-- Helpers (private schema: usable from policies, not from the API)
-- ---------------------------------------------------------------------------

-- Text to uuid, or null when it is not one (object paths, topics, headers).
create function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
    return value::uuid;
exception when others then
    return null;
end;
$$;

-- The world id an unlisted read names (`x-candy-world-id` request header).
create function private.requested_world_id()
returns uuid
language sql
stable
set search_path = ''
as $$
    select private.try_uuid(
        nullif(current_setting('request.headers', true), '')::json ->> 'x-candy-world-id'
    );
$$;

-- True for a JWT from an anonymous sign-in.
create function private.is_anonymous()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- The caller's role in a world: 'owner', 'editor', 'viewer' or null.
-- SECURITY DEFINER so the worlds and world_editors policies can consult each
-- other without recursing through RLS.
create function private.world_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when auth.uid() is null then null
        when exists (
            select 1 from public.worlds w where w.id = target and w.owner = auth.uid()
        ) then 'owner'
        else (
            select e.role from public.world_editors e
            where e.world_id = target and e.user_id = auth.uid()
        )
    end;
$$;

-- May the caller read this world? (public, unlisted-by-id, or a member.)
create function private.can_read_world(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select w.visibility in ('public', 'unlisted') from public.worlds w where w.id = target),
        false
    ) or private.world_role(target) is not null;
$$;

-- May the caller change this world's document?
create function private.can_edit_world(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(private.world_role(target) in ('owner', 'editor'), false);
$$;

-- Is a still-valid invite for `target` with this role?
create function private.invite_is_valid(target uuid, invite_token uuid, invite_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.world_invites i
        where i.token = invite_token
            and i.world_id = target
            and i.role = invite_role
            and i.expires_at > now()
    );
$$;

-- `world:<uuid>` and `world:<uuid>:edit` → the uuid; anything else → null.
create function private.topic_world_id(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
    select case
        when topic ~ '^world:[0-9a-fA-F-]{36}(:edit)?$'
            then private.try_uuid(substr(topic, 7, 36))
        else null
    end;
$$;

revoke all on function private.try_uuid(text) from public;
revoke all on function private.requested_world_id() from public;
revoke all on function private.is_anonymous() from public;
revoke all on function private.world_role(uuid) from public;
revoke all on function private.can_read_world(uuid) from public;
revoke all on function private.can_edit_world(uuid) from public;
revoke all on function private.invite_is_valid(uuid, uuid, text) from public;
revoke all on function private.topic_world_id(text) from public;
grant execute on function private.try_uuid(text) to anon, authenticated, service_role;
grant execute on function private.requested_world_id() to anon, authenticated, service_role;
grant execute on function private.is_anonymous() to anon, authenticated, service_role;
grant execute on function private.world_role(uuid) to anon, authenticated, service_role;
grant execute on function private.can_read_world(uuid) to anon, authenticated, service_role;
grant execute on function private.can_edit_world(uuid) to anon, authenticated, service_role;
grant execute on function private.invite_is_valid(uuid, uuid, text) to authenticated, service_role;
grant execute on function private.topic_world_id(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Document guard: shape, size, identity, and what an editor may touch
-- ---------------------------------------------------------------------------

-- Limits mirror src/world/document/schema.ts and shared-validation.ts.
create function private.guard_world_write()
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
        if new.owner is distinct from old.owner
            or new.created_at is distinct from old.created_at
            or new.remix_of is distinct from old.remix_of then
            raise exception 'owner, created_at and remix_of cannot change' using errcode = '42501';
        end if;
        -- Editors may change the document (and its sync clock), not what the
        -- world is called, who sees it, or which terrain it sits on.
        if auth.uid() is distinct from old.owner and (
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

revoke all on function private.guard_world_write() from public;

create trigger worlds_guard_write
    before insert or update on public.worlds
    for each row execute function private.guard_world_write();

-- ---------------------------------------------------------------------------
-- Privileges (least privilege; RLS decides rows)
-- ---------------------------------------------------------------------------

revoke all on table public.worlds, public.world_editors, public.world_invites,
    public.world_snapshots from anon, authenticated;
grant select on table public.worlds, public.world_snapshots to anon;
grant select, insert, update, delete on table public.worlds to authenticated;
grant select, insert, update, delete on table public.world_editors to authenticated;
grant select, insert, delete on table public.world_invites to authenticated;
grant select, insert, delete on table public.world_snapshots to authenticated;

alter table public.worlds enable row level security;
alter table public.world_editors enable row level security;
alter table public.world_invites enable row level security;
alter table public.world_snapshots enable row level security;

-- ---------------------------------------------------------------------------
-- worlds
-- ---------------------------------------------------------------------------

create policy worlds_select on public.worlds
    for select to anon, authenticated
    using (
        visibility = 'public'
        or (visibility = 'unlisted' and id = (select private.requested_world_id()))
        or owner = (select auth.uid())
        or private.world_role(id) is not null
    );

create policy worlds_insert on public.worlds
    for insert to authenticated
    with check (
        owner = (select auth.uid())
        and (remix_of is null or private.can_read_world(remix_of))
    );

create policy worlds_update on public.worlds
    for update to authenticated
    using (owner = (select auth.uid()) or private.can_edit_world(id))
    with check (owner = (select auth.uid()) or private.can_edit_world(id));

create policy worlds_delete on public.worlds
    for delete to authenticated
    using (owner = (select auth.uid()));

-- The public gallery is for permanent accounts: an anonymous player can
-- publish private and unlisted worlds, not public ones.
create policy worlds_public_needs_account_insert on public.worlds
    as restrictive for insert to authenticated
    with check (visibility <> 'public' or not (select private.is_anonymous()));

create policy worlds_public_needs_account_update on public.worlds
    as restrictive for update to authenticated
    with check (visibility <> 'public' or not (select private.is_anonymous()));

-- ---------------------------------------------------------------------------
-- world_editors
-- ---------------------------------------------------------------------------

create policy world_editors_select on public.world_editors
    for select to authenticated
    using (user_id = (select auth.uid()) or private.world_role(world_id) = 'owner');

-- The owner adds a member, or a player redeems a valid invite for themselves.
create policy world_editors_insert on public.world_editors
    for insert to authenticated
    with check (
        private.world_role(world_id) = 'owner'
        or (
            user_id = (select auth.uid())
            and invite is not null
            and private.invite_is_valid(world_id, invite, role)
        )
    );

create policy world_editors_update on public.world_editors
    for update to authenticated
    using (private.world_role(world_id) = 'owner')
    with check (private.world_role(world_id) = 'owner');

-- The owner removes anyone; a member can leave.
create policy world_editors_delete on public.world_editors
    for delete to authenticated
    using (user_id = (select auth.uid()) or private.world_role(world_id) = 'owner');

-- ---------------------------------------------------------------------------
-- world_invites
-- ---------------------------------------------------------------------------

create policy world_invites_select on public.world_invites
    for select to authenticated
    using (private.world_role(world_id) = 'owner');

create policy world_invites_insert on public.world_invites
    for insert to authenticated
    with check (
        created_by = (select auth.uid())
        and private.world_role(world_id) = 'owner'
        and expires_at <= now() + interval '30 days'
    );

create policy world_invites_delete on public.world_invites
    for delete to authenticated
    using (private.world_role(world_id) = 'owner');

-- ---------------------------------------------------------------------------
-- world_snapshots (thumbnails): visible wherever the world itself is
-- ---------------------------------------------------------------------------

create policy world_snapshots_select on public.world_snapshots
    for select to anon, authenticated
    using (exists (select 1 from public.worlds w where w.id = world_snapshots.world_id));

create policy world_snapshots_insert on public.world_snapshots
    for insert to authenticated
    with check (
        created_by = (select auth.uid())
        and private.can_edit_world(world_id)
        and image_path like world_id::text || '/%'
    );

create policy world_snapshots_delete on public.world_snapshots
    for delete to authenticated
    using (created_by = (select auth.uid()) or private.world_role(world_id) = 'owner');

-- ---------------------------------------------------------------------------
-- Storage: world-thumbnails/<world id>/<file>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'world-thumbnails',
    'world-thumbnails',
    true,
    2 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Public bucket: objects are served by URL. No select, update or delete
-- policy, so clients can neither list the bucket nor overwrite or remove a
-- thumbnail (each upload is a new object; world_snapshots points at the
-- current one).
create policy world_thumbnails_insert on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'world-thumbnails'
        and private.can_edit_world(private.try_uuid((storage.foldername(name))[1]))
    );

-- ---------------------------------------------------------------------------
-- Realtime Authorization (private channels)
-- ---------------------------------------------------------------------------

create policy world_rooms_receive on realtime.messages
    for select to authenticated
    using (
        realtime.messages.extension in ('broadcast', 'presence')
        and private.can_read_world(private.topic_world_id((select realtime.topic())))
    );

create policy world_rooms_send on realtime.messages
    for insert to authenticated
    with check (
        realtime.messages.extension in ('broadcast', 'presence')
        and case
            when (select realtime.topic()) like '%:edit'
                then private.can_edit_world(private.topic_world_id((select realtime.topic())))
            else private.can_read_world(private.topic_world_id((select realtime.topic())))
        end
    );

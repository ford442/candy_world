-- Minimal stand-ins for the parts of a Supabase project the shared-worlds
-- migration touches (roles, auth, storage, realtime), so the migration and its
-- RLS tests run on a plain Postgres: scripts/check-supabase-rls.mjs.
-- Never applied to a real project.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
    id uuid primary key,
    is_anonymous boolean not null default false
);

-- As on the platform: claims arrive as the `request.jwt.claims` setting.
create function auth.jwt() returns jsonb
language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid() returns uuid
language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
);

create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    owner_id text
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
    parts text[];
begin
    select string_to_array(name, '/') into parts;
    return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
    id uuid primary key default gen_random_uuid(),
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default false
);

alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated;

-- Realtime sets the joined topic before it probes the policies.
create function realtime.topic() returns text
language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '');
$$;

grant execute on function realtime.topic() to anon, authenticated, service_role;

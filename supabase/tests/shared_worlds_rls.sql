-- RLS tests for supabase/migrations/20261027000000_shared_worlds.sql.
-- Run by scripts/check-supabase-rls.mjs on a scratch database after
-- platform-stubs.sql and the migration. Every check raises on failure.
--
-- Cast: alice (permanent account, owns worlds), bob (anonymous, joins as an
-- editor through an invite), carol (anonymous stranger), dave (anonymous,
-- viewer of alice's private world), the `anon` role (no session), and
-- service_role (the validate-world edge function, the only document writer).

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create function pg_temp.check(ok boolean, label text) returns void
language plpgsql as $$
begin
    if ok is not true then
        raise exception 'FAIL: %', label;
    end if;
    raise notice 'ok - %', label;
end;
$$;

-- `stmt` must raise (an RLS violation, a trigger refusal, a constraint).
create function pg_temp.fails(stmt text, label text) returns void
language plpgsql as $$
begin
    begin
        execute stmt;
    exception when others then
        raise notice 'ok - % (refused: %)', label, sqlerrm;
        return;
    end;
    raise exception 'FAIL: % (the statement succeeded)', label;
end;
$$;

-- `stmt` must succeed and touch exactly `expected` rows.
create function pg_temp.affects(stmt text, expected int, label text) returns void
language plpgsql as $$
declare
    n int;
begin
    execute stmt;
    get diagnostics n = row_count;
    if n <> expected then
        raise exception 'FAIL: % (% rows, expected %)', label, n, expected;
    end if;
    raise notice 'ok - %', label;
end;
$$;

create function pg_temp.doc(world uuid, seed bigint) returns jsonb
language sql as $$
    select jsonb_build_object(
        'schema', 1,
        'id', world::text,
        'seed', seed,
        'mapVersion', '1.0',
        'commands', '[]'::jsonb,
        'progress', jsonb_build_object(
            'discoveries', '[]'::jsonb, 'unlocks', '[]'::jsonb, 'inventory', '{}'::jsonb,
            'awakened', '[]'::jsonb, 'stamps', '[]'::jsonb,
            'partII', jsonb_build_object('sugarCavesUnlocked', false)
        ),
        'player', jsonb_build_object('position', '[0,0,0]'::jsonb, 'yaw', 0),
        'meta', jsonb_build_object('createdAt', 1, 'updatedAt', 1)
    );
$$;

create function pg_temp.login(who uuid, anonymous boolean) returns void
language sql as $$
    select set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', who, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
        false
    );
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

insert into auth.users (id, is_anonymous) values
    ('a11ce000-0000-4000-8000-000000000001', false),
    ('b0b00000-0000-4000-8000-000000000002', true),
    ('ca401000-0000-4000-8000-000000000003', true),
    ('da7e0000-0000-4000-8000-000000000004', true);

-- Worlds: W1 unlisted (alice), W2 public (alice), W4 private (alice).
--         W3 unlisted (carol).

do $$ begin raise notice '== worlds: clients cannot write documents =='; end $$;
select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.fails($$
    insert into public.worlds (id, title, seed, map_version, doc, visibility)
    values ('00000000-0000-4000-8000-0000000000a1', 'Grove', 12345, '1.0',
            pg_temp.doc('00000000-0000-4000-8000-0000000000a1', 12345), 'unlisted')
$$, 'a client cannot insert a world (validate-world publishes)');
reset role;

do $$ begin raise notice '== worlds: validate-world publishes (service_role) =='; end $$;
select set_config('request.jwt.claims', '', false);
set role service_role;

select pg_temp.affects($$
    insert into public.worlds (id, owner, title, seed, map_version, doc, visibility)
    values ('00000000-0000-4000-8000-0000000000a1', 'a11ce000-0000-4000-8000-000000000001',
            'Grove', 12345, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000a1', 12345),
            'unlisted')
$$, 1, 'alice''s unlisted world is published');

select pg_temp.affects($$
    insert into public.worlds (id, owner, title, seed, map_version, doc, visibility)
    values ('00000000-0000-4000-8000-0000000000a2', 'a11ce000-0000-4000-8000-000000000001',
            'Gallery', 7, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000a2', 7), 'public')
$$, 1, 'alice''s public world is published');

select pg_temp.affects($$
    insert into public.worlds (id, owner, title, seed, map_version, doc, visibility)
    values ('00000000-0000-4000-8000-0000000000a4', 'a11ce000-0000-4000-8000-000000000001',
            'Secret', 99, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000a4', 99), 'private')
$$, 1, 'alice''s private world is published');

select pg_temp.affects($$
    insert into public.worlds (id, owner, title, seed, map_version, doc, visibility)
    values ('00000000-0000-4000-8000-0000000000a3', 'ca401000-0000-4000-8000-000000000003',
            'Carol''s', 5, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000a3', 5), 'unlisted')
$$, 1, 'carol''s (anonymous) unlisted world is published');

select pg_temp.check(
    (select command_count from public.worlds where id = '00000000-0000-4000-8000-0000000000a1') = 0
    and (select created_at = updated_at from public.worlds
         where id = '00000000-0000-4000-8000-0000000000a1'),
    'command_count is derived and the timestamps are the server''s'
);

select pg_temp.fails($$
    insert into public.worlds (id, owner, title, seed, map_version, doc)
    values ('00000000-0000-4000-8000-0000000000b1', 'a11ce000-0000-4000-8000-000000000001',
            'Bad', 1, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000b2', 1))
$$, 'document id must match the world id');

select pg_temp.fails($$
    insert into public.worlds (id, owner, title, seed, map_version, doc)
    values ('00000000-0000-4000-8000-0000000000b1', 'a11ce000-0000-4000-8000-000000000001',
            'Bad', 2, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000b1', 1))
$$, 'document seed must match the world seed');

select pg_temp.fails($$
    insert into public.worlds (id, owner, title, seed, map_version, doc)
    values ('00000000-0000-4000-8000-0000000000b1', 'a11ce000-0000-4000-8000-000000000001',
            'Bad', 1, '1.0',
            pg_temp.doc('00000000-0000-4000-8000-0000000000b1', 1) || '{"schema": 2}')
$$, 'only schema 1 documents are stored');

select pg_temp.fails($$
    insert into public.worlds (id, owner, title, seed, map_version, doc)
    values ('00000000-0000-4000-8000-0000000000b1', 'a11ce000-0000-4000-8000-000000000001',
            'Bad', 1, '1.0',
            jsonb_set(pg_temp.doc('00000000-0000-4000-8000-0000000000b1', 1), '{commands}',
                      (select jsonb_agg('{}'::jsonb) from generate_series(1, 20001))))
$$, 'more than 20000 commands is refused');

select pg_temp.affects($$
    update public.worlds
    set doc = jsonb_set(doc, '{meta,updatedAt}', '5'), rev = 3,
        entity_clock = '{"e1": [3, "peer-b"]}', title = 'Grove'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 1, 'validate-world writes the document and its clock');
select pg_temp.fails($$
    update public.worlds set entity_clock = '[1]'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'the clock must be an object, whoever writes it');
select pg_temp.fails($$
    update public.worlds set owner = 'ca401000-0000-4000-8000-000000000003'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'ownership never moves, whoever writes it');
reset role;

do $$ begin raise notice '== worlds: anonymous accounts =='; end $$;
select pg_temp.login('ca401000-0000-4000-8000-000000000003', true);
set role authenticated;

select pg_temp.fails($$
    update public.worlds set visibility = 'public'
    where id = '00000000-0000-4000-8000-0000000000a3'
$$, 'an anonymous owner cannot make a world public');

select pg_temp.affects($$
    update public.worlds set title = 'Carol''s grove'
    where id = '00000000-0000-4000-8000-0000000000a3'
$$, 1, 'an anonymous owner renames their world');

select pg_temp.check(
    (select array_agg(id order by id) from public.worlds)
        = array['00000000-0000-4000-8000-0000000000a2',
                '00000000-0000-4000-8000-0000000000a3']::uuid[],
    'a stranger lists public worlds and their own, never unlisted or private ones'
);

select set_config('request.headers', '{"x-candy-world-id": "00000000-0000-4000-8000-0000000000a1"}', false);
select pg_temp.check(
    exists (select 1 from public.worlds where id = '00000000-0000-4000-8000-0000000000a1'),
    'an unlisted world opens by naming its id'
);
select set_config('request.headers', '{"x-candy-world-id": "00000000-0000-4000-8000-0000000000a4"}', false);
select pg_temp.check(
    not exists (select 1 from public.worlds where id = '00000000-0000-4000-8000-0000000000a4'),
    'naming a private world''s id does not open it'
);
select set_config('request.headers', '', false);

select pg_temp.fails($$
    update public.worlds set doc = doc || '{"meta": {"createdAt": 1, "updatedAt": 2}}'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'a stranger cannot edit someone else''s world');

select pg_temp.affects($$
    update public.worlds set title = 'Mine'
    where id = '00000000-0000-4000-8000-0000000000a2'
$$, 0, 'a stranger cannot rename a public world');

select pg_temp.affects($$
    delete from public.worlds where id = '00000000-0000-4000-8000-0000000000a2'
$$, 0, 'a stranger cannot delete a public world');
reset role;

-- carol remixes the public world (validate-world names a public source only).
set role service_role;
select pg_temp.affects($$
    insert into public.worlds (id, owner, title, seed, map_version, doc, remix_of)
    values ('00000000-0000-4000-8000-0000000000c1', 'ca401000-0000-4000-8000-000000000003',
            'Remix', 7, '1.0', pg_temp.doc('00000000-0000-4000-8000-0000000000c1', 7),
            '00000000-0000-4000-8000-0000000000a2')
$$, 1, 'a remix of a public world points back at it');
reset role;
select pg_temp.login('ca401000-0000-4000-8000-000000000003', true);
set role authenticated;

select pg_temp.affects($$
    select * from public.world_invites
$$, 0, 'a stranger sees no invites');

reset role;

do $$ begin raise notice '== anon role (no session) =='; end $$;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.check(
    (select array_agg(id order by id) from public.worlds)
        = array['00000000-0000-4000-8000-0000000000a2']::uuid[],
    'without a session only public worlds are listed (a remix starts unlisted)'
);
select pg_temp.fails($$
    insert into public.worlds (title, seed, map_version, doc)
    values ('Nope', 1, '1.0', '{}')
$$, 'without a session nothing is written');
reset role;

do $$ begin raise notice '== invites and editors =='; end $$;
select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.affects($$
    insert into public.world_invites (token, world_id, role)
    values ('11111111-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'editor'),
           ('11111111-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a4', 'viewer')
$$, 2, 'the owner creates invite links');
select pg_temp.fails($$
    insert into public.world_invites (world_id, role, expires_at)
    values ('00000000-0000-4000-8000-0000000000a1', 'editor', now() + interval '1 year')
$$, 'an invite lives at most 30 days');
reset role;

select pg_temp.login('ca401000-0000-4000-8000-000000000003', true);
set role authenticated;
select pg_temp.fails($$
    insert into public.world_invites (world_id) values ('00000000-0000-4000-8000-0000000000a1')
$$, 'only the owner creates invites');
reset role;

select pg_temp.login('b0b00000-0000-4000-8000-000000000002', true);
set role authenticated;
select pg_temp.fails($$
    insert into public.world_editors (world_id, user_id, role, invite)
    values ('00000000-0000-4000-8000-0000000000a1', 'b0b00000-0000-4000-8000-000000000002',
            'editor', '11111111-0000-4000-8000-000000000999')
$$, 'a made-up invite token is refused');
select pg_temp.fails($$
    insert into public.world_editors (world_id, user_id, role, invite)
    values ('00000000-0000-4000-8000-0000000000a4', 'b0b00000-0000-4000-8000-000000000002',
            'editor', '11111111-0000-4000-8000-000000000002')
$$, 'a viewer invite does not make an editor');
select pg_temp.fails($$
    insert into public.world_editors (world_id, user_id, role, invite)
    values ('00000000-0000-4000-8000-0000000000a1', 'ca401000-0000-4000-8000-000000000003',
            'editor', '11111111-0000-4000-8000-000000000001')
$$, 'an invite only adds the player redeeming it');
select pg_temp.affects($$
    insert into public.world_editors (world_id, user_id, role, invite)
    values ('00000000-0000-4000-8000-0000000000a1', 'b0b00000-0000-4000-8000-000000000002',
            'editor', '11111111-0000-4000-8000-000000000001')
$$, 1, 'bob redeems an editor invite');
select pg_temp.fails($$
    insert into public.world_editors (world_id, user_id, role)
    values ('00000000-0000-4000-8000-0000000000a1', 'ca401000-0000-4000-8000-000000000003', 'editor')
$$, 'an editor cannot add more editors');
select pg_temp.affects($$
    update public.world_editors set role = 'editor'
    where world_id = '00000000-0000-4000-8000-0000000000a1'
$$, 0, 'an editor cannot change roles');

select pg_temp.check(
    exists (select 1 from public.worlds where id = '00000000-0000-4000-8000-0000000000a1'),
    'an editor sees the unlisted world without naming it'
);
select pg_temp.fails($$
    update public.worlds
    set doc = jsonb_set(doc, '{meta,updatedAt}', '6'), rev = 4
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'an editor writes the document only through validate-world');
select pg_temp.fails($$
    update public.worlds set entity_clock = '{"e1": [999999999, "peer-b"]}'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, '...and cannot forge the clock directly');
select pg_temp.affects($$
    update public.worlds set title = 'Mine now' where id = '00000000-0000-4000-8000-0000000000a1'
$$, 0, 'an editor cannot rename the world');
select pg_temp.affects($$
    update public.worlds set visibility = 'private' where id = '00000000-0000-4000-8000-0000000000a1'
$$, 0, 'an editor cannot change visibility');
select pg_temp.fails($$
    update public.worlds set owner = 'b0b00000-0000-4000-8000-000000000002'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'an editor cannot take ownership');
select pg_temp.affects($$
    delete from public.worlds where id = '00000000-0000-4000-8000-0000000000a1'
$$, 0, 'an editor cannot delete the world');
select pg_temp.check(
    (select count(*) from public.world_editors) = 1,
    'a member sees only their own membership'
);
reset role;

select pg_temp.login('da7e0000-0000-4000-8000-000000000004', true);
set role authenticated;
select pg_temp.affects($$
    insert into public.world_editors (world_id, user_id, role, invite)
    values ('00000000-0000-4000-8000-0000000000a4', 'da7e0000-0000-4000-8000-000000000004',
            'viewer', '11111111-0000-4000-8000-000000000002')
$$, 1, 'dave redeems a viewer invite to the private world');
select pg_temp.check(
    exists (select 1 from public.worlds where id = '00000000-0000-4000-8000-0000000000a4'),
    'a viewer reads the private world'
);
select pg_temp.fails($$
    update public.worlds set rev = 9 where id = '00000000-0000-4000-8000-0000000000a4'
$$, 'a viewer cannot edit');
reset role;

select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.check(
    (select count(*) from public.world_editors) = 2,
    'the owner sees every member of their worlds'
);
select pg_temp.affects($$
    update public.worlds set title = 'Grove II', visibility = 'public'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 1, 'the owner renames and opens up their world');
select pg_temp.affects($$
    update public.worlds set title = 'Grove', visibility = 'unlisted'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 1, 'the owner puts it back');
select pg_temp.fails($$
    update public.worlds set owner = 'ca401000-0000-4000-8000-000000000003'
    where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'ownership never moves');
reset role;

do $$ begin raise notice '== snapshots and the thumbnail bucket =='; end $$;
select pg_temp.login('b0b00000-0000-4000-8000-000000000002', true);
set role authenticated;
select pg_temp.affects($$
    insert into public.world_snapshots (world_id, image_path)
    values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1/1.jpg')
$$, 1, 'an editor records a thumbnail');
select pg_temp.fails($$
    insert into public.world_snapshots (world_id, image_path)
    values ('00000000-0000-4000-8000-0000000000a1', 'elsewhere/1.jpg')
$$, 'a thumbnail lives under its world''s folder');
select pg_temp.affects($$
    insert into storage.objects (bucket_id, name)
    values ('world-thumbnails', '00000000-0000-4000-8000-0000000000a1/1.jpg')
$$, 1, 'an editor uploads into the world''s folder');
select pg_temp.fails($$
    insert into storage.objects (bucket_id, name)
    values ('world-thumbnails', '00000000-0000-4000-8000-0000000000a2/1.jpg')
$$, 'nobody uploads into a world they cannot edit');
select pg_temp.affects($$
    delete from storage.objects where bucket_id = 'world-thumbnails'
$$, 0, 'an editor cannot delete thumbnails');
select pg_temp.check(
    (select count(*) from storage.objects) = 0,
    'the thumbnail bucket cannot be listed'
);
reset role;

select pg_temp.login('ca401000-0000-4000-8000-000000000003', true);
set role authenticated;
select pg_temp.fails($$
    insert into public.world_snapshots (world_id, image_path)
    values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2/x.jpg')
$$, 'a stranger cannot add thumbnails');
select pg_temp.check(
    (select count(*) from public.world_snapshots) = 0,
    'an unlisted world''s thumbnails stay hidden from strangers'
);
select set_config('request.headers', '{"x-candy-world-id": "00000000-0000-4000-8000-0000000000a1"}', false);
select pg_temp.check(
    (select count(*) from public.world_snapshots) = 1,
    '...until they name the world'
);
select set_config('request.headers', '', false);
reset role;

select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.affects($$
    delete from storage.objects where bucket_id = 'world-thumbnails'
$$, 0, 'thumbnails are append-only, even for the owner');
select pg_temp.affects($$
    update storage.objects set name = '00000000-0000-4000-8000-0000000000a1/2.jpg'
$$, 0, '...and cannot be overwritten');
reset role;
select pg_temp.check(
    (select count(*) from storage.objects) = 1,
    'the upload is in the bucket'
);

do $$ begin raise notice '== realtime rooms =='; end $$;
insert into realtime.messages (topic, extension) values
    ('world:00000000-0000-4000-8000-0000000000a1', 'broadcast'),
    ('world:00000000-0000-4000-8000-0000000000a1:edit', 'broadcast'),
    ('world:00000000-0000-4000-8000-0000000000a1:owner', 'broadcast'),
    ('world:00000000-0000-4000-8000-0000000000a4', 'presence'),
    ('world:00000000-0000-4000-8000-0000000000a4:edit', 'broadcast'),
    ('candy:12345', 'broadcast');

create function pg_temp.can_receive(topic text) returns boolean
language plpgsql as $$
begin
    perform set_config('realtime.topic', topic, false);
    return exists (select 1 from realtime.messages m where m.topic = can_receive.topic);
end;
$$;

create function pg_temp.can_send(topic text, ext text) returns boolean
language plpgsql as $$
begin
    perform set_config('realtime.topic', topic, false);
    begin
        insert into realtime.messages (topic, extension) values (topic, ext);
    exception when insufficient_privilege then
        return false;
    end;
    return true;
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

select pg_temp.login('ca401000-0000-4000-8000-000000000003', true);
set role authenticated;
select pg_temp.check(pg_temp.can_receive('world:00000000-0000-4000-8000-0000000000a1'),
    'a stranger with the link joins an unlisted room');
select pg_temp.check(pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1', 'presence'),
    '...and shows up in it');
select pg_temp.check(pg_temp.can_receive('world:00000000-0000-4000-8000-0000000000a1:edit'),
    '...and watches the edits');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:edit', 'broadcast'),
    '...but cannot send edits');
select pg_temp.check(pg_temp.can_receive('world:00000000-0000-4000-8000-0000000000a1:owner'),
    '...hears the owner''s kicks');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:owner', 'broadcast'),
    '...and cannot forge one');
select pg_temp.check(not pg_temp.can_receive('world:00000000-0000-4000-8000-0000000000a4'),
    'a stranger cannot join a private room');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a4', 'presence'),
    '...or appear in it');
select pg_temp.check(not pg_temp.can_receive('candy:12345'),
    'the world policies grant nothing on other private topics');
select pg_temp.check(not pg_temp.can_receive('world:not-a-uuid'),
    'a malformed world topic grants nothing');
reset role;

select pg_temp.login('b0b00000-0000-4000-8000-000000000002', true);
set role authenticated;
select pg_temp.check(pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:edit', 'broadcast'),
    'an editor sends edits');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:owner', 'broadcast'),
    '...but cannot kick');
reset role;

select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.check(pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:owner', 'broadcast'),
    'the owner kicks');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a3:owner', 'broadcast'),
    '...only in their own worlds');
reset role;

select pg_temp.login('da7e0000-0000-4000-8000-000000000004', true);
set role authenticated;
select pg_temp.check(pg_temp.can_receive('world:00000000-0000-4000-8000-0000000000a4'),
    'a viewer joins the private room');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a4:edit', 'broadcast'),
    '...but cannot send edits');
reset role;

do $$ begin raise notice '== membership ends =='; end $$;
select pg_temp.login('b0b00000-0000-4000-8000-000000000002', true);
set role authenticated;
select pg_temp.affects($$
    delete from public.world_editors where user_id = 'b0b00000-0000-4000-8000-000000000002'
$$, 1, 'a member can leave');
select pg_temp.check(not pg_temp.can_send('world:00000000-0000-4000-8000-0000000000a1:edit', 'broadcast'),
    'a former editor cannot send edits');
select pg_temp.fails($$
    update public.worlds set rev = 10 where id = '00000000-0000-4000-8000-0000000000a1'
$$, 'a former editor cannot change the document');
reset role;

select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.affects($$
    delete from public.worlds where id = '00000000-0000-4000-8000-0000000000a4'
$$, 1, 'the owner deletes a world');
reset role;
select pg_temp.check(
    not exists (select 1 from public.world_editors
                where world_id = '00000000-0000-4000-8000-0000000000a4')
    and not exists (select 1 from public.world_invites
                    where world_id = '00000000-0000-4000-8000-0000000000a4'),
    'its members and invites go with it'
);

select pg_temp.login('a11ce000-0000-4000-8000-000000000001', false);
set role authenticated;
select pg_temp.affects($$
    delete from public.worlds where id = '00000000-0000-4000-8000-0000000000a2'
$$, 1, 'the owner deletes a world someone remixed');
reset role;
select pg_temp.check(
    (select remix_of from public.worlds where id = '00000000-0000-4000-8000-0000000000c1') is null,
    'the remix stays, no longer pointing back'
);

do $$ begin raise notice 'shared_worlds_rls: all checks passed'; end $$;

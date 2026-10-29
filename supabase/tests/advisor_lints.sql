-- Local stand-ins for the Supabase security and performance advisors
-- (https://supabase.com/docs/guides/database/database-advisors) that a schema
-- change can trip, run on the migrated scratch database by
-- scripts/check-supabase-rls.mjs. The hosted `get_advisors` remains the
-- authority; this catches regressions before a migration ships.
--
--   0013 rls_disabled_in_public          every public table has RLS on
--   0008 rls_enabled_no_policy           ...and at least one policy
--   0011 function_search_path_mutable    every function pins search_path
--   0028/0029 security definer function  none is callable from an exposed schema
--   0003 auth_rls_initplan               auth.*() / current_setting() in a
--                                        policy runs once per query, not per row
--   0006 multiple_permissive_policies    one permissive policy per table/role/action
--   0001 unindexed_foreign_keys          every foreign key has a covering index
--   0004 no_primary_key                  every public table has a primary key
--   0024 rls_policy_always_true          no write policy is a bare `true`

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create function pg_temp.lint(name text, offenders text[]) returns void
language plpgsql as $$
begin
    if coalesce(array_length(offenders, 1), 0) > 0 then
        raise exception 'FAIL: % — %', name, array_to_string(offenders, ', ');
    end if;
    raise notice 'ok - %', name;
end;
$$;

-- Schemas the migrations own (the platform's auth/storage/realtime are not ours).
create temp table owned_schemas (nspname text primary key);
insert into owned_schemas values ('public'), ('private');

select pg_temp.lint('0013 rls_disabled_in_public', array(
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
));

select pg_temp.lint('0008 rls_enabled_no_policy', array(
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
));

select pg_temp.lint('0011 function_search_path_mutable', array(
    select n.nspname || '.' || p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (select nspname from owned_schemas)
        and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
        )
));

select pg_temp.lint('0028/0029 security definer function in an exposed schema', array(
    select n.nspname || '.' || p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'graphql_public') and p.prosecdef
));

-- A call such as auth.uid() must appear as `( SELECT auth.uid() ...)`.
create function pg_temp.bare_calls(expr text) returns int
language sql immutable as $$
    select coalesce(
        (select count(*)::int from regexp_matches(expr, '(auth\.(uid|jwt|role)\(\)|current_setting\()', 'g'))
        - (select count(*)::int from regexp_matches(expr, 'SELECT (auth\.(uid|jwt|role)\(\)|current_setting\()', 'g')),
        0
    );
$$;

select pg_temp.lint('0003 auth_rls_initplan', array(
    select schemaname || '.' || tablename || ':' || policyname from pg_policies
    where (schemaname in (select nspname from owned_schemas)
           or policyname like 'world%')
        and pg_temp.bare_calls(coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0
));

select pg_temp.lint('0006 multiple_permissive_policies', array(
    select format('%s.%s %s/%s: %s', schemaname, tablename, role, action, string_agg(policyname, '+'))
    from (
        select p.schemaname, p.tablename, p.policyname, r.role,
            case when p.cmd = 'ALL' then a.action else p.cmd end as action
        from pg_policies p
        cross join lateral unnest(p.roles) as r(role)
        cross join lateral unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as a(action)
        where p.permissive = 'PERMISSIVE' and (p.cmd = 'ALL' or p.cmd = a.action)
    ) per_action
    group by schemaname, tablename, role, action
    having count(distinct policyname) > 1
));

select pg_temp.lint('0001 unindexed_foreign_keys', array(
    select format('%s.%s(%s)', n.nspname, c.relname, con.conname)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f' and n.nspname in (select nspname from owned_schemas)
        and not exists (
            select 1 from pg_index i
            where i.indrelid = con.conrelid
                and (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
        )
));

select pg_temp.lint('0004 no_primary_key', array(
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary)
));

select pg_temp.lint('0024 rls_policy_always_true', array(
    select schemaname || '.' || tablename || ':' || policyname from pg_policies
    where (schemaname in (select nspname from owned_schemas) or policyname like 'world%')
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        and (trim(coalesce(qual, '')) = 'true' or trim(coalesce(with_check, '')) = 'true')
));

do $$ begin raise notice 'advisor_lints: clean'; end $$;

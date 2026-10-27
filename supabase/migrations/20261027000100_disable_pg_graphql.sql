-- Candy World talks to Supabase through PostgREST, Realtime and Storage only;
-- nothing uses /graphql/v1. With pg_graphql installed, every table `anon` or
-- `authenticated` can SELECT is listed in GraphQL introspection (database
-- advisor lints 0026/0027), RLS or not. Dropping the extension is the
-- advisors' recommended fix for a project that does not use GraphQL.
-- To bring GraphQL back: `create extension pg_graphql;` and review 0026/0027.
drop extension if exists pg_graphql;

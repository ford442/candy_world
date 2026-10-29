#!/usr/bin/env node
/**
 * Apply every supabase/migrations/*.sql to a scratch database on a plain
 * Postgres (with supabase/tests/platform-stubs.sql standing in for the
 * platform's auth, storage and realtime schemas), then run the advisor-style
 * schema lints (supabase/tests/advisor_lints.sql) and the RLS checks
 * (supabase/tests/shared_worlds_rls.sql).
 *
 * Connection comes from the usual libpq variables (PGHOST, PGPORT, PGUSER,
 * PGPASSWORD); the user must be able to create databases. Without a reachable
 * server the check is skipped, unless CANDY_RLS_REQUIRED=1 (CI) makes that a
 * failure.
 *
 * Run: npm run test:supabase-rls
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'supabase-rls';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = process.env.CANDY_RLS_REQUIRED === '1';
const database = `candy_rls_${process.pid}`;

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function psql(db, args) {
    return run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args]);
}

function skipOrFail(reason) {
    if (required) {
        console.error(`❌ [${TAG}] ${reason}`);
        process.exit(1);
    }
    console.log(`⏭️  [${TAG}] skipped: ${reason} (set CANDY_RLS_REQUIRED=1 to require it)`);
    process.exit(0);
}

const probe = psql('postgres', ['-tAc', 'select 1']);
if (probe.error) skipOrFail('psql is not installed');
if (probe.status !== 0) skipOrFail(`no Postgres reachable (${probe.stderr.trim()})`);

const migrations = fs
    .readdirSync(path.join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(root, 'supabase/migrations', f));

const steps = [
    path.join(root, 'supabase/tests/platform-stubs.sql'),
    ...migrations,
    path.join(root, 'supabase/tests/advisor_lints.sql'),
    path.join(root, 'supabase/tests/shared_worlds_rls.sql'),
];

let failed = false;
const created = psql('postgres', ['-qc', `create database ${database}`]);
if (created.status !== 0) skipOrFail(`cannot create a database (${created.stderr.trim()})`);

try {
    for (const file of steps) {
        const res = psql(database, ['-q', '-f', file]);
        const rel = path.relative(root, file);
        const notices = res.stderr
            .split('\n')
            .filter((l) => l.startsWith('psql:') && l.includes('NOTICE:'))
            .map((l) => l.replace(/^.*NOTICE:\s*/, ''));
        for (const n of notices) console.log(`   ${n}`);
        if (res.stdout.trim()) console.log(res.stdout.trim());
        if (res.status !== 0) {
            const errors = res.stderr
                .split('\n')
                .filter((l) => !l.includes('NOTICE:') && l.trim())
                .join('\n');
            console.error(`❌ [${TAG}] ${rel} failed:\n${errors}`);
            failed = true;
            break;
        }
        console.log(`✅ [${TAG}] ${rel}`);
    }
} finally {
    psql('postgres', ['-qc', `drop database if exists ${database}`]);
}

process.exit(failed ? 1 : 0);

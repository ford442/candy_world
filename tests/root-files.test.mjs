import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkRootEntries, rootEntries } from '../scripts/check-root-files.mjs';

const allow = {
    files: { 'package.json': 'manifest', 'README.md': 'overview' },
    dirs: { src: 'source', docs: 'documentation' },
};

// Files and first path segments are what count; nested paths never name a root file.
assert.deepEqual(rootEntries(['package.json', 'src/a.ts', 'src/b/c.ts', 'docs/x.md', '']), {
    files: ['package.json'],
    dirs: ['docs', 'src'],
});

// Exact match passes.
let r = checkRootEntries({
    tracked: ['package.json', 'README.md', 'src/a.ts', 'docs/x.md'],
    allow,
});
assert.deepEqual(r, { unlisted: [], stale: [] });

// A new root file (the update_js.py case) is reported.
r = checkRootEntries({
    tracked: ['package.json', 'README.md', 'src/a.ts', 'docs/x.md', 'update_js.py'],
    allow,
});
assert.deepEqual(r.unlisted, ['file  update_js.py']);
assert.deepEqual(r.stale, []);

// A new top-level directory is reported too.
r = checkRootEntries({
    tracked: ['package.json', 'README.md', 'src/a.ts', 'docs/x.md', 'scratch/a.txt'],
    allow,
});
assert.deepEqual(r.unlisted, ['dir   scratch/']);

// A file where the allowlist says directory (and vice versa) is both unlisted and stale.
r = checkRootEntries({ tracked: ['package.json', 'README.md', 'src', 'docs/x.md'], allow });
assert.deepEqual(r.unlisted, ['file  src']);
assert.deepEqual(r.stale, ['dir   src/']);

// An allowlist entry that is no longer tracked fails, so the list stays exact.
r = checkRootEntries({ tracked: ['package.json', 'src/a.ts', 'docs/x.md'], allow });
assert.deepEqual(r.stale, ['file  README.md']);

// The committed allowlist must be valid JSON with a reason on every entry.
const committed = JSON.parse(
    readFileSync(new URL('../scripts/root-files-allowlist.json', import.meta.url), 'utf8')
);
for (const group of ['files', 'dirs']) {
    for (const [name, reason] of Object.entries(committed[group])) {
        assert.ok(
            typeof reason === 'string' && reason.trim().length > 0,
            `${group}/${name} needs a reason`
        );
    }
}

// The CLI agrees with the library on the real tree.
const out = execFileSync(
    'node',
    [new URL('../scripts/check-root-files.mjs', import.meta.url).pathname],
    {
        encoding: 'utf8',
    }
);
assert.match(out, /root-files: \d+ files and \d+ directories, all on the allowlist/);

console.log('root-files tests passed');

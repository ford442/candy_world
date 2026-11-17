/**
 * scripts/any-ratchet.mjs (#2166): what counts as an `any`, and the per-directory
 * comparison the gate makes.
 *
 * Run: npm run test:any-ratchet
 */
import assert from 'node:assert/strict';
import { compare, countAny } from '../scripts/any-ratchet.mjs';

let passed = 0;
const test = (name, fn) => {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
};

console.log('any-ratchet');

test('every syntactic any counts once', () => {
    const src = [
        'let a: any;',
        'const b = x as any;',
        'function f(...args: any[]): Record<string, any> { return {}; }',
        'const c = <any>y;',
        'type T = Map<string, Array<any>>;',
    ].join('\n');
    assert.equal(countAny(src), 6);
});

test('comments, strings, identifiers and unknown do not count', () => {
    const src = [
        '// any any any',
        '/* : any */',
        "const s = 'as any';",
        'const anything = 1; let many: unknown;',
        'const t = `${"any"}`;',
    ].join('\n');
    assert.equal(countAny(src), 0);
});

test('tsx parses as tsx', () => {
    assert.equal(countAny('const el = <div>{(x as any).y}</div>;', 'x.tsx'), 1);
});

test('compare: up and down per directory; a new directory counts from 0', () => {
    const { up, down } = compare(
        { 'src/a': 3, 'src/b': 1, 'src/new': 2 },
        { 'src/a': 3, 'src/b': 4, 'src/gone': 1 }
    );
    assert.deepEqual(up, [{ dir: 'src/new', was: 0, now: 2 }]);
    assert.deepEqual(down, [
        { dir: 'src/b', was: 4, now: 1 },
        { dir: 'src/gone', was: 1, now: 0 },
    ]);
});

console.log(`\n✅ ${passed} any-ratchet tests passed`);

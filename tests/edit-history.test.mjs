import { editHistory } from '../src/systems/edit-history.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ PASS: ${message}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${message}`);
        failed++;
/**
 * EditHistory stack semantics: execute/undo/redo, depth cap, and the
 * drop-on-throw rule for commands that fail mid-history.
 *
 * Run: npx tsx tests/edit-history.test.mjs
 */

import assert from 'node:assert/strict';
import { EditHistory } from '../src/systems/edit-history.ts';

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err && err.stack ? err.stack : err}`);
    }
}

/** Swallow console.warn for the duration of fn (failure paths log by design). */
function quiet(fn) {
    const original = console.warn;
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.warn = original;
    }
}

class CounterCommand {
    constructor(state) {
        this.state = state;
    }
    apply() {
        this.state.value++;
    }
    revert() {
        this.state.value--;
    }
    serialize() {
        return null;
    }
}

console.log('Testing EditHistory...');

const state = { value: 0 };
const cmd1 = new CounterCommand(state);
const cmd2 = new CounterCommand(state);

// Initial apply is not handled by push automatically in standard Command pattern,
// usually you apply then push. Or the command wraps both.
cmd1.apply();
editHistory.push(cmd1);
assert(state.value === 1, 'Value is 1 after first apply');

cmd2.apply();
editHistory.push(cmd2);
assert(state.value === 2, 'Value is 2 after second apply');

editHistory.undo();
assert(state.value === 1, 'Value is 1 after undo');

editHistory.undo();
assert(state.value === 0, 'Value is 0 after second undo');

editHistory.undo(); // no-op
assert(state.value === 0, 'Value is 0 after empty undo');

editHistory.redo();
assert(state.value === 1, 'Value is 1 after redo');

// Push clears redo
const cmd3 = new CounterCommand(state);
cmd3.apply();
editHistory.push(cmd3);
assert(state.value === 2, 'Value is 2 after new push');
assert(editHistory.redoCount === 0, 'Redo stack cleared on push');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
    constructor(state, { failApply = false, failRevert = false } = {}) {
        this.state = state;
        this.failApply = failApply;
        this.failRevert = failRevert;
    }
    apply() {
        if (this.failApply) throw new Error('apply failed');
        this.state.value++;
    }
    revert() {
        if (this.failRevert) throw new Error('revert failed');
        this.state.value--;
    }
    serialize() {
        return { type: 'counter' };
    }
}

test('execute applies and records; undo/redo walk the stack', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    assert.equal(h.execute(new CounterCommand(state)), true);
    assert.equal(h.execute(new CounterCommand(state)), true);
    assert.equal(state.value, 2);

    assert.equal(h.undo(), true);
    assert.equal(h.undo(), true);
    assert.equal(state.value, 0);
    assert.equal(h.undo(), false, 'undo on an empty stack is a no-op');
    assert.equal(state.value, 0);

    assert.equal(h.redo(), true);
    assert.equal(state.value, 1);
    assert.deepEqual([h.undoCount, h.redoCount], [1, 1]);
});

test('a new edit clears redo', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    h.execute(new CounterCommand(state));
    h.undo();
    h.execute(new CounterCommand(state));
    assert.equal(h.redoCount, 0);
    assert.equal(h.redo(), false);
});

test('push records an already-applied command without re-applying it', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    const cmd = new CounterCommand(state);
    cmd.apply();
    h.push(cmd);
    assert.equal(state.value, 1);
    h.undo();
    assert.equal(state.value, 0);
});

test('a command that fails to apply is not recorded', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    const ok = quiet(() => h.execute(new CounterCommand(state, { failApply: true })));
    assert.equal(ok, false);
    assert.equal(h.undoCount, 0);
    assert.equal(state.value, 0);
});

test('a command that fails to revert is dropped and does not block earlier steps', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    h.execute(new CounterCommand(state));
    h.execute(new CounterCommand(state, { failRevert: true }));

    assert.equal(
        quiet(() => h.undo()),
        false
    );
    assert.deepEqual([h.undoCount, h.redoCount], [1, 0], 'failed step leaves both stacks');
    assert.equal(h.undo(), true, 'the earlier step is still undoable');
    assert.equal(state.value, 1, 'only the revertible step was reverted');
});

test('a command that fails to re-apply is dropped from redo', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    const cmd = new CounterCommand(state);
    h.execute(cmd);
    h.undo();
    cmd.failApply = true;
    assert.equal(
        quiet(() => h.redo()),
        false
    );
    assert.deepEqual([h.undoCount, h.redoCount], [0, 0]);
});

test('depth cap discards the oldest step', () => {
    const h = new EditHistory(3);
    const state = { value: 0 };
    for (let i = 0; i < 5; i++) h.execute(new CounterCommand(state));
    assert.equal(h.undoCount, 3);
    while (h.undo());
    assert.equal(state.value, 2, 'the two oldest steps are no longer undoable');
});

test('clear empties both stacks', () => {
    const h = new EditHistory();
    const state = { value: 0 };
    h.execute(new CounterCommand(state));
    h.execute(new CounterCommand(state));
    h.undo();
    h.clear();
    assert.deepEqual([h.undoCount, h.redoCount], [0, 0]);
});

if (failures > 0) {
    console.error(`\n${failures} edit-history test(s) failed`);
    process.exit(1);
}
console.log('\nAll edit-history tests passed');

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

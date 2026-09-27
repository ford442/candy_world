import assert from 'node:assert';
import { test } from 'node:test';
import { EditHistory, WorldCommand } from '../src/systems/edit-history.ts';

const dummySnapshot = {
    schemaVersion: 2,
    id: 'test_123',
    entity: {
        type: 'mushroom',
        position: [0, 0, 0],
        rotation: { quat: [0, 0, 0, 1] },
        scale: 1,
        placement: 'absolute'
    },
    tags: []
};

test('EditHistory push, undo, redo, serialize', () => {
    const history = new EditHistory();
    const command = {
        id: 'test_123',
        action: 'add',
        snapshot: dummySnapshot,
        apply: () => null,
        revert: () => true
    };

    assert.strictEqual(history.canUndo(), false);
    assert.strictEqual(history.canRedo(), false);

    history.push(command);

    assert.strictEqual(history.canUndo(), true);
    assert.strictEqual(history.canRedo(), false);

    const serialized = history.serialize();
    assert.strictEqual(serialized.length, 1);
    assert.strictEqual(serialized[0].action, 'add');

    const undone = history.undo();
    assert.strictEqual(undone?.action, 'add');
    assert.strictEqual(history.canUndo(), false);
    assert.strictEqual(history.canRedo(), true);

    const redone = history.redo();
    assert.strictEqual(redone?.action, 'add');
    assert.strictEqual(history.canUndo(), true);
    assert.strictEqual(history.canRedo(), false);
});

test('WorldCommand execute, undo, redo', () => {
    const worldCommand = new WorldCommand();

    let appliedCount = 0;
    let revertedCount = 0;

    const command = {
        id: 'test_123',
        action: 'add',
        snapshot: dummySnapshot,
        apply: () => { appliedCount++; return null; },
        revert: () => { revertedCount++; return true; }
    };

    worldCommand.execute(command);

    const undone = worldCommand.undo();
    assert.strictEqual(undone?.action, 'add');
    assert.strictEqual(revertedCount, 1);
    assert.strictEqual(appliedCount, 0);

    const redone = worldCommand.redo();
    assert.strictEqual(redone?.action, 'add');
    assert.strictEqual(revertedCount, 1);
    assert.strictEqual(appliedCount, 1);
});

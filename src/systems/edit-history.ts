import type { EntitySnapshot } from './entity-snapshot.ts';

export type EditAction = 'add' | 'remove' | 'update';

export interface EditCommand {
    id: string;
    action: EditAction;
    snapshot?: EntitySnapshot;
    previousSnapshot?: EntitySnapshot;
    apply(): import('three').Object3D | null;
    revert(): boolean;
}

export class EditHistory {
    private undoStack: EditCommand[] = [];
    private redoStack: EditCommand[] = [];

    push(command: EditCommand) {
        this.undoStack.push(command);
        if (this.undoStack.length > 10) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo(): EditCommand | null {
        if (this.undoStack.length === 0) return null;
        const command = this.undoStack.pop()!;
        this.redoStack.push(command);
        return command;
    }

    redo(): EditCommand | null {
        if (this.redoStack.length === 0) return null;
        const command = this.redoStack.pop()!;
        this.undoStack.push(command);
        return command;
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    serialize(): Pick<EditCommand, 'id'|'action'|'snapshot'|'previousSnapshot'>[] {
        return this.undoStack.map(cmd => ({
            id: cmd.id,
            action: cmd.action,
            snapshot: cmd.snapshot,
            previousSnapshot: cmd.previousSnapshot
        }));
    }
}

export class WorldCommand {
    private history: EditHistory;

    constructor() {
        this.history = new EditHistory();
    }

    execute(command: EditCommand) {
        this.history.push(command);
    }

    undo(): EditCommand | null {
        const cmd = this.history.undo();
        if (cmd) {
            cmd.revert();
        }
        return cmd;
    }

    redo(): EditCommand | null {
        const cmd = this.history.redo();
        if (cmd) {
            cmd.apply();
        }
        return cmd;
    }

    getHistory(): EditHistory {
        return this.history;
    }
}

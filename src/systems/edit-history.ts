import { type EntitySnapshot } from './entity-snapshot-core.ts';

export interface WorldCommand {
    apply(): void;
    revert(): void;
    serialize(): any;
}

export class EditHistory {
    private undoStack: WorldCommand[] = [];
    private redoStack: WorldCommand[] = [];
    private readonly maxDepth: number;

    constructor(maxDepth: number = 100) {
        this.maxDepth = maxDepth;
    }

    push(command: WorldCommand): void {
        this.undoStack.push(command);
        if (this.undoStack.length > this.maxDepth) {
            this.undoStack.shift();
        }
        this.redoStack.length = 0; // Clear redo on new push
    }

    undo(): void {
        const cmd = this.undoStack.pop();
        if (!cmd) return;
        cmd.revert();
        this.redoStack.push(cmd);
    }

    redo(): void {
        const cmd = this.redoStack.pop();
        if (!cmd) return;
        cmd.apply();
        this.undoStack.push(cmd);
    }

    get undoCount(): number {
        return this.undoStack.length;
    }

    get redoCount(): number {
        return this.redoStack.length;
    }
}

export const editHistory = new EditHistory();

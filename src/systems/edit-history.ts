import { type EntitySnapshot } from './entity-snapshot-core.ts';


/**
 * @file src/systems/edit-history.ts
 * @brief Undo/redo stack of world edits.
 *
 * Every player-facing world edit (place, delete, transform, property change)
 * is a WorldCommand. Commands are issued from UI/input handlers, never from
 * the render loop.
 */

/** JSON form of a command; `type` names the command class for deserialization. */
export interface SerializedWorldCommand {
    type: string;
    [key: string]: unknown;
}

export interface WorldCommand {
    /** Perform (or re-perform, on redo) the edit. Throw if it cannot be applied. */
    apply(): void;
    /** Undo the edit. Throw if it cannot be reverted. */
    revert(): void;
    serialize(): SerializedWorldCommand;
}

export class EditHistory {
    private undoStack: WorldCommand[] = [];
    private redoStack: WorldCommand[] = [];
    private readonly maxDepth: number;

    constructor(maxDepth: number = 100) {
        this.maxDepth = maxDepth;
    }

    /**
     * Apply a command and record it. Returns false (and records nothing) if
     * apply throws, so a failed edit never becomes an undo step.
     */
    execute(command: WorldCommand): boolean {
        try {
            command.apply();
        } catch (err) {
            console.warn('[EditHistory] Command failed to apply:', err);
            return false;
        }
        this.push(command);
        return true;
    }

    /** Record a command whose effect is already live. Prefer execute(). */
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


    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }

    get undoCount(): number {
        return this.undoStack.length;
    }

    get redoCount(): number {
        return this.redoStack.length;
    }
}

export const editHistory = new EditHistory();

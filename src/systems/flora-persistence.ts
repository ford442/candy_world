import type { AwakenedFloraState } from './save-system/save-types.ts';

/**
 * Manages the persistent awakened state of flora across the world.
 * Interacts with the SaveSystem to load and store interactions.
 */
export class FloraPersistenceManager {
    private readonly states = new Map<string, AwakenedFloraState>();
    private readonly isHeadless: boolean;

    constructor() {
        this.isHeadless = typeof window === 'undefined' ||
            (typeof process !== 'undefined' && process.env?.CI === 'true') ||
            (typeof navigator !== 'undefined' && navigator.userAgent.includes('Headless'));
    }

    /**
     * Record an interaction with a specific flora by its unique ID.
     */
    recordInteraction(id: string): void {
        if (this.isHeadless) return;

        let state = this.states.get(id);
        if (!state) {
            state = {
                id,
                awakened: false,
                interactionCount: 0,
                lastAwakenedTimestamp: 0,
            };
            this.states.set(id, state);
        }

        state.awakened = true;
        state.interactionCount += 1;
        state.lastAwakenedTimestamp = Date.now();
    }

    /**
     * Check the current state of a specific flora.
     */
    getStateFor(id: string): AwakenedFloraState | undefined {
        if (this.isHeadless) return undefined;
        return this.states.get(id);
    }

    /**
     * Get the total number of unique flora awakened so far.
     */
    getTotalAwakenedCount(): number {
        if (this.isHeadless) return 0;
        let count = 0;
        for (const state of this.states.values()) {
            if (state.awakened) count++;
        }
        return count;
    }

    /**
     * Serialize the entire map for saving.
     */
    serialize(): AwakenedFloraState[] {
        if (this.isHeadless) return [];
        return Array.from(this.states.values());
    }

    /**
     * Restore the map from saved data.
     */
    deserialize(data: AwakenedFloraState[]): void {
        if (this.isHeadless) return;
        this.states.clear();
        for (const item of data) {
            this.states.set(item.id, { ...item });
        }
        console.log(`[FloraPersistenceManager] Restored ${this.states.size} awakened flora states.`);
    }

    /**
     * Reset all internal state (e.g. for new game).
     */
    reset(): void {
        this.states.clear();
    }
}

export const floraPersistenceManager = new FloraPersistenceManager();

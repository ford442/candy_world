// src/systems/unlocks.ts

// @ts-ignore
import { showToast } from '../utils/toast.js';

export interface UnlockRequirement {
    itemId: string;
    count: number;
}

export interface UnlockDefinition {
    id: string;
    name: string;
    description: string;
    requirements: UnlockRequirement[];
    icon: string;
}

export const UNLOCK_DEFINITIONS: Record<string, UnlockDefinition> = {
    'arpeggio_shield': {
        id: 'arpeggio_shield',
        name: 'Arpeggio Shield',
        description: 'A crystalline barrier powered by harmonic resonance.',
        requirements: [{ itemId: 'fern_core', count: 3 }],
        icon: '🛡️'
    },
    'jitter_mines': {
        id: 'jitter_mines',
        name: 'Jitter Mines',
        description: 'Proximity mines crafted from unstable vibrato nectar.',
        requirements: [{ itemId: 'vibrato_nectar', count: 5 }],
        icon: '💣'
    }
};

class UnlockSystem {
    private inventory: Record<string, number>;
    private unlocks: Set<string>;
    private storageKey: string;

    constructor() {
        this.inventory = {};
        this.unlocks = new Set();
        this.storageKey = 'candy_world_unlocks';
        this.load();
    }

    private load(): void {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                this.inventory = parsed.inventory || {};
                if (Array.isArray(parsed.unlocks)) {
                    parsed.unlocks.forEach((u: string) => this.unlocks.add(u));
                }
            }
        } catch (e) {
            console.warn('UnlockSystem: Failed to load', e);
        }
    }

    private save(): void {
        try {
            const data = {
                inventory: this.inventory,
                unlocks: Array.from(this.unlocks)
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('UnlockSystem: Failed to save', e);
        }
    }

    /**
     * Harvest an item from the world.
     * @param itemId The ID of the item (e.g., 'fern_core')
     * @param amount Amount to add
     * @param displayName Display name for the toast
     */
    public harvest(itemId: string, amount: number = 1, displayName: string = 'Item'): void {
        if (!this.inventory[itemId]) {
            this.inventory[itemId] = 0;
        }
        this.inventory[itemId] += amount;

        showToast(`Harvested: ${displayName} (${this.inventory[itemId]})`, '🎒', 3000);
        console.log(`[UnlockSystem] Harvested ${amount}x ${itemId}. Total: ${this.inventory[itemId]}`);

        this.checkUnlocks();
        this.save();
    }

    /**
     * Check if any new abilities should be unlocked based on current inventory.
     */
    public checkUnlocks(): void {
        for (const key in UNLOCK_DEFINITIONS) {
            if (this.unlocks.has(key)) continue;

            const def = UNLOCK_DEFINITIONS[key];
            let conditionsMet = true;

            for (const req of def.requirements) {
                const current = this.inventory[req.itemId] || 0;
                if (current < req.count) {
                    conditionsMet = false;
                    break;
                }
            }

            if (conditionsMet) {
                this.unlock(def);
            }
        }
    }

    private unlock(def: UnlockDefinition): void {
        this.unlocks.add(def.id);
        showToast(`UNLOCKED: ${def.name}!`, def.icon, 8000);
        console.log(`[UnlockSystem] Unlocked ${def.name} (${def.id})`);

        // Trigger specific game logic if needed (e.g. enable shield)
        // For now, we just track the state.
    }

    public isUnlocked(unlockId: string): boolean {
        return this.unlocks.has(unlockId);
    }

    public getItemCount(itemId: string): number {
        return this.inventory[itemId] || 0;
    }

    public reset(): void {
        this.inventory = {};
        this.unlocks.clear();
        this.save();
        console.log('[UnlockSystem] Reset complete.');
    }
}

export const unlockSystem = new UnlockSystem();

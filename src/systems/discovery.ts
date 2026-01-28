// src/systems/discovery.ts

// @ts-ignore
import { showToast } from '../utils/toast.js';

/**
 * Manages the discovery of rare flora and environmental features.
 * Tracks discovered items in localStorage (optional) and triggers UI notifications.
 */
class DiscoverySystem {
    private discoveredItems: Set<string>;
    private storageKey: string;

    constructor() {
        this.discoveredItems = new Set<string>();
        this.storageKey = 'candy_world_discovery';
        this.loadDiscovery();
    }

    /**
     * Load discovered items from local storage.
     */
    private loadDiscovery(): void {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const items = JSON.parse(data);
                if (Array.isArray(items)) {
                    items.forEach((item: string) => this.discoveredItems.add(item));
                }
            }
        } catch (e) {
            console.warn('DiscoverySystem: Failed to load from localStorage', e);
        }
    }

    /**
     * Save discovered items to local storage.
     */
    private saveDiscovery(): void {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.discoveredItems)));
        } catch (e) {
            console.warn('DiscoverySystem: Failed to save to localStorage', e);
        }
    }

    /**
     * Register a discovery.
     * @param {string} id - Unique identifier for the discovered item (e.g., 'tremolo_tulip').
     * @param {string} displayName - Human-readable name (e.g., 'Tremolo Tulip').
     * @param {string} icon - Emoji or icon to display.
     * @returns {boolean} - True if this is a new discovery.
     */
    public discover(id: string, displayName: string, icon: string = '🌿'): boolean {
        if (!id) return false;

        if (!this.discoveredItems.has(id)) {
            this.discoveredItems.add(id);
            this.saveDiscovery();

            showToast(`New Discovery: ${displayName}!`, icon, 5000);
            console.log(`[Discovery] Discovered: ${displayName} (${id})`);
            return true;
        }
        return false;
    }

    /**
     * Check if an item has been discovered.
     * @param {string} id
     * @returns {boolean}
     */
    public isDiscovered(id: string): boolean {
        return this.discoveredItems.has(id);
    }

    /**
     * Reset discovery progress (for debug).
     */
    public reset(): void {
        this.discoveredItems.clear();
        this.saveDiscovery();
        console.log('[Discovery] Progress reset.');
    }
}

// Export a singleton instance
export const discoverySystem = new DiscoverySystem();

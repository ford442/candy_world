// src/systems/discovery.ts

import { showToast } from '../utils/toast.js';
import { DISCOVERY_MAP } from './discovery_map.ts';
import { discoveryPersistence } from './discovery-persistence.ts';
import { trapFocusInside } from '../utils/interaction-utils.ts';

/**
 * Manages the discovery of rare flora and environmental features.
 * Tracks discovered items in localStorage (via persistence layer) and triggers UI notifications.
 * 
 * @deprecated Consider using OptimizedDiscoverySystem for new code
 */
class DiscoverySystem {
    private discoveredItems: Set<string>;

    constructor() {
        this.discoveredItems = new Set<string>();
        this.loadDiscovery();
    }

    /**
     * Load discovered items from persistence layer.
     */
    private loadDiscovery(): void {
        try {
            const persisted = discoveryPersistence.getAllDiscoveries();
            persisted.forEach(d => this.discoveredItems.add(d.id));
            
            if (persisted.length > 0) {
                console.log(`[DiscoverySystem] Loaded ${persisted.length} discoveries from persistence`);
            }
        } catch (e) {
            console.warn('DiscoverySystem: Failed to load from persistence', e);
        }
    }

    /**
     * Save discovered item to persistence layer.
     * @param id - Discovery ID
     * @param displayName - Display name for metadata
     * @param icon - Icon for metadata
     */
    private saveDiscovery(id: string, displayName: string, icon: string): void {
        try {
            discoveryPersistence.addDiscovery(id, displayName, icon);
        } catch (e) {
            console.warn('DiscoverySystem: Failed to save to persistence', e);
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
            this.saveDiscovery(id, displayName, icon);

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
        discoveryPersistence.clear();
        console.log('[Discovery] Progress reset.');
    }

    /**
     * Show a visual Discovery Log UI.
     */
    public showLog(): void {
        // Remove existing if any
        let existingLog = document.getElementById('discovery-log-overlay');
        if (existingLog) {
            existingLog.remove();
            return; // Toggle behavior
        }

        const overlay = document.createElement('div');
        overlay.id = 'discovery-log-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '10000';
        overlay.style.backdropFilter = 'blur(5px)';

        const logContainer = document.createElement('div');
        logContainer.style.backgroundColor = '#2c2c3e';
        logContainer.style.color = 'white';
        logContainer.style.padding = '30px';
        logContainer.style.borderRadius = '15px';
        logContainer.style.width = '80%';
        logContainer.style.maxWidth = '600px';
        logContainer.style.maxHeight = '80vh';
        logContainer.style.overflowY = 'auto';
        logContainer.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
        logContainer.style.position = 'relative';

        const title = document.createElement('h2');
        title.innerText = 'Discovery Log 🌿';
        title.style.marginTop = '0';
        title.style.borderBottom = '2px solid #ff69b4';
        title.style.paddingBottom = '10px';
        title.style.textAlign = 'center';
        logContainer.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕';
        closeBtn.setAttribute('aria-label', 'Close discovery log');
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '15px';
        closeBtn.style.right = '20px';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'white';
        closeBtn.style.fontSize = '24px';
        closeBtn.style.cursor = 'pointer';

        let releaseFocusTrap: (() => void) | null = null;

        closeBtn.onclick = () => {
            if (releaseFocusTrap) {
                releaseFocusTrap();
                releaseFocusTrap = null;
            }
            overlay.remove();
        };
        logContainer.appendChild(closeBtn);

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(250px, 1fr))';
        grid.style.gap = '15px';
        grid.style.marginTop = '20px';

        let count = 0;
        for (const [id, info] of Object.entries(DISCOVERY_MAP)) {
            const itemDiv = document.createElement('div');
            itemDiv.style.padding = '10px';
            itemDiv.style.borderRadius = '10px';
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.gap = '15px';
            itemDiv.style.backgroundColor = '#3c3c5e';

            if (this.discoveredItems.has(id)) {
                itemDiv.innerHTML = `<span style="font-size: 24px;">${info.icon}</span> <span>${info.name}</span>`;
                count++;
            } else {
                itemDiv.style.opacity = '0.4';
                itemDiv.innerHTML = `<span style="font-size: 24px;">❓</span> <span>Unknown Flora</span>`;
            }
            grid.appendChild(itemDiv);
        }

        const subtitle = document.createElement('p');
        subtitle.innerText = `Found ${count} of ${Object.keys(DISCOVERY_MAP).length} rare species`;
        subtitle.style.textAlign = 'center';
        subtitle.style.color = '#ff69b4';
        subtitle.style.fontWeight = 'bold';
        logContainer.appendChild(subtitle);

        logContainer.appendChild(grid);
        overlay.appendChild(logContainer);
        document.body.appendChild(overlay);

        // Trap focus inside the overlay
        releaseFocusTrap = trapFocusInside(overlay);

        // Focus close button for accessibility
        closeBtn.focus();
    }

    /**
     * Get all discovered item IDs.
     * @returns {string[]} Array of discovered item IDs
     */
    public getDiscoveredIds(): string[] {
        return Array.from(this.discoveredItems);
    }

    /**
     * Get count of discovered items.
     * @returns {number} Number of discovered items
     */
    public getDiscoveredCount(): number {
        return this.discoveredItems.size;
    }
}

// Export a singleton instance
export const discoverySystem = new DiscoverySystem();

// Re-export persistence utilities for convenience
export { discoveryPersistence, exportDiscoveries, importDiscoveries, clearLocalDiscoveries } from './discovery-persistence.ts';

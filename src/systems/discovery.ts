// src/systems/discovery.ts

import { showToast } from '../utils/toast.js';
import { DISCOVERY_MAP } from './discovery_map.ts';

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
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '15px';
        closeBtn.style.right = '20px';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'white';
        closeBtn.style.fontSize = '24px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => {
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

        // Focus close button for accessibility
        closeBtn.focus();
    }
}

// Export a singleton instance
export const discoverySystem = new DiscoverySystem();

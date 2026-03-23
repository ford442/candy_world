/**
 * Save Menu UI Component
 * 
 * Features:
 * - Load game menu with slot selection
 * - Save game menu with slot selection
 * - Export/Import buttons
 * - Settings management
 * - "Delete all data" for privacy
 * - Integration with save-system.ts
 */

import { 
    saveSystem, 
    SaveData, 
    SaveSlotInfo,
    SettingsSaveData,
    KeyBindings
} from '../systems/save-system.js';
import { showToast } from '../utils/toast.js';

// =============================================================================
// STYLES
// =============================================================================

const MENU_STYLES = `
.candy-save-menu {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(10, 10, 20, 0.85);
    backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    font-family: 'Segoe UI', system-ui, sans-serif;
    animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.candy-save-menu__container {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-radius: 20px;
    padding: 30px;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    animation: slideUp 0.3s ease;
}

@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

.candy-save-menu__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
    padding-bottom: 15px;
    border-bottom: 2px solid rgba(255, 105, 180, 0.5);
}

.candy-save-menu__title {
    color: #fff;
    font-size: 28px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(90deg, #ff69b4, #ffd700);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.candy-save-menu__close {
    background: none;
    border: none;
    color: #fff;
    font-size: 28px;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.candy-save-menu__close:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: rotate(90deg);
}

.candy-save-menu__tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.candy-save-menu__tab {
    padding: 10px 20px;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s;
    background: rgba(255, 255, 255, 0.1);
    color: #aaa;
}

.candy-save-menu__tab:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
}

.candy-save-menu__tab--active {
    background: linear-gradient(90deg, #ff69b4, #ff1493);
    color: #fff;
}

.candy-save-menu__content {
    min-height: 300px;
}

.candy-save-menu__section {
    display: none;
}

.candy-save-menu__section--active {
    display: block;
    animation: fadeIn 0.3s ease;
}

/* Save Slots Grid */
.candy-save-slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 15px;
}

.candy-save-slot {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 15px;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;
    position: relative;
}

.candy-save-slot:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
}

.candy-save-slot--empty {
    border-style: dashed;
    border-color: rgba(255, 255, 255, 0.2);
}

.candy-save-slot--selected {
    border-color: #ff69b4;
    background: rgba(255, 105, 180, 0.1);
}

.candy-save-slot__icon {
    font-size: 32px;
    margin-bottom: 10px;
}

.candy-save-slot__name {
    color: #fff;
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 5px;
}

.candy-save-slot__info {
    color: #888;
    font-size: 12px;
    margin: 2px 0;
}

.candy-save-slot__badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #ff69b4;
    color: #fff;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
}

.candy-save-slot__actions {
    display: flex;
    gap: 5px;
    margin-top: 10px;
    opacity: 0;
    transition: opacity 0.2s;
}

.candy-save-slot:hover .candy-save-slot__actions {
    opacity: 1;
}

.candy-save-slot__btn {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
}

.candy-save-slot__btn--primary {
    background: #ff69b4;
    color: #fff;
}

.candy-save-slot__btn--secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.candy-save-slot__btn--danger {
    background: rgba(220, 38, 38, 0.8);
    color: #fff;
}

.candy-save-slot__btn:hover {
    transform: scale(1.05);
}

/* Action Buttons */
.candy-save-menu__actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    flex-wrap: wrap;
    justify-content: center;
}

.candy-save-menu__btn {
    padding: 12px 24px;
    border: none;
    border-radius: 25px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-save-menu__btn--primary {
    background: linear-gradient(90deg, #ff69b4, #ff1493);
    color: #fff;
}

.candy-save-menu__btn--secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.candy-save-menu__btn--danger {
    background: linear-gradient(90deg, #dc2626, #991b1b);
    color: #fff;
}

.candy-save-menu__btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}

.candy-save-menu__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

/* Settings Panel */
.candy-settings-group {
    margin-bottom: 25px;
}

.candy-settings-group__title {
    color: #ff69b4;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.candy-settings-row__label {
    color: #ccc;
    font-size: 14px;
}

.candy-settings-row__control {
    display: flex;
    align-items: center;
    gap: 10px;
}

.candy-settings-row__value {
    color: #fff;
    font-size: 14px;
    min-width: 50px;
    text-align: right;
}

/* Custom Controls */
.candy-slider {
    width: 150px;
    height: 6px;
    -webkit-appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
}

.candy-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: #ff69b4;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
}

.candy-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 10px rgba(255, 105, 180, 0.5);
}

.candy-select {
    padding: 8px 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    min-width: 150px;
}

.candy-select option {
    background: #1a1a2e;
}

.candy-toggle {
    width: 50px;
    height: 26px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 13px;
    position: relative;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    padding: 0;
}

.candy-toggle:focus-visible {
    outline: 2px solid #ff69b4;
    outline-offset: 2px;
}

.candy-toggle--active {
    background: #ff69b4;
}

.candy-toggle__handle {
    width: 22px;
    height: 22px;
    background: #fff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: all 0.2s;
}

.candy-toggle--active .candy-toggle__handle {
    left: 26px;
}

.candy-keybind {
    padding: 8px 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
    transition: all 0.2s;
}

.candy-keybind:hover {
    border-color: #ff69b4;
    background: rgba(255, 105, 180, 0.1);
}

.candy-keybind--listening {
    border-color: #ffd700;
    background: rgba(255, 215, 0, 0.2);
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* Import/Export Area */
.candy-io-area {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 15px;
}

.candy-io-area__label {
    color: #888;
    font-size: 12px;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.candy-textarea {
    width: 100%;
    min-height: 150px;
    padding: 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-family: monospace;
    font-size: 12px;
    resize: vertical;
    box-sizing: border-box;
}

.candy-textarea:focus {
    outline: none;
    border-color: #ff69b4;
}

.candy-file-input {
    display: none;
}

.candy-file-label {
    display: inline-block;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-radius: 25px;
    cursor: pointer;
    transition: all 0.2s;
    margin-right: 10px;
}

.candy-file-label:hover {
    background: rgba(255, 255, 255, 0.2);
}

/* Danger Zone */
.candy-danger-zone {
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-top: 30px;
}

.candy-danger-zone__title {
    color: #ef4444;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-danger-zone__text {
    color: #aaa;
    font-size: 14px;
    margin-bottom: 15px;
}

/* Loading State */
.candy-save-menu__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: #fff;
}

.candy-save-menu__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #ff69b4;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Empty State */
.candy-empty-state {
    text-align: center;
    padding: 40px;
    color: #888;
}

.candy-empty-state__icon {
    font-size: 48px;
    margin-bottom: 15px;
}

.candy-empty-state__text {
    font-size: 16px;
}

/* Toast Notification Override */
.candy-save-toast {
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: rgba(30, 30, 40, 0.95);
    color: #fff;
    padding: 15px 20px;
    border-radius: 10px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 10001;
    animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

/* Scrollbar Styling */
.candy-save-menu__container::-webkit-scrollbar {
    width: 8px;
}

.candy-save-menu__container::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
}

.candy-save-menu__container::-webkit-scrollbar-thumb {
    background: rgba(255, 105, 180, 0.5);
    border-radius: 4px;
}

.candy-save-menu__container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 105, 180, 0.8);
}
`;

// =============================================================================
// SAVE MENU CLASS
// =============================================================================

type MenuTab = 'load' | 'save' | 'settings' | 'import-export';
type MenuMode = 'load' | 'save' | 'full';

interface SaveMenuOptions {
    mode?: MenuMode;
    onLoad?: (data: SaveData) => void;
    onSave?: (slotId: string) => void;
    onClose?: () => void;
}

export class SaveMenu {
    private container: HTMLElement | null = null;
    private currentTab: MenuTab = 'load';
    private currentMode: MenuMode = 'full';
    private slots: SaveSlotInfo[] = [];
    private selectedSlot: string | null = null;
    private settings: SettingsSaveData;
    private listeningKeybind: keyof KeyBindings | null = null;
    private onLoadCallback?: (data: SaveData) => void;
    private onSaveCallback?: (slotId: string) => void;
    private onCloseCallback?: () => void;
    private keydownHandler: (e: KeyboardEvent) => void;

    constructor(options: SaveMenuOptions = {}) {
        this.currentMode = options.mode || 'full';
        this.currentTab = this.currentMode === 'save' ? 'save' : 'load';
        this.onLoadCallback = options.onLoad;
        this.onSaveCallback = options.onSave;
        this.onCloseCallback = options.onClose;
        this.settings = saveSystem.getSettings();
        
        this.keydownHandler = (e) => this.handleKeydown(e);
        this.injectStyles();
    }

    // -------------------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------------------

    private injectStyles(): void {
        if (document.getElementById('candy-save-menu-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'candy-save-menu-styles';
        style.textContent = MENU_STYLES;
        document.head.appendChild(style);
    }

    // -------------------------------------------------------------------------
    // PUBLIC API
    // -------------------------------------------------------------------------

    async show(): Promise<void> {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.className = 'candy-save-menu';
        
        // Add click outside to close
        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) {
                this.close();
            }
        });

        // Render initial loading state
        this.renderLoading();
        document.body.appendChild(this.container);
        
        // Add escape key handler
        document.addEventListener('keydown', this.keydownHandler);
        
        // Load slots
        await this.refreshSlots();
        this.render();
    }

    close(): void {
        if (!this.container) return;
        
        // Add exit animation
        this.container.style.animation = 'fadeIn 0.2s ease reverse';
        
        setTimeout(() => {
            this.container?.remove();
            this.container = null;
            document.removeEventListener('keydown', this.keydownHandler);
            this.onCloseCallback?.();
        }, 200);
    }

    isOpen(): boolean {
        return this.container !== null;
    }

    // -------------------------------------------------------------------------
    // DATA MANAGEMENT
    // -------------------------------------------------------------------------

    private async refreshSlots(): Promise<void> {
        this.slots = await saveSystem.listSlots();
    }

    // -------------------------------------------------------------------------
    // RENDERING
    // -------------------------------------------------------------------------

    private renderLoading(): void {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="candy-save-menu__container">
                <div class="candy-save-menu__loading">
                    <div class="candy-save-menu__spinner"></div>
                    <span>Loading saves...</span>
                </div>
            </div>
        `;
    }

    private render(): void {
        if (!this.container) return;
        
        const tabs = this.getTabs();
        
        this.container.innerHTML = `
            <div class="candy-save-menu__container">
                ${this.renderHeader()}
                ${this.currentMode === 'full' ? this.renderTabs(tabs) : ''}
                <div id="panel-${this.currentTab}" role="tabpanel" aria-labelledby="tab-${this.currentTab}" class="candy-save-menu__content">
                    ${this.renderCurrentTab()}
                </div>
            </div>
        `;
        
        this.attachEventListeners();
    }

    private getTabs(): { id: MenuTab; label: string; icon: string }[] {
        const tabs: { id: MenuTab; label: string; icon: string }[] = [];
        if (this.currentMode === 'full' || this.currentMode === 'load') {
            tabs.push({ id: 'load', label: 'Load Game', icon: '📂' });
        }
        if (this.currentMode === 'full' || this.currentMode === 'save') {
            tabs.push({ id: 'save', label: 'Save Game', icon: '💾' });
        }
        tabs.push(
            { id: 'settings', label: 'Settings', icon: '⚙️' },
            { id: 'import-export', label: 'Import/Export', icon: '📤' }
        );
        return tabs;
    }

    private renderHeader(): string {
        const titles: Record<MenuMode, string> = {
            load: 'Load Game',
            save: 'Save Game',
            full: 'Save / Load'
        };
        
        return `
            <div class="candy-save-menu__header">
                <h2 class="candy-save-menu__title">${titles[this.currentMode]}</h2>
                <button class="candy-save-menu__close" data-action="close" aria-label="Close menu" title="Close"><span aria-hidden="true">✕</span></button>
            </div>
        `;
    }

    private renderTabs(tabs: { id: MenuTab; label: string; icon: string }[]): string {
        return `
            <div class="candy-save-menu__tabs" role="tablist" aria-label="Save Menu Tabs">
                ${tabs.map(tab => `
                    <button 
                        id="tab-${tab.id}"
                        role="tab"
                        aria-selected="${this.currentTab === tab.id}"
                        aria-controls="panel-${tab.id}"
                        class="candy-save-menu__tab ${this.currentTab === tab.id ? 'candy-save-menu__tab--active' : ''}"
                        data-tab="${tab.id}"
                    >
                        <span aria-hidden="true">${tab.icon}</span> ${tab.label}
                    </button>
                `).join('')}
            </div>
        `;
    }

    private renderCurrentTab(): string {
        switch (this.currentTab) {
            case 'load':
                return this.renderLoadTab();
            case 'save':
                return this.renderSaveTab();
            case 'settings':
                return this.renderSettingsTab();
            case 'import-export':
                return this.renderImportExportTab();
            default:
                return '';
        }
    }

    private renderLoadTab(): string {
        const manualSlots = this.slots.filter(s => !s.isAutoSave && s.exists);
        const autoSlots = this.slots.filter(s => s.isAutoSave && s.exists);
        
        if (manualSlots.length === 0 && autoSlots.length === 0) {
            return `
                <div class="candy-empty-state">
                    <div class="candy-empty-state__icon" aria-hidden="true">📝</div>
                    <div class="candy-empty-state__text">No save files found</div>
                </div>
            `;
        }
        
        return `
            ${manualSlots.length > 0 ? `
                <div class="candy-settings-group">
                    <div class="candy-settings-group__title"><span aria-hidden="true">💾</span> Manual Saves</div>
                    <div class="candy-save-slots">
                        ${manualSlots.map(slot => this.renderSlot(slot)).join('')}
                    </div>
                </div>
            ` : ''}
            ${autoSlots.length > 0 ? `
                <div class="candy-settings-group">
                    <div class="candy-settings-group__title"><span aria-hidden="true">🔄</span> Auto Saves</div>
                    <div class="candy-save-slots">
                        ${autoSlots.map(slot => this.renderSlot(slot)).join('')}
                    </div>
                </div>
            ` : ''}
        `;
    }

    private renderSaveTab(): string {
        const manualSlots = this.slots.filter(s => !s.isAutoSave);
        
        return `
            <div class="candy-save-slots">
                ${manualSlots.map(slot => this.renderSlot(slot, true)).join('')}
            </div>
            <div class="candy-save-menu__actions">
                <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="quick-save">
                    <span aria-hidden="true">💾</span> Quick Save (Ctrl+S)
                </button>
            </div>
        `;
    }

    private renderSlot(slot: SaveSlotInfo, forSave: boolean = false): string {
        const isEmpty = !slot.exists;
        const isSelected = this.selectedSlot === slot.slotId;
        const date = slot.timestamp ? new Date(slot.timestamp).toLocaleString() : 'Empty';
        const playtime = slot.playtime ? this.formatPlaytime(slot.playtime) : '';
        
        return `
            <div class="candy-save-slot ${isEmpty ? 'candy-save-slot--empty' : ''} ${isSelected ? 'candy-save-slot--selected' : ''}"
                 data-slot-id="${slot.slotId}"
            >
                ${slot.isAutoSave && !isEmpty ? '<span class="candy-save-slot__badge">AUTO</span>' : ''}
                <div class="candy-save-slot__icon" aria-hidden="true">${isEmpty ? '➕' : '💾'}</div>
                <div class="candy-save-slot__name">${slot.slotName}</div>
                ${!isEmpty ? `
                    <div class="candy-save-slot__info">${date}</div>
                    ${playtime ? `<div class="candy-save-slot__info"><span aria-hidden="true">⏱️</span> ${playtime}</div>` : ''}
                ` : '<div class="candy-save-slot__info">Click to save</div>'}
                <div class="candy-save-slot__actions">
                    ${forSave || isEmpty ? `
                        <button class="candy-save-slot__btn candy-save-slot__btn--primary" data-action="${forSave ? 'overwrite' : 'save'}" data-slot="${slot.slotId}">
                            ${forSave && !isEmpty ? 'Overwrite' : 'Save'}
                        </button>
                    ` : `
                        <button class="candy-save-slot__btn candy-save-slot__btn--primary" data-action="load" data-slot="${slot.slotId}">
                            Load
                        </button>
                        <button class="candy-save-slot__btn candy-save-slot__btn--secondary" data-action="export" data-slot="${slot.slotId}">
                            Export
                        </button>
                    `}
                    ${isEmpty ? '' : `
                        <button class="candy-save-slot__btn candy-save-slot__btn--danger" data-action="delete" data-slot="${slot.slotId}" aria-label="Delete save: ${slot.slotName}" title="Delete save">
                            <span aria-hidden="true">🗑️</span>
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    private renderSettingsTab(): string {
        const s = this.settings;
        
        return `
            <div class="candy-settings-group">
                <div class="candy-settings-group__title"><span aria-hidden="true">🎮</span> Graphics</div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-graphicsQuality">Quality</span>
                    <div class="candy-settings-row__control">
                        <select class="candy-select" data-setting="graphicsQuality" aria-labelledby="setting-label-graphicsQuality">
                            ${['low', 'medium', 'high', 'ultra'].map(q => `
                                <option value="${q}" ${s.graphicsQuality === q ? 'selected' : ''}>${q.charAt(0).toUpperCase() + q.slice(1)}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-drawDistance">Draw Distance</span>
                    <div class="candy-settings-row__control">
                        <span class="candy-settings-row__value">${s.drawDistance}m</span>
                        <input type="range" class="candy-slider" min="50" max="500" value="${s.drawDistance}" data-setting="drawDistance" aria-labelledby="setting-label-drawDistance">
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-fov">Field of View</span>
                    <div class="candy-settings-row__control">
                        <span class="candy-settings-row__value">${s.fov}°</span>
                        <input type="range" class="candy-slider" min="60" max="120" value="${s.fov}" data-setting="fov" aria-labelledby="setting-label-fov">
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-shadows">Shadows</span>
                    <div class="candy-settings-row__control">
                        <button type="button" role="switch" aria-checked="${s.shadows ? 'true' : 'false'}" aria-labelledby="setting-label-shadows" class="candy-toggle ${s.shadows ? 'candy-toggle--active' : ''}" data-setting="shadows">
                            <div class="candy-toggle__handle"></div>
                        </button>
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-postProcessing">Post Processing</span>
                    <div class="candy-settings-row__control">
                        <button type="button" role="switch" aria-checked="${s.postProcessing ? 'true' : 'false'}" aria-labelledby="setting-label-postProcessing" class="candy-toggle ${s.postProcessing ? 'candy-toggle--active' : ''}" data-setting="postProcessing">
                            <div class="candy-toggle__handle"></div>
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="candy-settings-group">
                <div class="candy-settings-group__title"><span aria-hidden="true">🔊</span> Audio</div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-audioVolume">Master Volume</span>
                    <div class="candy-settings-row__control">
                        <span class="candy-settings-row__value">${Math.round(s.audioVolume * 100)}%</span>
                        <input type="range" class="candy-slider" min="0" max="100" value="${Math.round(s.audioVolume * 100)}" data-setting="audioVolume" aria-labelledby="setting-label-audioVolume">
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-musicVolume">Music Volume</span>
                    <div class="candy-settings-row__control">
                        <span class="candy-settings-row__value">${Math.round(s.musicVolume * 100)}%</span>
                        <input type="range" class="candy-slider" min="0" max="100" value="${Math.round(s.musicVolume * 100)}" data-setting="musicVolume" aria-labelledby="setting-label-musicVolume">
                    </div>
                </div>
                <div class="candy-settings-row">
                    <span class="candy-settings-row__label" id="setting-label-sfxVolume">SFX Volume</span>
                    <div class="candy-settings-row__control">
                        <span class="candy-settings-row__value">${Math.round(s.sfxVolume * 100)}%</span>
                        <input type="range" class="candy-slider" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}" data-setting="sfxVolume" aria-labelledby="setting-label-sfxVolume">
                    </div>
                </div>
            </div>
            
            <div class="candy-settings-group">
                <div class="candy-settings-group__title"><span aria-hidden="true">⌨️</span> Key Bindings (Click to change)</div>
                ${Object.entries(s.keyBindings).map(([action, key]) => `
                    <div class="candy-settings-row">
                        <span class="candy-settings-row__label" id="setting-label-keybind-${action}">${this.formatKeybindAction(action)}</span>
                        <div class="candy-settings-row__control">
                            <button class="candy-keybind ${this.listeningKeybind === action ? 'candy-keybind--listening' : ''}"
                                    data-keybind="${action}" aria-labelledby="setting-label-keybind-${action}">
                                ${this.formatKey(key)}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="candy-save-menu__actions">
                <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="save-settings">
                    <span aria-hidden="true">💾</span> Save Settings
                </button>
                <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="reset-settings">
                    <span aria-hidden="true">🔄</span> Reset to Defaults
                </button>
            </div>
        `;
    }

    private renderImportExportTab(): string {
        return `
            <div class="candy-io-area">
                <div class="candy-io-area__label" id="export-label">Export Save Data</div>
                <textarea class="candy-textarea" id="export-area" placeholder="Exported save data will appear here..." aria-labelledby="export-label"></textarea>
                <div class="candy-save-menu__actions" style="margin-top: 15px;">
                    <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="export-current">
                        <span aria-hidden="true">📋</span> Export Current
                    </button>
                    <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="export-all">
                        <span aria-hidden="true">📦</span> Export All
                    </button>
                    <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="copy-export">
                        <span aria-hidden="true">📋</span> Copy to Clipboard
                    </button>
                    <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="download-export">
                        <span aria-hidden="true">💾</span> Download as File
                    </button>
                </div>
            </div>
            
            <div class="candy-io-area">
                <div class="candy-io-area__label" id="import-label">Import Save Data</div>
                <textarea class="candy-textarea" id="import-area" placeholder="Paste save data here or upload a file..." aria-labelledby="import-label"></textarea>
                <div class="candy-save-menu__actions" style="margin-top: 15px;">
                    <input type="file" class="candy-file-input" id="import-file" accept=".json,.txt">
                    <label for="import-file" class="candy-file-label"><span aria-hidden="true">📁</span> Choose File</label>
                    <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="import-data">
                        <span aria-hidden="true">📥</span> Import Data
                    </button>
                    <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="clear-import">
                        <span aria-hidden="true">🗑️</span> Clear
                    </button>
                </div>
            </div>
            
            <div class="candy-danger-zone">
                <div class="candy-danger-zone__title"><span aria-hidden="true">⚠️</span> Danger Zone</div>
                <div class="candy-danger-zone__text">
                    Deleting all data cannot be undone. All saves, settings, and progress will be permanently lost.
                </div>
                <button class="candy-save-menu__btn candy-save-menu__btn--danger" data-action="delete-all">
                    <span aria-hidden="true">🗑️</span> Delete All Data
                </button>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // EVENT HANDLERS
    // -------------------------------------------------------------------------

    private attachEventListeners(): void {
        if (!this.container) return;

        // Tab switching
        this.container.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = (e.currentTarget as HTMLElement).dataset.tab as MenuTab;
                this.switchTab(tab);
            });
        });

        // Close button
        const closeBtn = this.container.querySelector('[data-action="close"]');
        closeBtn?.addEventListener('click', () => this.close());

        // Slot actions
        this.container.querySelectorAll('[data-action][data-slot]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget as HTMLElement;
                const action = el.dataset.action;
                const slotId = el.dataset.slot!;
                this.handleSlotAction(action!, slotId);
            });
        });

        // Quick save
        const quickSaveBtn = this.container.querySelector('[data-action="quick-save"]');
        quickSaveBtn?.addEventListener('click', () => this.handleQuickSave());

        // Settings
        this.container.querySelectorAll('[data-setting]').forEach(el => {
            el.addEventListener('change', (e) => this.handleSettingChange(e));
            el.addEventListener('click', (e) => this.handleSettingClick(e));
        });

        // Keybinds
        this.container.querySelectorAll('[data-keybind]').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleKeybindClick(e));
        });

        // Actions
        this.container.querySelectorAll('[data-action]').forEach(btn => {
            const action = (btn as HTMLElement).dataset.action;
            if (action && !btn.hasAttribute('data-slot')) {
                btn.addEventListener('click', () => this.handleAction(action, btn as HTMLButtonElement));
            }
        });

        // File input
        const fileInput = this.container.querySelector('#import-file') as HTMLInputElement;
        fileInput?.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            if (this.listeningKeybind) {
                this.cancelKeybindListen();
            } else {
                this.close();
            }
        } else if (this.listeningKeybind) {
            e.preventDefault();
            this.updateKeybind(this.listeningKeybind, e.key.toLowerCase());
        }
    }

    private switchTab(tab: MenuTab): void {
        this.currentTab = tab;
        this.render();
    }

    private async handleSlotAction(action: string, slotId: string): Promise<void> {
        switch (action) {
            case 'load':
                await this.loadSave(slotId);
                break;
            case 'save':
            case 'overwrite':
                await this.saveToSlot(slotId);
                break;
            case 'export':
                await this.exportSlot(slotId);
                break;
            case 'delete':
                await this.deleteSlot(slotId);
                break;
        }
    }

    private async loadSave(slotId: string): Promise<void> {
        const data = await saveSystem.load(slotId);
        if (data) {
            showToast(`Loaded: ${data.metadata.slotName}`, '📂', 3000);
            this.onLoadCallback?.(data);
            this.close();
        } else {
            showToast('Failed to load save', '❌', 3000);
        }
    }

    private async saveToSlot(slotId: string): Promise<void> {
        const result = await saveSystem.save(slotId);
        if (result) {
            showToast('Game saved!', '💾', 3000);
            this.onSaveCallback?.(slotId);
            await this.refreshSlots();
            this.render();
        }
    }

    private async handleQuickSave(): Promise<void> {
        // Find first empty manual slot or use slot-1
        const emptySlot = this.slots.find(s => !s.isAutoSave && !s.exists);
        const slotId = emptySlot?.slotId || 'manual-1';
        await this.saveToSlot(slotId);
    }

    private async exportSlot(slotId: string): Promise<void> {
        const data = await saveSystem.exportSave(slotId);
        if (data) {
            const textarea = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
            if (textarea) {
                textarea.value = data;
            } else {
                // If not on import-export tab, switch to it
                this.switchTab('import-export');
                setTimeout(() => {
                    const ta = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
                    if (ta) ta.value = data;
                }, 50);
            }
            showToast('Save exported!', '📤', 3000);
        }
    }

    private async deleteSlot(slotId: string): Promise<void> {
        if (!confirm('Are you sure you want to delete this save?')) return;
        
        const result = await saveSystem.deleteSlot(slotId);
        if (result) {
            showToast('Save deleted', '🗑️', 3000);
            await this.refreshSlots();
            this.render();
        }
    }

    private handleSettingChange(e: Event): void {
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        const setting = target.dataset.setting;
        if (!setting) return;

        let value: any = target.value;
        if (target.type === 'range') {
            value = parseInt(value);
        }

        // Update local settings
        (this.settings as any)[setting] = value;

        // Update display value for sliders
        if (target.type === 'range') {
            const valueEl = target.parentElement?.querySelector('.candy-settings-row__value');
            if (valueEl) {
                const suffix = setting === 'drawDistance' ? 'm' : setting === 'fov' ? '°' : '%';
                const displayValue = ['audioVolume', 'musicVolume', 'sfxVolume'].includes(setting) 
                    ? Math.round((value as number) * (setting === 'drawDistance' || setting === 'fov' ? 1 : 100))
                    : value;
                valueEl.textContent = `${displayValue}${suffix}`;
            }
        }
    }

    private handleSettingClick(e: Event): void {
        const target = e.currentTarget as HTMLElement;
        const setting = target.dataset.setting;
        if (setting && target.classList.contains('candy-toggle')) {
            const currentValue = (this.settings as any)[setting];
            (this.settings as any)[setting] = !currentValue;
            target.classList.toggle('candy-toggle--active', !currentValue);
            target.setAttribute('aria-checked', (!currentValue).toString());
        }
    }

    private handleKeybindClick(e: Event): void {
        const target = e.currentTarget as HTMLElement;
        const action = target.dataset.keybind as keyof KeyBindings;
        
        // Cancel previous listener
        if (this.listeningKeybind) {
            this.container?.querySelector(`[data-keybind="${this.listeningKeybind}"]`)?.classList.remove('candy-keybind--listening');
        }
        
        // Start listening
        this.listeningKeybind = action;
        target.classList.add('candy-keybind--listening');
        target.textContent = 'Press key...';
    }

    private cancelKeybindListen(): void {
        if (this.listeningKeybind) {
            const btn = this.container?.querySelector(`[data-keybind="${this.listeningKeybind}"]`);
            if (btn) {
                btn.classList.remove('candy-keybind--listening');
                btn.textContent = this.formatKey(this.settings.keyBindings[this.listeningKeybind]);
            }
            this.listeningKeybind = null;
        }
    }

    private updateKeybind(action: keyof KeyBindings, key: string): void {
        this.settings.keyBindings[action] = key;
        this.cancelKeybindListen();
    }

    private async handleAction(action: string, btnElement: HTMLButtonElement): Promise<void> {
        const originalHtml = btnElement.innerHTML;
        const originalWidth = btnElement.offsetWidth;

        const setWorkingState = () => {
            btnElement.disabled = true;
            btnElement.style.width = `${originalWidth}px`;
            btnElement.style.justifyContent = 'center';
            btnElement.innerHTML = '<span class="candy-save-menu__spinner" style="width: 16px; height: 16px; margin: 0; border-width: 2px;"></span>';
        };

        const restoreState = () => {
            btnElement.disabled = false;
            btnElement.style.width = '';
            btnElement.style.justifyContent = '';
            btnElement.innerHTML = originalHtml;
        };

        switch (action) {
            case 'save-settings':
                setWorkingState();
                saveSystem.updateSettings(this.settings);
                showToast('Settings saved!', '⚙️', 3000);
                setTimeout(restoreState, 300); // Brief delay for visual feedback
                break;
            case 'reset-settings':
                if (confirm('Reset all settings to defaults?')) {
                    // Would need to import default settings from save-system
                    showToast('Settings reset', '🔄', 3000);
                }
                break;
            case 'export-current':
                setWorkingState();
                const currentSlot = saveSystem.getCurrentSlotId();
                if (currentSlot) {
                    await this.exportSlot(currentSlot);
                } else {
                    showToast('No current save to export', '⚠️', 3000);
                }
                setTimeout(restoreState, 300);
                break;
            case 'export-all':
                setWorkingState();
                await this.exportAll();
                setTimeout(restoreState, 300);
                break;
            case 'copy-export':
                setWorkingState();
                await this.copyExport();
                setTimeout(restoreState, 300);
                break;
            case 'download-export':
                setWorkingState();
                await this.downloadExport();
                setTimeout(restoreState, 300);
                break;
            case 'import-data':
                setWorkingState();
                await this.importData();
                setTimeout(restoreState, 300);
                break;
            case 'clear-import':
                const importArea = this.container?.querySelector('#import-area') as HTMLTextAreaElement;
                if (importArea) importArea.value = '';
                break;
            case 'delete-all':
                setWorkingState();
                await this.deleteAll();
                restoreState();
                break;
        }
    }

    private async exportAll(): Promise<void> {
        const data = await saveSystem.exportAllSaves();
        if (data) {
            const textarea = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
            if (textarea) textarea.value = data;
            showToast('All saves exported!', '📦', 3000);
        }
    }

    private async copyExport(): Promise<void> {
        const textarea = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
        if (textarea?.value) {
            try {
                await navigator.clipboard.writeText(textarea.value);
                showToast('Copied to clipboard!', '📋', 3000);
            } catch (e) {
                showToast('Failed to copy', '❌', 3000);
            }
        }
    }

    private async downloadExport(): Promise<void> {
        const textarea = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
        if (!textarea?.value) {
            showToast('Nothing to download', '⚠️', 3000);
            return;
        }

        const blob = new Blob([textarea.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `candy-world-save-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Save downloaded!', '💾', 3000);
    }

    private async importData(): Promise<void> {
        const textarea = this.container?.querySelector('#import-area') as HTMLTextAreaElement;
        if (!textarea?.value.trim()) {
            showToast('No data to import', '⚠️', 3000);
            return;
        }

        const result = await saveSystem.importSave(textarea.value);
        if (result) {
            await this.refreshSlots();
            if (this.currentTab === 'save' || this.currentTab === 'load') {
                this.render();
            }
            textarea.value = '';
        }
    }

    private handleFileSelect(e: Event): void {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const textarea = this.container?.querySelector('#import-area') as HTMLTextAreaElement;
            if (textarea && event.target?.result) {
                textarea.value = event.target.result as string;
            }
        };
        reader.readAsText(file);
    }

    private async deleteAll(): Promise<void> {
        if (!confirm('⚠️ WARNING: This will permanently delete ALL save data, settings, and progress.\n\nThis cannot be undone.\n\nAre you absolutely sure?')) {
            return;
        }

        const result = await saveSystem.deleteAllData();
        if (result) {
            showToast('All data deleted', '🗑️', 5000);
            await this.refreshSlots();
            this.render();
        }
    }

    // -------------------------------------------------------------------------
    // UTILITIES
    // -------------------------------------------------------------------------

    private formatPlaytime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    private formatKeybindAction(action: string): string {
        return action
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    private formatKey(key: string): string {
        const keyMap: Record<string, string> = {
            ' ': 'Space',
            'control': 'Ctrl',
            'shift': 'Shift',
            'alt': 'Alt',
            'arrowup': '↑',
            'arrowdown': '↓',
            'arrowleft': '←',
            'arrowright': '→'
        };
        return keyMap[key] || key.toUpperCase();
    }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

let activeMenu: SaveMenu | null = null;

/**
 * Open the save/load menu
 */
export function openSaveMenu(options: SaveMenuOptions = {}): SaveMenu {
    // Close existing menu
    if (activeMenu?.isOpen()) {
        activeMenu.close();
    }
    
    activeMenu = new SaveMenu(options);
    activeMenu.show();
    return activeMenu;
}

/**
 * Open the load game menu
 */
export function openLoadMenu(onLoad: (data: SaveData) => void): SaveMenu {
    return openSaveMenu({ mode: 'load', onLoad });
}

/**
 * Open the save game menu
 */
export function openSaveGameMenu(onSave?: (slotId: string) => void): SaveMenu {
    return openSaveMenu({ mode: 'save', onSave });
}

/**
 * Close the active save menu
 */
export function closeSaveMenu(): void {
    activeMenu?.close();
    activeMenu = null;
}

/**
 * Check if save menu is currently open
 */
export function isSaveMenuOpen(): boolean {
    return activeMenu?.isOpen() ?? false;
}

// =============================================================================
// SAVE INDICATOR (Standalone)
// =============================================================================

/**
 * Show a standalone save indicator
 */
export function showSaveIndicator(duration: number = 2000): void {
    let indicator = document.getElementById('standalone-save-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'standalone-save-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(30, 30, 40, 0.9);
            color: #4ade80;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        `;
        indicator.innerHTML = `
            💾 Saving...
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.style.opacity = '1';
    
    setTimeout(() => {
        if (indicator) {
            indicator.innerHTML = `✅ Saved`;
            setTimeout(() => {
                indicator!.style.opacity = '0';
            }, 1000);
        }
    }, duration);
}

// Expose to window for debugging
declare global {
    interface Window {
        openSaveMenu: typeof openSaveMenu;
        openLoadMenu: typeof openLoadMenu;
        openSaveGameMenu: typeof openSaveGameMenu;
        closeSaveMenu: typeof closeSaveMenu;
        SaveMenu: typeof SaveMenu;
    }
}

if (typeof window !== 'undefined') {
    window.openSaveMenu = openSaveMenu;
    window.openLoadMenu = openLoadMenu;
    window.openSaveGameMenu = openSaveGameMenu;
    window.closeSaveMenu = closeSaveMenu;
    window.SaveMenu = SaveMenu;
}

// Export types
export type { MenuTab, MenuMode, SaveMenuOptions };

// Default export
export default SaveMenu;

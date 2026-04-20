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
} from '../../systems/save-system/index.js';
import { showToast } from '../../utils/toast.js';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { MENU_STYLES } from './save-menu-styles.js';
import { 
    renderLoadTab, 
    renderSaveTab, 
    handleSlotAction, 
    handleQuickSave 
} from './save-slots.js';
import { 
    renderSettingsTab, 
    handleSettingChange, 
    handleSettingClick,
    handleKeybindClick,
    cancelKeybindListen as cancelKeybindListenBase,
    updateKeybind as updateKeybindBase
} from './save-settings.js';

// =============================================================================
// TYPES
// =============================================================================

export type MenuTab = 'load' | 'save' | 'settings' | 'import-export';
export type MenuMode = 'load' | 'save' | 'full';

export interface SaveMenuOptions {
    mode?: MenuMode;
    onLoad?: (data: SaveData) => void;
    onSave?: (slotId: string) => void;
    onClose?: () => void;
}

// =============================================================================
// SAVE MENU CLASS
// =============================================================================

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
    private releaseFocusTrap: (() => void) | null = null;
    private lastFocusedElement: HTMLElement | null = null;

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
    // PUBLIC API
    // -------------------------------------------------------------------------

    /**
     * Get the container element (for external modules)
     */
    getContainer(): HTMLElement | null {
        return this.container;
    }

    /**
     * Get current slots (for external modules)
     */
    getSlots(): SaveSlotInfo[] {
        return this.slots;
    }

    /**
     * Show the save menu
     */
    async show(): Promise<void> {
        if (this.container) return;
        
        this.lastFocusedElement = document.activeElement as HTMLElement | null;

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

    /**
     * Close the save menu
     */
    close(): void {
        if (!this.container) return;
        
        // Add exit animation
        this.container.style.animation = 'fadeIn 0.2s ease reverse';
        
        setTimeout(() => {
            if (this.releaseFocusTrap) {
                this.releaseFocusTrap();
                this.releaseFocusTrap = null;
            }
            this.container?.remove();
            this.container = null;
            document.removeEventListener('keydown', this.keydownHandler);

            if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
                this.lastFocusedElement.focus();
                this.lastFocusedElement = null;
            }

            this.onCloseCallback?.();
        }, 200);
    }

    /**
     * Check if menu is open
     */
    isOpen(): boolean {
        return this.container !== null;
    }

    /**
     * Switch to a different tab
     */
    switchTab(tab: MenuTab): void {
        this.currentTab = tab;
        this.render();
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
                    <div class="candy-save-menu__spinner">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span>Loading saves...</span>
                </div>
            </div>
        `;
    }

    private render(): void {
        if (!this.container) return;
        
        const tabs = this.getTabs();
        
        if (this.releaseFocusTrap) {
            this.releaseFocusTrap();
            this.releaseFocusTrap = null;
        }

        this.container.innerHTML = `
            <div class="candy-save-menu__container" role="dialog" aria-modal="true" aria-labelledby="save-menu-title">
                ${this.renderHeader()}
                ${this.currentMode === 'full' ? this.renderTabs(tabs) : ''}
                <div id="panel-${this.currentTab}" role="tabpanel" aria-labelledby="tab-${this.currentTab}" class="candy-save-menu__content">
                    ${this.renderCurrentTab()}
                </div>
            </div>
        `;
        
        this.attachEventListeners();
        this.releaseFocusTrap = trapFocusInside(this.container);
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
                <h2 id="save-menu-title" class="candy-save-menu__title">${titles[this.currentMode]}</h2>
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
                return renderLoadTab(this.slots, this.currentMode, this.selectedSlot, this);
            case 'save':
                return renderSaveTab(this.slots, this.selectedSlot);
            case 'settings':
                return renderSettingsTab(this.settings, this.listeningKeybind);
            case 'import-export':
                return this.renderImportExportTab();
            default:
                return '';
        }
    }

    private renderImportExportTab(): string {
        return `
            <div class="candy-io-area">
                <div class="candy-io-area__label" id="export-label">Export Save Data</div>
                <textarea class="candy-textarea" id="export-area" placeholder="Exported save data will appear here..." aria-labelledby="export-label" readonly spellcheck="false"></textarea>
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
                <textarea class="candy-textarea" id="import-area" placeholder="Paste save data here or upload a file..." aria-labelledby="import-label" spellcheck="false"></textarea>
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

        // Close buttons
        this.container.querySelectorAll('[data-action="close"]').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

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

    private async handleSlotAction(action: string, slotId: string): Promise<void> {
        // Create bound save function for callbacks
        const boundSaveToSlot = async (id: string) => {
            const result = await saveSystem.save(id);
            if (result) {
                showToast('Game saved!', '💾', 3000);
                this.onSaveCallback?.(id);
                await this.refreshSlots();
                this.render();
            }
        };

        await handleSlotAction(
            action, 
            slotId, 
            this,
            this.onLoadCallback,
            this.onSaveCallback,
            () => this.refreshSlots(),
            () => this.render(),
            (tab) => this.switchTab(tab)
        );
    }

    private async handleQuickSave(): Promise<void> {
        const boundSaveToSlot = async (id: string) => {
            const result = await saveSystem.save(id);
            if (result) {
                showToast('Game saved!', '💾', 3000);
                this.onSaveCallback?.(id);
                await this.refreshSlots();
                this.render();
            }
        };
        await handleQuickSave(this.slots, boundSaveToSlot);
    }

    private handleSettingChange(e: Event): void {
        handleSettingChange(e, this.settings, this.container);
    }

    private handleSettingClick(e: Event): void {
        handleSettingClick(e, this.settings);
    }

    private handleKeybindClick(e: Event): void {
        handleKeybindClick(
            e, 
            this.settings, 
            this.listeningKeybind, 
            (key) => { this.listeningKeybind = key; },
            this.container
        );
    }

    private cancelKeybindListen(): void {
        cancelKeybindListenBase(
            this.settings,
            this.listeningKeybind,
            (key) => { this.listeningKeybind = key; },
            this.container
        );
    }

    private updateKeybind(action: keyof KeyBindings, key: string): void {
        updateKeybindBase(action, key, this.settings, () => this.cancelKeybindListen());
    }

    private async handleAction(action: string, btnElement: HTMLButtonElement): Promise<void> {
        const originalHtml = btnElement.innerHTML;
        const originalWidth = btnElement.offsetWidth;

        const setWorkingState = () => {
            btnElement.disabled = true;
            btnElement.style.width = `${originalWidth}px`;
            btnElement.style.justifyContent = 'center';
            btnElement.innerHTML = '<span class="candy-save-menu__spinner" style="width: 16px; height: 16px; margin: 0; border-width: 2px;"><span class="visually-hidden">Processing...</span></span>';
        };

        const restoreState = () => {
            btnElement.disabled = false;
            btnElement.style.width = '';
            btnElement.style.justifyContent = '';
            btnElement.innerHTML = originalHtml;
        };

        switch (action) {
            case 'switch-to-save':
                this.switchTab('save');
                break;
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
                await this.exportCurrent();
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

    private async exportCurrent(): Promise<void> {
        const currentSlot = saveSystem.getCurrentSlotId();
        if (!currentSlot) {
            showToast('No current save to export', '⚠️', 3000);
            return;
        }
        
        const data = await saveSystem.exportSave(currentSlot);
        if (data) {
            const textarea = this.container?.querySelector('#export-area') as HTMLTextAreaElement;
            if (textarea) textarea.value = data;
            showToast('Save exported!', '📤', 3000);
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
                showToast('File loaded, ready to import!', '📁', 3000);
            }
            // Reset input value to allow selecting the same file again
            input.value = '';
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

// Default export
export default SaveMenu;

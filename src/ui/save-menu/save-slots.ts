/**
 * Save Slots Module
 * 
 * Contains slot-related rendering functions and action handlers
 * for the save menu UI component.
 */

import { 
    saveSystem, 
    SaveData, 
    SaveSlotInfo
} from '../../systems/save-system/index.js';
import { showToast } from '../../utils/toast.js';
import type { SaveMenu } from './save-menu.js';

/**
 * Format playtime in seconds to human-readable string
 */
export function formatPlaytime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

/**
 * Render a single save slot
 */
export function renderSlot(
    slot: SaveSlotInfo, 
    forSave: boolean = false, 
    selectedSlot: string | null = null
): string {
    const isEmpty = !slot.exists;
    const isSelected = selectedSlot === slot.slotId;
    const date = slot.timestamp ? new Date(slot.timestamp).toLocaleString() : 'Empty';
    const playtimeStr = slot.playtime ? formatPlaytime(slot.playtime) : '';
    
    return `
        <div class="candy-save-slot ${isEmpty ? 'candy-save-slot--empty' : ''} ${isSelected ? 'candy-save-slot--selected' : ''}"
             data-slot-id="${slot.slotId}"
        >
            ${slot.isAutoSave && !isEmpty ? '<span class="candy-save-slot__badge">AUTO</span>' : ''}
            <div class="candy-save-slot__icon" aria-hidden="true">${isEmpty ? '➕' : '💾'}</div>
            <div class="candy-save-slot__name">${slot.slotName}</div>
            ${!isEmpty ? `
                <div class="candy-save-slot__info">${date}</div>
                ${playtimeStr ? `<div class="candy-save-slot__info"><span aria-hidden="true">⏱️</span> ${playtimeStr}</div>` : ''}
            ` : '<div class="candy-save-slot__info">Click to save</div>'}
            <div class="candy-save-slot__actions">
                ${forSave || isEmpty ? `
                    <button class="candy-save-slot__btn candy-save-slot__btn--primary" data-action="${forSave ? 'overwrite' : 'save'}" data-slot="${slot.slotId}" aria-label="${forSave && !isEmpty ? `Overwrite ${slot.slotName}` : `Save to ${slot.slotName}`}">
                        ${forSave && !isEmpty ? 'Overwrite' : 'Save'}
                    </button>
                ` : `
                    <button class="candy-save-slot__btn candy-save-slot__btn--primary" data-action="load" data-slot="${slot.slotId}" aria-label="Load ${slot.slotName}">
                        Load
                    </button>
                    <button class="candy-save-slot__btn candy-save-slot__btn--secondary" data-action="export" data-slot="${slot.slotId}" aria-label="Export ${slot.slotName}">
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

/**
 * Render the Load tab content
 */
export function renderLoadTab(
    slots: SaveSlotInfo[], 
    currentMode: 'load' | 'save' | 'full',
    selectedSlot: string | null,
    menu: SaveMenu
): string {
    const manualSlots = slots.filter(s => !s.isAutoSave && s.exists);
    const autoSlots = slots.filter(s => s.isAutoSave && s.exists);
    
    if (manualSlots.length === 0 && autoSlots.length === 0) {
        return `
            <div class="candy-empty-state">
                <div class="candy-empty-state__icon" aria-hidden="true">📝</div>
                <div class="candy-empty-state__text">No save files found</div>
                ${currentMode === 'full' ? `
                <div class="candy-save-menu__actions">
                    <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="switch-to-save">
                        <span aria-hidden="true">➕</span> Create New Save
                    </button>
                </div>
                ` : `
                <div class="candy-save-menu__actions" style="margin-top: 15px;">
                    <button class="candy-save-menu__btn candy-save-menu__btn--secondary" data-action="close">
                        <span aria-hidden="true">✕</span> Close Menu
                    </button>
                </div>
                `}
            </div>
        `;
    }
    
    return `
        ${manualSlots.length > 0 ? `
            <div class="candy-settings-group">
                <div class="candy-settings-group__title"><span aria-hidden="true">💾</span> Manual Saves</div>
                <div class="candy-save-slots">
                    ${manualSlots.map(slot => renderSlot(slot, false, selectedSlot)).join('')}
                </div>
            </div>
        ` : ''}
        ${autoSlots.length > 0 ? `
            <div class="candy-settings-group">
                <div class="candy-settings-group__title"><span aria-hidden="true">🔄</span> Auto Saves</div>
                <div class="candy-save-slots">
                    ${autoSlots.map(slot => renderSlot(slot, false, selectedSlot)).join('')}
                </div>
            </div>
        ` : ''}
    `;
}

/**
 * Render the Save tab content
 */
export function renderSaveTab(
    slots: SaveSlotInfo[],
    selectedSlot: string | null
): string {
    const manualSlots = slots.filter(s => !s.isAutoSave);
    
    return `
        <div class="candy-save-slots">
            ${manualSlots.map(slot => renderSlot(slot, true, selectedSlot)).join('')}
        </div>
        <div class="candy-save-menu__actions">
            <button class="candy-save-menu__btn candy-save-menu__btn--primary" data-action="quick-save">
                <span aria-hidden="true">💾</span> Quick Save (Ctrl+S)
            </button>
        </div>
    `;
}

/**
 * Handle slot-related actions (load, save, overwrite, export, delete)
 */
export async function handleSlotAction(
    action: string, 
    slotId: string,
    menu: SaveMenu,
    onLoadCallback?: (data: SaveData) => void,
    onSaveCallback?: (slotId: string) => void,
    refreshSlots?: () => Promise<void>,
    render?: () => void,
    switchTab?: (tab: 'load' | 'save' | 'settings' | 'import-export') => void,
    btnElement?: HTMLElement
): Promise<void> {

    // Set busy state if button was provided
    if (btnElement) {
        btnElement.setAttribute('aria-busy', 'true');
        btnElement.style.pointerEvents = 'none';
        btnElement.style.opacity = '0.7';
        const originalText = btnElement.innerHTML;
        btnElement.innerHTML = '<span class="spinner" aria-hidden="true"></span>...';

        // Setup cleanup to restore state
        const cleanup = () => {
            btnElement.removeAttribute('aria-busy');
            btnElement.style.pointerEvents = '';
            btnElement.style.opacity = '';
            btnElement.innerHTML = originalText;
        };

        try {
            switch (action) {
                case 'load':
                    await loadSave(slotId, onLoadCallback, menu);
                    break;
                case 'save':
                    await saveToSlot(slotId, onSaveCallback, refreshSlots, render);
                    break;
                case 'overwrite':
                    if (!confirm('Are you sure you want to overwrite this save? This cannot be undone.')) {
                        cleanup();
                        return;
                    }
                    await saveToSlot(slotId, onSaveCallback, refreshSlots, render);
                    break;
                case 'export':
                    await exportSlot(slotId, menu);
                    break;
                case 'delete':
                    if (confirm('Are you sure you want to delete this save?')) {
                        const result = await saveSystem.delete(slotId);
                        if (result) {
                            import('../../utils/toast.js').then(({ showToast }) => {
                                showToast('Save deleted', '🗑️', 3000);
                            });
                            await refreshSlots?.();
                            render?.();
                        }
                    }
                    break;
            }
        } finally {
            cleanup();
        }
        return;
    }

    switch (action) {
        case 'load':
            await loadSave(slotId, onLoadCallback, menu);
            break;
        case 'save':
            await saveToSlot(slotId, onSaveCallback, refreshSlots, render);
            break;
        case 'overwrite':
            if (!confirm('Are you sure you want to overwrite this save? This cannot be undone.')) return;
            await saveToSlot(slotId, onSaveCallback, refreshSlots, render);
            break;
        case 'export':
            await exportSlot(slotId, menu);
            break;
        case 'delete':
            await deleteSlot(slotId, refreshSlots, render);
            break;
    }
}

/**
 * Load a save from the specified slot
 */
async function loadSave(
    slotId: string,
    onLoadCallback?: (data: SaveData) => void,
    menu?: SaveMenu
): Promise<void> {
    const data = await saveSystem.load(slotId);
    if (data) {
        showToast(`Loaded: ${data.metadata.slotName}`, '📂', 3000);
        onLoadCallback?.(data);
        menu?.close();
    } else {
        showToast('Failed to load save', '❌', 3000);
    }
}

/**
 * Save to a specific slot
 */
async function saveToSlot(
    slotId: string,
    onSaveCallback?: (slotId: string) => void,
    refreshSlots?: () => Promise<void>,
    render?: () => void
): Promise<void> {
    const result = await saveSystem.save(slotId);
    if (result) {
        showToast('Game saved!', '💾', 3000);
        onSaveCallback?.(slotId);
        await refreshSlots?.();
        render?.();
    }
}

/**
 * Export a specific slot
 */
async function exportSlot(
    slotId: string,
    menu: SaveMenu
): Promise<void> {
    const data = await saveSystem.exportSave(slotId);
    if (data) {
        const textarea = menu.getContainer()?.querySelector('#export-area') as HTMLTextAreaElement;
        if (textarea) {
            textarea.value = data;
        } else {
            // If not on import-export tab, switch to it
            menu.switchTab('import-export');
            setTimeout(() => {
                const ta = menu.getContainer()?.querySelector('#export-area') as HTMLTextAreaElement;
                if (ta) ta.value = data;
            }, 50);
        }
        showToast('Save exported!', '📤', 3000);
    }
}

/**
 * Delete a save slot
 */
async function deleteSlot(
    slotId: string,
    refreshSlots?: () => Promise<void>,
    render?: () => void
): Promise<void> {
    if (!confirm('Are you sure you want to delete this save?')) return;
    
    const result = await saveSystem.deleteSlot(slotId);
    if (result) {
        showToast('Save deleted', '🗑️', 3000);
        await refreshSlots?.();
        render?.();
    }
}

/**
 * Handle quick save action
 */
export async function handleQuickSave(
    slots: SaveSlotInfo[],
    saveToSlotFn: (slotId: string) => Promise<void>
): Promise<void> {
    // Find first empty manual slot or use slot-1
    const emptySlot = slots.find(s => !s.isAutoSave && !s.exists);
    const slotId = emptySlot?.slotId || 'manual-1';
    await saveToSlotFn(slotId);
}

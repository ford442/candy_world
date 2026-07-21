/**
 * Lazy save-menu entry points — load the heavy UI only when a menu is opened (#1361).
 */
import type { SaveData } from '../../systems/save-system/index.ts';
import type { SaveMenu, SaveMenuOptions } from './save-menu.ts';

type SaveMenuModule = typeof import('./index.ts');

let _mod: SaveMenuModule | null = null;
let _loadPromise: Promise<SaveMenuModule> | null = null;

function loadSaveMenu(): Promise<SaveMenuModule> {
    if (_mod) return Promise.resolve(_mod);
    if (!_loadPromise) {
        _loadPromise = import('./index.ts').then((m) => {
            _mod = m;
            return m;
        });
    }
    return _loadPromise;
}

export async function openSaveMenu(options: SaveMenuOptions = {}): Promise<SaveMenu> {
    const m = await loadSaveMenu();
    return m.openSaveMenu(options);
}

export async function openLoadMenu(onLoad: (data: SaveData) => void): Promise<SaveMenu> {
    const m = await loadSaveMenu();
    return m.openLoadMenu(onLoad);
}

export async function openSaveGameMenu(onSave?: (slotId: string) => void): Promise<SaveMenu> {
    const m = await loadSaveMenu();
    return m.openSaveGameMenu(onSave);
}

export async function closeSaveMenu(): Promise<void> {
    if (!_mod) return;
    _mod.closeSaveMenu();
}

export async function isSaveMenuOpen(): Promise<boolean> {
    if (!_mod) return false;
    return _mod.isSaveMenuOpen();
}

export async function showSaveIndicator(duration: number = 2000): Promise<void> {
    const m = await loadSaveMenu();
    m.showSaveIndicator(duration);
}

/** Install window.* stubs that dynamic-import on first call. */
export function installSaveMenuGlobals(): void {
    if (typeof window === 'undefined') return;
    (window as any).openSaveMenu = (...args: any[]) => openSaveMenu(...args);
    (window as any).openLoadMenu = (...args: any[]) => openLoadMenu(...args);
    (window as any).openSaveGameMenu = (...args: any[]) => openSaveGameMenu(...args);
    (window as any).closeSaveMenu = () => closeSaveMenu();
}

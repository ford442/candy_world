/**
 * Save Settings Module
 * 
 * Contains settings tab rendering and keybind management
 * for the save menu UI component.
 */

import { 
    saveSystem, 
    SettingsSaveData,
    KeyBindings
} from '../../systems/save-system/index.js';
import { showToast } from '../../utils/toast.js';

/** Key map for displaying keys */
const KEY_MAP: Record<string, string> = {
    ' ': 'Space',
    'control': 'Ctrl',
    'shift': 'Shift',
    'alt': 'Alt',
    'arrowup': '↑',
    'arrowdown': '↓',
    'arrowleft': '←',
    'arrowright': '→'
};

/**
 * Format a key for display
 */
export function formatKey(key: string): string {
    return KEY_MAP[key] || key.toUpperCase();
}

/**
 * Format a keybind action name for display
 */
export function formatKeybindAction(action: string): string {
    return action
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Render the Settings tab content
 */
export function renderSettingsTab(
    settings: SettingsSaveData,
    listeningKeybind: keyof KeyBindings | null
): string {
    const s = settings;
    
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
                    <span class="candy-settings-row__label" id="setting-label-keybind-${action}">${formatKeybindAction(action)}</span>
                    <div class="candy-settings-row__control">
                        <button class="candy-keybind ${listeningKeybind === action ? 'candy-keybind--listening' : ''}"
                                data-keybind="${action}" aria-labelledby="setting-label-keybind-${action}">
                            ${formatKey(key)}
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

/**
 * Handle setting change from input/select elements
 */
export function handleSettingChange(
    e: Event,
    settings: SettingsSaveData,
    container: HTMLElement | null
): void {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const setting = target.dataset.setting;
    if (!setting) return;

    let value: any = target.value;
    if (target.type === 'range') {
        value = parseInt(value);
    }

    // Update local settings
    (settings as any)[setting] = value;

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

/**
 * Handle setting click (for toggle buttons)
 */
export function handleSettingClick(
    e: Event,
    settings: SettingsSaveData
): void {
    const target = e.currentTarget as HTMLElement;
    const setting = target.dataset.setting;
    if (setting && target.classList.contains('candy-toggle')) {
        const currentValue = (settings as any)[setting];
        (settings as any)[setting] = !currentValue;
        target.classList.toggle('candy-toggle--active', !currentValue);
        target.setAttribute('aria-checked', (!currentValue).toString());
    }
}

/**
 * Handle keybind button click
 */
export function handleKeybindClick(
    e: Event,
    settings: SettingsSaveData,
    listeningKeybind: keyof KeyBindings | null,
    setListeningKeybind: (key: keyof KeyBindings | null) => void,
    container: HTMLElement | null
): void {
    const target = e.currentTarget as HTMLElement;
    const action = target.dataset.keybind as keyof KeyBindings;
    
    // Cancel previous listener
    if (listeningKeybind) {
        container?.querySelector(`[data-keybind="${listeningKeybind}"]`)?.classList.remove('candy-keybind--listening');
    }
    
    // Start listening
    setListeningKeybind(action);
    target.classList.add('candy-keybind--listening');
    target.textContent = 'Press key...';
}

/**
 * Cancel keybind listening mode
 */
export function cancelKeybindListen(
    settings: SettingsSaveData,
    listeningKeybind: keyof KeyBindings | null,
    setListeningKeybind: (key: keyof KeyBindings | null) => void,
    container: HTMLElement | null
): void {
    if (listeningKeybind) {
        const btn = container?.querySelector(`[data-keybind="${listeningKeybind}"]`);
        if (btn) {
            btn.classList.remove('candy-keybind--listening');
            btn.textContent = formatKey(settings.keyBindings[listeningKeybind]);
        }
        setListeningKeybind(null);
    }
}

/**
 * Update a keybind with a new key
 */
export function updateKeybind(
    action: keyof KeyBindings,
    key: string,
    settings: SettingsSaveData,
    cancelListenFn: () => void
): void {
    settings.keyBindings[action] = key;
    cancelListenFn();
}

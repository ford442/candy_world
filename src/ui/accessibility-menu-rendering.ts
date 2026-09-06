/**
 * Accessibility Menu - Rendering Module
 * Handles all DOM creation and rendering logic for the accessibility settings menu.
 * This module extends the core AccessibilityMenu class with rendering capabilities.
 */

import { AccessibilityMenuCore, MenuSection } from './accessibility-menu-core';
import { announce } from './announcer';

/**
 * Extension of AccessibilityMenuCore with rendering methods.
 * These methods handle all DOM creation and section rendering.
 */
export class AccessibilityMenuRendering extends AccessibilityMenuCore {
    // ============================================================================
    // DOM Creation Methods
    // ============================================================================

    protected createMenu(): void {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'a11y-menu-overlay';
        this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

        // Create menu container
        this.container = document.createElement('div');
        this.container.className = 'a11y-menu-container';
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-modal', 'true');
        this.container.setAttribute('tabindex', '-1');
        this.container.setAttribute('aria-labelledby', 'a11y-menu-title');
        this.container.style.cssText = `
      background: var(--menu-bg, #2a2a2a);
      border-radius: 12px;
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--menu-text, #ffffff);
      font-family: system-ui, -apple-system, sans-serif;
      opacity: 0;
      transform: scale(0.95);
      transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

        this.container.appendChild(this.createHeader());
        this.container.appendChild(this.createContent());
        this.container.appendChild(this.createFooter());

        this.overlay.appendChild(this.container);
        document.body.appendChild(this.overlay);

        // Set up keyboard listener
        this.container.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    private createHeader(): HTMLElement {
        const header = document.createElement('header');
        header.style.cssText = `
      padding: 20px;
      border-bottom: 1px solid var(--menu-border, #444);
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

        const title = document.createElement('h2');
        title.id = 'a11y-menu-title';
        title.textContent = 'Accessibility Settings';
        title.style.cssText = `
      margin: 0;
      font-size: 1.5rem;
      color: var(--menu-heading, #fff);
    `;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'a11y-close-btn a11y-button';
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
      ${this.getButtonStyle()}
      width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1.2rem;
    `;
        closeBtn.onclick = () => {
            this.close();
        };
        closeBtn.setAttribute('aria-label', 'Close accessibility menu');

        header.appendChild(title);
        header.appendChild(closeBtn);
        return header;
    }

    private createContent(): HTMLElement {
        const content = document.createElement('div');
        content.style.cssText = `
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    `;

        const sidebar = this.createSidebar();
        const mainPanel = this.createMainPanel();

        content.appendChild(sidebar);
        content.appendChild(mainPanel);
        return content;
    }

    private createSidebar(): HTMLElement {
        const sidebar = document.createElement('aside');
        sidebar.role = 'tablist';
        sidebar.style.cssText = `
      width: 160px;
      border-right: 1px solid var(--menu-border, #444);
      background: var(--menu-sidebar-bg, #2a2a2a);
      overflow-y: auto;
      padding: 10px 0;
    `;

        const sections: MenuSection[] = [
            'presets',
            'motor',
            'visual',
            'cognitive',
            'auditory',
            'screen-reader',
        ];
        const labels = {
            presets: 'Presets',
            motor: 'Motor',
            visual: 'Visual',
            cognitive: 'Cognitive',
            auditory: 'Auditory',
            'screen-reader': 'Screen Reader',
        };

        const sectionMenuItems = sections; // all sections are always available

        for (const section of sections) {
            const isActive = this.currentSection === section;
            const tab = document.createElement('button');
            tab.className = 'a11y-tab';
            tab.id = `tab-${section}`;
            tab.role = 'tab';
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.tabIndex = isActive ? 0 : -1;
            tab.setAttribute('aria-controls', `panel-${section}`);
            tab.textContent = labels[section];
            tab.style.cssText = `
        width: 100%;
        padding: 12px;
        color: var(--menu-text, #ccc);
        border: none;
        border-left: 3px solid transparent;
        cursor: pointer;
        text-align: left;
      `;
            tab.onclick = () => {
                this.switchSection(section);
            };

            sidebar.appendChild(tab);
        }

        return sidebar;
    }

    private createMainPanel(): HTMLElement {
        const main = document.createElement('main');
        main.id = `panel-${this.currentSection}`;
        main.setAttribute('role', 'tabpanel');
        main.setAttribute('aria-labelledby', `tab-${this.currentSection}`);
        main.tabIndex = 0;
        main.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: var(--menu-bg, #1a1a1a);
      color: var(--menu-text, #fff);
    `;

        this.renderSection(main, this.currentSection);
        return main;
    }

    private createFooter(): HTMLElement {
        const footer = document.createElement('footer');
        footer.style.cssText = `
      padding: 15px 20px;
      border-top: 1px solid var(--menu-border, #444);
      background: var(--menu-footer-bg, #2a2a2a);
      text-align: center;
      font-size: 0.9rem;
      color: var(--menu-text-muted, #999);
    `;

        footer.textContent = 'Press ESC to close';
        footer.setAttribute('aria-label', 'Footer help text');

        return footer;
    }

    private getButtonStyle(): string {
        return `
      background: var(--menu-button-bg, #3a3a3a);
      color: var(--menu-text, #fff);
      border: 1px solid var(--menu-border, #444);
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 1rem;
      transition: all 0.2s;
    `;
    }

    // ============================================================================
    // Section Rendering
    // ============================================================================

    protected renderSection(container: HTMLElement, section: MenuSection): void {
        container.innerHTML = '';
        switch (section) {
            case 'presets':
                this.renderPresetsSection(container);
                break;
            case 'motor':
                this.renderMotorSection(container);
                break;
            case 'visual':
                this.renderVisualSection(container);
                break;
            case 'cognitive':
                this.renderCognitiveSection(container);
                break;
            case 'auditory':
                this.renderAuditorySection(container);
                break;
            case 'screen-reader':
                this.renderScreenReaderSection(container);
                break;
        }
    }

    private renderPresetsSection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Quick Presets');
        this.createSectionSubtitle(container, 'Apply predefined accessibility profiles');

        const presets = [
            { id: 'legible', label: 'Legible', desc: 'High contrast & larger text' },
            {
                id: 'motor-friendly',
                label: 'Motor-Friendly',
                desc: 'Larger buttons & reduced motion',
            },
            { id: 'minimal-distractions', label: 'Focus', desc: 'Minimal colors & animations' },
        ];

        const grid = document.createElement('div');
        grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 20px;
    `;

        for (const preset of presets) {
            const card = document.createElement('button');
            card.className = 'a11y-preset-card a11y-button';
            card.style.cssText = `
        ${this.getButtonStyle()}
        padding: 16px;
        cursor: pointer;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;

            const title = document.createElement('strong');
            title.textContent = preset.label;
            const desc = document.createElement('small');
            desc.textContent = preset.desc;

            card.appendChild(title);
            card.appendChild(desc);
            card.onclick = () => {
                this.a11y.applyPreset(preset.id);
                announce(`${preset.label} preset applied`, 'polite');
                this.highlightActiveCard(grid, card);
            };

            grid.appendChild(card);
        }

        container.appendChild(grid);
    }

    private highlightActiveCard(container: HTMLElement, activeCard: HTMLElement): void {
        const cards = container.querySelectorAll('button');
        cards.forEach((card) => {
            card.style.outline =
                card === activeCard ? '2px solid var(--a11y-color, #00aaff)' : 'none';
        });
    }

    private renderMotorSection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Motor Accessibility');
        this.createSectionSubtitle(container, 'Control & movement settings');

        // Pointer speed — maps to input.sensitivity (0.1–2.0)
        this.createSlider(
            container,
            'Pointer Speed',
            'input.sensitivity',
            settings.input.sensitivity,
            0.1,
            2,
            0.1,
            (val) => {
                this.a11y.updateInputSettings({ sensitivity: val });
            }
        );

        // Reduced motion — maps to visual.motionReduction
        this.createToggle(
            container,
            'Reduce Motion',
            'visual.motionReduction',
            settings.visual.motionReduction,
            (val) => {
                this.a11y.updateVisualSettings({ motionReduction: val });
            }
        );

        // Keybindings
        this.createSectionTitle(container, 'Keybindings');
        const keybindingContainer = document.createElement('div');
        keybindingContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

        const keybindings = settings.input.keybindings;
        for (const [action, binding] of keybindings.entries()) {
            const row = document.createElement('div');
            row.style.cssText =
                'display: flex; justify-content: space-between; align-items: center;';

            const label = document.createElement('label');
            label.textContent = this.formatActionName(action);
            label.style.cssText = 'flex: 1;';

            const btn = document.createElement('button');
            btn.className = 'a11y-button';
            btn.textContent = binding.key || 'Unbound';
            btn.style.cssText = `${this.getButtonStyle()} width: 120px;`;
            btn.onclick = () => {
                this.startKeyRebind(action, btn);
            };

            row.appendChild(label);
            row.appendChild(btn);
            keybindingContainer.appendChild(row);
        }

        container.appendChild(keybindingContainer);
    }

    /**
     * Begin listening for the next keypress to rebind an action.
     * The button label updates to show the new key; the binding is persisted
     * via updateInputSettings once a key is captured.
     */
    protected startKeyRebind(action: string, btn: HTMLButtonElement): void {
        const originalText = btn.textContent ?? '';
        btn.textContent = 'Press a key…';
        btn.setAttribute('aria-label', `Rebinding ${action} — press a key`);
        const handler = (e: KeyboardEvent): void => {
            e.preventDefault();
            document.removeEventListener('keydown', handler, true);
            const keybindings = new Map(this.a11y.getSettings().input.keybindings);
            const existing = keybindings.get(action);
            keybindings.set(action, { ...(existing ?? {}), key: e.key });
            this.a11y.updateInputSettings({ keybindings });
            btn.textContent = e.key;
            btn.setAttribute('aria-label', `${action} bound to ${e.key}`);
        };
        document.addEventListener('keydown', handler, true);
        // Safety timeout: cancel rebind after 10 s of no input
        setTimeout(() => {
            document.removeEventListener('keydown', handler, true);
            if (btn.textContent === 'Press a key…') btn.textContent = originalText;
        }, 10_000);
    }

    private renderVisualSection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Visual Accessibility');
        this.createSectionSubtitle(container, 'Colors, contrast & text settings');

        // High contrast
        this.createToggle(
            container,
            'High Contrast',
            'visual.highContrast',
            settings.visual.highContrast,
            (val) => {
                this.a11y.updateVisualSettings({ highContrast: val });
            }
        );

        // Color blindness
        this.createSelect(
            container,
            'Color Blindness Mode',
            'visual.colorBlindMode',
            settings.visual.colorBlindMode,
            ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'],
            (val) => {
                this.a11y.updateVisualSettings({ colorBlindMode: val as any });
            }
        );

        // Motion reduction
        this.createToggle(
            container,
            'Reduce Motion',
            'visual.motionReduction',
            settings.visual.motionReduction,
            (val) => {
                this.a11y.updateVisualSettings({ motionReduction: val });
            }
        );

        // Screen shake
        this.createToggle(
            container,
            'Screen Shake',
            'visual.screenShake',
            settings.visual.screenShake,
            (val) => {
                this.a11y.updateVisualSettings({ screenShake: val });
            }
        );

        // Brightness
        this.createSlider(
            container,
            'Brightness',
            'visual.brightness',
            settings.visual.brightness,
            0.5,
            1.5,
            0.05,
            (val) => {
                this.a11y.updateVisualSettings({ brightness: val });
            }
        );

        // Crosshair color
        this.createColorPicker(
            container,
            'Crosshair Color',
            'visual.crosshairColor',
            settings.visual.crosshairColor,
            (val) => {
                this.a11y.updateVisualSettings({ crosshairColor: val });
            }
        );
    }

    private renderCognitiveSection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Cognitive Accessibility');
        this.createSectionSubtitle(container, 'Simplification & focus settings');

        // Simplified UI (was: simplifyUI — renamed to simplifiedUI in AccessibilitySettings)
        this.createToggle(
            container,
            'Simplify Interface',
            'cognitive.simplifiedUI',
            settings.cognitive.simplifiedUI,
            (val) => {
                this.a11y.updateCognitiveSettings({ simplifiedUI: val });
            }
        );

        // Distraction-free mode (closest to focusHighlights / readingMode)
        this.createToggle(
            container,
            'Distraction-Free Mode',
            'cognitive.distractionFree',
            settings.cognitive.distractionFree,
            (val) => {
                this.a11y.updateCognitiveSettings({ distractionFree: val });
            }
        );

        // Extended timers
        this.createToggle(
            container,
            'Extended Timers',
            'cognitive.extendedTimers',
            settings.cognitive.extendedTimers,
            (val) => {
                this.a11y.updateCognitiveSettings({ extendedTimers: val });
            }
        );

        // Timer extension factor
        this.createSlider(
            container,
            'Timer Extension Factor',
            'cognitive.timerExtensionFactor',
            settings.cognitive.timerExtensionFactor,
            1,
            4,
            0.5,
            (val) => {
                this.a11y.updateCognitiveSettings({ timerExtensionFactor: val });
            }
        );

        // Show text labels
        this.createToggle(
            container,
            'Show Text Labels',
            'cognitive.showTextLabels',
            settings.cognitive.showTextLabels,
            (val) => {
                this.a11y.updateCognitiveSettings({ showTextLabels: val });
            }
        );

        // Pause on focus lost
        this.createToggle(
            container,
            'Pause on Focus Lost',
            'cognitive.pauseOnFocusLost',
            settings.cognitive.pauseOnFocusLost,
            (val) => {
                this.a11y.updateCognitiveSettings({ pauseOnFocusLost: val });
            }
        );
    }

    private renderAuditorySection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Auditory Accessibility');
        this.createSectionSubtitle(container, 'Sound & audio settings');

        // Master volume
        this.createSlider(
            container,
            'Master Volume',
            'auditory.masterVolume',
            settings.auditory.masterVolume,
            0,
            1,
            0.05,
            (val) => {
                this.a11y.updateAuditorySettings({ masterVolume: val });
            }
        );

        // Music volume
        this.createSlider(
            container,
            'Music Volume',
            'auditory.musicVolume',
            settings.auditory.musicVolume,
            0,
            1,
            0.05,
            (val) => {
                this.a11y.updateAuditorySettings({ musicVolume: val });
            }
        );

        // Subtitles / captions
        this.createToggle(
            container,
            'Enable Subtitles',
            'auditory.subtitleEnabled',
            settings.auditory.subtitleEnabled,
            (val) => {
                this.a11y.updateAuditorySettings({ subtitleEnabled: val });
            }
        );

        // Subtitle size
        this.createSelect(
            container,
            'Subtitle Size',
            'auditory.subtitleSize',
            settings.auditory.subtitleSize,
            ['small', 'medium', 'large'],
            (val) => {
                this.a11y.updateAuditorySettings({
                    subtitleSize: val as 'small' | 'medium' | 'large',
                });
            }
        );

        // Mono audio
        this.createToggle(
            container,
            'Mono Audio',
            'auditory.monoAudio',
            settings.auditory.monoAudio,
            (val) => {
                this.a11y.updateAuditorySettings({ monoAudio: val });
            }
        );

        // Visual sound indicators
        this.createToggle(
            container,
            'Visual Sound Indicators',
            'auditory.visualSoundIndicators',
            settings.auditory.visualSoundIndicators,
            (val) => {
                this.a11y.updateAuditorySettings({ visualSoundIndicators: val });
            }
        );
    }

    private renderScreenReaderSection(container: HTMLElement): void {
        const settings = this.a11y.getSettings();

        this.createSectionTitle(container, 'Screen Reader');
        this.createSectionSubtitle(container, 'Screen reader & announcements');

        // Enable screen reader
        this.createToggle(
            container,
            'Enable Screen Reader',
            'screenReader.enabled',
            settings.screenReader.enabled,
            (val) => {
                this.a11y.updateScreenReaderSettings({ enabled: val });
            }
        );

        // Announce events
        this.createToggle(
            container,
            'Announce Events',
            'screenReader.announceEvents',
            settings.screenReader.announceEvents,
            (val) => {
                this.a11y.updateScreenReaderSettings({ announceEvents: val });
            }
        );

        // Announce location
        this.createToggle(
            container,
            'Announce Location',
            'screenReader.announceLocation',
            settings.screenReader.announceLocation,
            (val) => {
                this.a11y.updateScreenReaderSettings({ announceLocation: val });
            }
        );

        // Announce inventory
        this.createToggle(
            container,
            'Announce Inventory',
            'screenReader.announceInventory',
            settings.screenReader.announceInventory,
            (val) => {
                this.a11y.updateScreenReaderSettings({ announceInventory: val });
            }
        );

        // Announce combat
        this.createToggle(
            container,
            'Announce Combat',
            'screenReader.announceCombat',
            settings.screenReader.announceCombat,
            (val) => {
                this.a11y.updateScreenReaderSettings({ announceCombat: val });
            }
        );
    }

    // ============================================================================
    // UI Component Factories
    // ============================================================================

    protected createSectionTitle(container: HTMLElement, title: string): void {
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.cssText = `
      margin: 0 0 8px 0;
      font-size: 1.2rem;
      color: var(--menu-heading, #fff);
      font-weight: 600;
    `;
        container.appendChild(titleEl);
    }

    protected createSectionSubtitle(container: HTMLElement, subtitle: string): void {
        const subtitleEl = document.createElement('p');
        subtitleEl.textContent = subtitle;
        subtitleEl.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 0.9rem;
      color: var(--menu-text-muted, #999);
    `;
        container.appendChild(subtitleEl);
    }

    private createToggle(
        container: HTMLElement,
        label: string,
        id: string,
        checked: boolean,
        onChange: (val: boolean) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    `;

        // ♿ Aria: Use <div> instead of <label> for custom button switches to prevent double-announcing
        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        labelEl.id = `${id}-label`;
        labelEl.style.cssText = 'flex: 1; cursor: pointer;';

        // ♿ Aria: Format custom toggles as <button type="button" role="switch" aria-checked="...">
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'a11y-button';
        toggleBtn.id = id;
        toggleBtn.setAttribute('role', 'switch');
        toggleBtn.setAttribute('aria-checked', checked.toString());
        toggleBtn.setAttribute('aria-labelledby', labelEl.id);

        // Switch styling
        toggleBtn.style.cssText = `
      width: 44px;
      height: 24px;
      cursor: pointer;
      border-radius: 12px;
      border: 2px solid var(--menu-border, #444);
      background: ${checked ? 'var(--a11y-color, #00aaff)' : 'transparent'};
      position: relative;
      padding: 0;
    `;

        // Inner thumb
        const thumb = document.createElement('div');
        thumb.style.cssText = `
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: white;
      position: absolute;
      top: 3px;
      left: ${checked ? '23px' : '3px'};
      transition: left 0.2s, background 0.2s;
    `;
        toggleBtn.appendChild(thumb);

        let isChecked = checked;
        const toggleState = (e?: Event) => {
            if (e) e.preventDefault();
            isChecked = !isChecked;

            toggleBtn.setAttribute('aria-checked', isChecked.toString());
            toggleBtn.style.background = isChecked ? 'var(--a11y-color, #00aaff)' : 'transparent';
            thumb.style.left = isChecked ? '23px' : '3px';

            onChange(isChecked);
        };

        toggleBtn.addEventListener('click', toggleState);
        labelEl.addEventListener('click', toggleState);

        wrapper.appendChild(labelEl);
        wrapper.appendChild(toggleBtn);
        container.appendChild(wrapper);
    }

    private createSlider(
        container: HTMLElement,
        label: string,
        id: string,
        value: number,
        min: number,
        max: number,
        step: number,
        onChange: (val: number) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom: 16px;';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.htmlFor = id;
        labelEl.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 500;';

        const sliderWrapper = document.createElement('div');
        sliderWrapper.style.cssText = 'display: flex; gap: 12px; align-items: center;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = id;
        slider.min = min.toString();
        slider.max = max.toString();
        slider.step = step.toString();
        slider.value = value.toString();
        slider.style.cssText = 'flex: 1;';
        slider.oninput = () => onChange(parseFloat(slider.value));

        const valueDisplay = document.createElement('span');
        valueDisplay.textContent = value.toFixed(2);
        valueDisplay.style.cssText =
            'width: 50px; text-align: right; font-size: 0.9rem; color: var(--menu-text-muted, #999);';

        slider.oninput = () => {
            const val = parseFloat(slider.value);
            valueDisplay.textContent = val.toFixed(2);
            onChange(val);
        };

        sliderWrapper.appendChild(slider);
        sliderWrapper.appendChild(valueDisplay);

        wrapper.appendChild(labelEl);
        wrapper.appendChild(sliderWrapper);
        container.appendChild(wrapper);
    }

    private createSelect(
        container: HTMLElement,
        label: string,
        id: string,
        value: string,
        options: string[],
        onChange: (val: string) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom: 16px;';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.htmlFor = id;
        labelEl.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 500;';

        const select = document.createElement('select');
        select.className = 'a11y-select';
        select.id = id;
        select.style.cssText = `
      ${this.getButtonStyle()}
      width: 100%;
      cursor: pointer;
    `;
        select.value = value;
        select.onchange = () => onChange(select.value);

        for (const option of options) {
            const optEl = document.createElement('option');
            optEl.value = option;
            optEl.textContent = option.charAt(0).toUpperCase() + option.slice(1);
            select.appendChild(optEl);
        }

        wrapper.appendChild(labelEl);
        wrapper.appendChild(select);
        container.appendChild(wrapper);
    }

    private createColorPicker(
        container: HTMLElement,
        label: string,
        id: string,
        value: string,
        onChange: (val: string) => void
    ): void {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom: 16px;';

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.htmlFor = id;
        labelEl.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 500;';

        const colorWrapper = document.createElement('div');
        colorWrapper.style.cssText = 'display: flex; gap: 12px; align-items: center;';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = id;
        colorInput.value = value;
        colorInput.style.cssText =
            'width: 50px; height: 50px; border: 1px solid var(--menu-border, #444); cursor: pointer; border-radius: 4px;';
        colorInput.onchange = () => onChange(colorInput.value);

        const textDiv = document.createElement('div');
        textDiv.style.cssText = 'flex: 1;';

        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.value = value;
        hexInput.style.cssText = `
      ${this.getButtonStyle()}
      width: 100%;
      font-family: monospace;
    `;
        hexInput.onchange = () => {
            if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) {
                colorInput.value = hexInput.value;
                onChange(hexInput.value);
            }
        };

        textDiv.appendChild(hexInput);
        colorWrapper.appendChild(colorInput);
        colorWrapper.appendChild(textDiv);

        wrapper.appendChild(labelEl);
        wrapper.appendChild(colorWrapper);
        container.appendChild(wrapper);
    }
}

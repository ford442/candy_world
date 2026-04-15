/**
 * Accessibility Menu UI for Candy World
 * Provides an accessible interface for configuring accessibility settings
 * 
 * WCAG 2.1 Compliance:
 * - 1.3.1 Info and Relationships (A) - Proper labeling
 * - 1.4.3 Contrast (AA) - Minimum 4.5:1 contrast
 * - 2.1.1 Keyboard (A) - Full keyboard navigation
 * - 2.4.6 Headings and Labels (AA) - Descriptive labels
 * - 3.3.2 Labels or Instructions (A) - Clear input labeling
 * - 4.1.2 Name, Role, Value (A) - ARIA attributes
 */

import {
  AccessibilitySystem,
  accessibilityPresets,
  getAccessibilitySystem,
  ColorBlindType,
  UIScale,
  VerbosityLevel,
  CrosshairStyle,
} from '../systems/accessibility';
import { announce, announceValueChange } from './announcer';
import { trapFocusInside } from '../utils/interaction-utils.ts';

// ============================================================================
// Menu Section Types
// ============================================================================

type MenuSection = 
  | 'presets'
  | 'motor'
  | 'visual'
  | 'cognitive'
  | 'auditory'
  | 'screenReader';

interface MenuItem {
  id: string;
  label: string;
  description?: string;
  type: 'toggle' | 'slider' | 'select' | 'button' | 'color' | 'keybind';
  section: MenuSection;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  action?: () => void;
}

// ============================================================================
// Accessibility Menu Class
// ============================================================================

export class AccessibilityMenu {
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private isOpen = false;
  private a11y: AccessibilitySystem;
  private currentSection: MenuSection = 'presets';
  private menuItems: MenuItem[] = [];
  private focusIndex = 0;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private saveButton: HTMLButtonElement | null = null;
  private releaseFocusTrap: (() => void) | null = null;

  constructor() {
    this.a11y = getAccessibilitySystem();
    this.boundKeyHandler = this.handleKeyDown.bind(this);
  }

  // ============================================================================
  // Menu Creation
  // ============================================================================

  open(): void {
    if (this.isOpen) return;
    
    this.createMenu();
    this.isOpen = true;
    document.addEventListener('keydown', this.boundKeyHandler);
    
    // Trap focus
    if (this.container) {
      this.releaseFocusTrap = trapFocusInside(this.container);
      announce('Accessibility menu opened. Use Tab to navigate, Enter to select.', 'polite');
    }

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) openA11yBtn.setAttribute('aria-expanded', 'true');
    const a11yMenuButton = document.getElementById('a11y-menu-button');
    if (a11yMenuButton) a11yMenuButton.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    if (!this.isOpen) return;

    // Release focus
    if (this.releaseFocusTrap) {
      this.releaseFocusTrap();
      this.releaseFocusTrap = null;
    }

    // Remove elements
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    document.removeEventListener('keydown', this.boundKeyHandler);
    this.isOpen = false;
    this.container = null;
    this.overlay = null;

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) openA11yBtn.setAttribute('aria-expanded', 'false');
    const a11yMenuButton = document.getElementById('a11y-menu-button');
    if (a11yMenuButton) a11yMenuButton.setAttribute('aria-expanded', 'false');
    
    announce('Accessibility menu closed', 'polite');
  }

  private createMenu(): void {
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
    `;

    // Create menu container
    this.container = document.createElement('div');
    this.container.className = 'a11y-menu-container';
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-modal', 'true');
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
    `;

    this.container.appendChild(this.createHeader());
    this.container.appendChild(this.createContent());
    this.container.appendChild(this.createFooter());

    this.overlay.appendChild(this.container);
    document.body.appendChild(this.overlay);
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
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<span aria-hidden="true">✕</span>';
    closeBtn.setAttribute('aria-label', 'Close accessibility menu');
    closeBtn.title = 'Close accessibility menu (Escape)';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: var(--menu-text, #fff);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 8px;
      border-radius: 4px;
    `;
    closeBtn.addEventListener('click', () => this.close());
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'var(--menu-hover, #444)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'none';
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    return header;
  }

  private createContent(): HTMLElement {
    const content = document.createElement('div');
    content.style.cssText = `
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 400px;
    `;

    content.appendChild(this.createSidebar());
    content.appendChild(this.createMainPanel());

    return content;
  }

  private createSidebar(): HTMLElement {
    const sidebar = document.createElement('nav');
    sidebar.setAttribute('aria-label', 'Settings categories');
    sidebar.setAttribute('role', 'tablist');
    sidebar.style.cssText = `
      width: 200px;
      background: var(--menu-sidebar, #1a1a1a);
      border-right: 1px solid var(--menu-border, #444);
      padding: 10px 0;
      overflow-y: auto;
    `;

    const sections: { id: MenuSection; label: string }[] = [
      { id: 'presets', label: 'Presets' },
      { id: 'motor', label: 'Motor' },
      { id: 'visual', label: 'Visual' },
      { id: 'cognitive', label: 'Cognitive' },
      { id: 'auditory', label: 'Auditory' },
      { id: 'screenReader', label: 'Screen Reader' },
    ];

    sections.forEach(section => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = section.label;
      btn.id = `tab-${section.id}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', (section.id === this.currentSection).toString());
      btn.setAttribute('aria-controls', `panel-${section.id}`);
      btn.style.cssText = `
        width: 100%;
        padding: 12px 20px;
        text-align: left;
        background: ${section.id === this.currentSection ? 'var(--menu-active, #4a4a4a)' : 'transparent'};
        border: none;
        color: var(--menu-text, #fff);
        cursor: pointer;
        font-size: 1rem;
        transition: background 0.2s;
      `;
      
      btn.addEventListener('click', () => this.switchSection(section.id));
      btn.addEventListener('mouseenter', () => {
        if (section.id !== this.currentSection) {
          btn.style.background = 'var(--menu-hover, #333)';
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (section.id !== this.currentSection) {
          btn.style.background = 'transparent';
        }
      });

      sidebar.appendChild(btn);
    });

    return sidebar;
  }

  private createMainPanel(): HTMLElement {
    const panel = document.createElement('main');
    panel.setAttribute('role', 'tabpanel');
    panel.id = `panel-${this.currentSection}`;
    panel.setAttribute('aria-labelledby', `tab-${this.currentSection}`);
    panel.style.cssText = `
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    `;

    this.renderSection(panel, this.currentSection);

    return panel;
  }

  private createFooter(): HTMLElement {
    const footer = document.createElement('footer');
    footer.style.cssText = `
      padding: 20px;
      border-top: 1px solid var(--menu-border, #444);
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    `;

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.style.cssText = this.getButtonStyle('#666');
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all accessibility settings to default?')) {
        this.a11y.resetToDefaults();
        announce('Settings reset to defaults', 'polite');
        this.refreshMainPanel();
      }
    });

    this.saveButton = document.createElement('button');
    this.saveButton.type = 'button';
    this.saveButton.textContent = 'Save & Close';
    this.saveButton.style.cssText = this.getButtonStyle('#4CAF50');
    this.saveButton.addEventListener('click', () => {
      announce('Settings saved', 'polite');
      this.close();
    });

    footer.appendChild(resetBtn);
    footer.appendChild(this.saveButton);

    return footer;
  }

  private getButtonStyle(bgColor: string): string {
    return `
      padding: 10px 20px;
      background: ${bgColor};
      border: none;
      border-radius: 6px;
      color: white;
      font-size: 1rem;
      cursor: pointer;
      transition: filter 0.2s;
    `;
  }

  // ============================================================================
  // Section Rendering
  // ============================================================================

  private renderSection(container: HTMLElement, section: MenuSection): void {
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
      case 'screenReader':
        this.renderScreenReaderSection(container);
        break;
    }
  }

  private renderPresetsSection(container: HTMLElement): void {
    const title = document.createElement('h3');
    title.textContent = 'Quick Presets';
    title.style.cssText = 'margin-top: 0;';
    container.appendChild(title);

    const description = document.createElement('p');
    description.textContent = 'Choose a preset to quickly configure accessibility settings for your needs.';
    description.style.cssText = 'color: var(--menu-muted, #aaa); margin-bottom: 20px;';
    container.appendChild(description);

    const presetsGrid = document.createElement('div');
    presetsGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
    `;

    Object.entries(accessibilityPresets).forEach(([key, preset]) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.style.cssText = `
        padding: 20px;
        background: var(--menu-card, #333);
        border: 2px solid var(--menu-border, #444);
        border-radius: 8px;
        text-align: left;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--menu-text, #fff);
      `;
      
      card.addEventListener('mouseenter', () => {
        card.style.borderColor = 'var(--menu-accent, #4CAF50)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'var(--menu-border, #444)';
      });
      card.addEventListener('click', () => {
        this.a11y.applyPreset(key);
        this.highlightActiveCard(presetsGrid, card);
        announce(`Applied ${preset.name} preset`, 'polite');
      });

      const name = document.createElement('div');
      name.textContent = preset.name;
      name.style.cssText = 'font-weight: bold; font-size: 1.1rem; margin-bottom: 8px;';

      const desc = document.createElement('div');
      desc.textContent = preset.description;
      desc.style.cssText = 'color: var(--menu-muted, #aaa); font-size: 0.9rem;';

      card.appendChild(name);
      card.appendChild(desc);
      presetsGrid.appendChild(card);
    });

    container.appendChild(presetsGrid);
  }

  private highlightActiveCard(grid: HTMLElement, activeCard: HTMLElement): void {
    Array.from(grid.children).forEach(card => {
      (card as HTMLElement).style.borderColor = 'var(--menu-border, #444)';
    });
    activeCard.style.borderColor = 'var(--menu-accent, #4CAF50)';
  }

  private renderMotorSection(container: HTMLElement): void {
    const settings = this.a11y.getSettings().input;

    this.createSectionTitle(container, 'Motor Accessibility', 
      'Settings for players with motor impairments or limited mobility.');

    this.createToggle(container, 'Toggle Sprint', 
      'Press once to sprint, press again to stop (instead of holding)', 
      settings.sprintToggle, 
      (value) => this.a11y.updateInputSettings({ sprintToggle: value }));

    this.createToggle(container, 'Sticky Keys', 
      'Press modifier keys once to lock them (Shift, Ctrl, Alt)', 
      settings.stickyKeys, 
      (value) => this.a11y.updateInputSettings({ stickyKeys: value }));

    this.createSlider(container, 'Mouse Sensitivity', 
      'Adjust cursor/camera movement speed', 
      settings.sensitivity, 0.1, 2.0, 0.1, 
      (value) => this.a11y.updateInputSettings({ sensitivity: value }));

    this.createToggle(container, 'Reduced Input Latency', 
      'Reduce delay between input and response (may increase CPU usage)', 
      settings.reducedLatency, 
      (value) => this.a11y.updateInputSettings({ reducedLatency: value }));

    this.createToggle(container, 'Gamepad Vibration', 
      'Enable controller haptic feedback', 
      settings.gamepadVibration, 
      (value) => this.a11y.updateInputSettings({ gamepadVibration: value }));

    this.createSlider(container, 'Gamepad Sensitivity', 
      'Adjust gamepad stick sensitivity', 
      settings.gamepadSensitivity, 0.1, 2.0, 0.1, 
      (value) => this.a11y.updateInputSettings({ gamepadSensitivity: value }));

    // Keybindings section
    const keybindTitle = document.createElement('h4');
    keybindTitle.textContent = 'Keybindings';
    keybindTitle.style.cssText = 'margin-top: 30px; margin-bottom: 15px;';
    container.appendChild(keybindTitle);

    const keybindNote = document.createElement('p');
    keybindNote.textContent = 'Click a keybinding to change it. Press Escape to cancel.';
    keybindNote.style.cssText = 'color: var(--menu-muted, #aaa); font-size: 0.9rem; margin-bottom: 15px;';
    container.appendChild(keybindNote);

    const keybindsList = document.createElement('div');
    keybindsList.style.cssText = `
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      max-width: 400px;
    `;

    settings.keybindings.forEach((binding, action) => {
      const label = document.createElement('div');
      label.textContent = this.formatActionName(action);
      label.style.cssText = 'padding: 8px 0;';

      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      const keyText = binding.gamepadButton !== undefined 
        ? `${binding.key} / Pad ${binding.gamepadButton}`
        : binding.key;
      keyBtn.textContent = keyText;
      keyBtn.style.cssText = `
        padding: 8px 16px;
        background: var(--menu-card, #333);
        border: 1px solid var(--menu-border, #444);
        border-radius: 4px;
        color: var(--menu-text, #fff);
        cursor: pointer;
        min-width: 120px;
      `;

      keyBtn.addEventListener('click', () => this.startKeyRebind(action, keyBtn));

      keybindsList.appendChild(label);
      keybindsList.appendChild(keyBtn);
    });

    container.appendChild(keybindsList);
  }

  private renderVisualSection(container: HTMLElement): void {
    const settings = this.a11y.getSettings().visual;

    this.createSectionTitle(container, 'Visual Accessibility', 
      'Settings for players with visual impairments or color vision differences.');

    // Color blind mode
    this.createSelect(container, 'Color Blind Mode', 
      'Adjust colors for different types of color vision', 
      settings.colorBlindMode, [
        { value: 'none', label: 'None' },
        { value: 'protanopia', label: 'Protanopia (Red-blind)' },
        { value: 'deuteranopia', label: 'Deuteranopia (Green-blind)' },
        { value: 'tritanopia', label: 'Tritanopia (Blue-blind)' },
        { value: 'achromatopsia', label: 'Achromatopsia (No color)' },
      ], (value) => {
        this.a11y.updateVisualSettings({ colorBlindMode: value as ColorBlindType });
      });

    this.createToggle(container, 'High Contrast Mode', 
      'Increase contrast for better visibility', 
      settings.highContrast, 
      (value) => this.a11y.updateVisualSettings({ highContrast: value }));

    this.createSlider(container, 'UI Scale', 
      'Adjust the size of user interface elements', 
      settings.uiScale, 0.75, 2.0, 0.25, 
      (value) => this.a11y.updateVisualSettings({ uiScale: value as UIScale }));

    this.createSlider(container, 'Brightness', 
      'Adjust overall brightness', 
      settings.brightness, 0.5, 1.5, 0.1, 
      (value) => this.a11y.updateVisualSettings({ brightness: value }));

    this.createToggle(container, 'Motion Reduction', 
      'Reduce or disable animations and motion effects', 
      settings.motionReduction, 
      (value) => this.a11y.updateVisualSettings({ motionReduction: value }));

    this.createToggle(container, 'Screen Shake', 
      'Enable camera shake effects', 
      settings.screenShake, 
      (value) => this.a11y.updateVisualSettings({ screenShake: value }));

    this.createToggle(container, 'Camera Bob', 
      'Enable head bobbing while walking', 
      settings.cameraBob, 
      (value) => this.a11y.updateVisualSettings({ cameraBob: value }));

    this.createToggle(container, 'Particle Effects', 
      'Show particle effects (sparkles, dust, etc.)', 
      settings.particleEffects, 
      (value) => this.a11y.updateVisualSettings({ particleEffects: value }));

    this.createToggle(container, 'Outline Mode', 
      'Add outlines to interactive objects', 
      settings.outlineMode, 
      (value) => this.a11y.updateVisualSettings({ outlineMode: value }));

    this.createColorPicker(container, 'Outline Color', 
      'Color for interactive object outlines', 
      settings.outlineColor, 
      (value) => this.a11y.updateVisualSettings({ outlineColor: value }));

    // Crosshair settings
    this.createSectionSubtitle(container, 'Crosshair');

    this.createSelect(container, 'Crosshair Style', 
      'Choose your preferred crosshair style', 
      settings.crosshairStyle, [
        { value: 'default', label: 'Default' },
        { value: 'dot', label: 'Dot' },
        { value: 'cross', label: 'Cross' },
        { value: 'circle', label: 'Circle' },
        { value: 'brackets', label: 'Brackets' },
      ], (value) => {
        this.a11y.updateVisualSettings({ crosshairStyle: value as CrosshairStyle });
      });

    this.createSlider(container, 'Crosshair Size', 
      'Adjust crosshair size', 
      settings.crosshairSize, 0.5, 2.0, 0.1, 
      (value) => this.a11y.updateVisualSettings({ crosshairSize: value }));

    this.createColorPicker(container, 'Crosshair Color', 
      'Customize crosshair color', 
      settings.crosshairColor, 
      (value) => this.a11y.updateVisualSettings({ crosshairColor: value }));
  }

  private renderCognitiveSection(container: HTMLElement): void {
    const settings = this.a11y.getSettings().cognitive;

    this.createSectionTitle(container, 'Cognitive Accessibility', 
      'Settings to reduce cognitive load and improve focus.');

    this.createToggle(container, 'Distraction-Free Mode', 
      'Hide ambient animations and decorative effects', 
      settings.distractionFree, 
      (value) => this.a11y.updateCognitiveSettings({ distractionFree: value }));

    this.createToggle(container, 'Simplified UI', 
      'Show only essential UI elements', 
      settings.simplifiedUI, 
      (value) => this.a11y.updateCognitiveSettings({ simplifiedUI: value }));

    this.createToggle(container, 'Extended Timers', 
      'Increase time limits for challenges', 
      settings.extendedTimers, 
      (value) => this.a11y.updateCognitiveSettings({ extendedTimers: value }));

    if (settings.extendedTimers) {
      this.createSlider(container, 'Timer Extension', 
        'Multiplier for time limits', 
        settings.timerExtensionFactor, 1.25, 3.0, 0.25, 
        (value) => this.a11y.updateCognitiveSettings({ timerExtensionFactor: value }));
    }

    this.createToggle(container, 'Show Text Labels', 
      'Always show text labels alongside icons', 
      settings.showTextLabels, 
      (value) => this.a11y.updateCognitiveSettings({ showTextLabels: value }));

    this.createSelect(container, 'Tooltip Verbosity', 
      'How detailed should tooltips and tutorials be?', 
      settings.verbosityLevel, [
        { value: 'minimal', label: 'Minimal - Essential info only' },
        { value: 'standard', label: 'Standard - Balanced' },
        { value: 'verbose', label: 'Verbose - Detailed explanations' },
      ], (value) => {
        this.a11y.updateCognitiveSettings({ verbosityLevel: value as VerbosityLevel });
      });

    this.createToggle(container, 'Pause on Focus Lost', 
      'Automatically pause when switching to another window', 
      settings.pauseOnFocusLost, 
      (value) => this.a11y.updateCognitiveSettings({ pauseOnFocusLost: value }));

    this.createToggle(container, 'Show Tutorial Hints', 
      'Display helpful tips during gameplay', 
      settings.showTutorialHints, 
      (value) => this.a11y.updateCognitiveSettings({ showTutorialHints: value }));
  }

  private renderAuditorySection(container: HTMLElement): void {
    const settings = this.a11y.getSettings().auditory;

    this.createSectionTitle(container, 'Auditory Accessibility', 
      'Settings for players who are deaf, hard of hearing, or prefer visual audio cues.');

    // Volume sliders
    this.createSlider(container, 'Master Volume', 
      'Overall game volume', 
      settings.masterVolume, 0, 1, 0.05, 
      (value) => this.a11y.updateAuditorySettings({ masterVolume: value }));

    this.createSlider(container, 'Music Volume', 
      'Background music volume', 
      settings.musicVolume, 0, 1, 0.05, 
      (value) => this.a11y.updateAuditorySettings({ musicVolume: value }));

    this.createSlider(container, 'SFX Volume', 
      'Sound effects volume', 
      settings.sfxVolume, 0, 1, 0.05, 
      (value) => this.a11y.updateAuditorySettings({ sfxVolume: value }));

    this.createSlider(container, 'Ambient Volume', 
      'Environmental sounds volume', 
      settings.ambientVolume, 0, 1, 0.05, 
      (value) => this.a11y.updateAuditorySettings({ ambientVolume: value }));

    this.createToggle(container, 'Mono Audio', 
      'Combine all audio channels into mono', 
      settings.monoAudio, 
      (value) => this.a11y.updateAuditorySettings({ monoAudio: value }));

    this.createToggle(container, 'Visual Sound Indicators', 
      'Show on-screen indicators for important sounds', 
      settings.visualSoundIndicators, 
      (value) => this.a11y.updateAuditorySettings({ visualSoundIndicators: value }));

    this.createToggle(container, 'Directional Indicators', 
      'Show which direction sounds are coming from', 
      settings.directionalIndicators, 
      (value) => this.a11y.updateAuditorySettings({ directionalIndicators: value }));

    this.createToggle(container, 'Subtitles', 
      'Show text captions for dialogue and important sounds', 
      settings.subtitleEnabled, 
      (value) => this.a11y.updateAuditorySettings({ subtitleEnabled: value }));

    if (settings.subtitleEnabled) {
      this.createSelect(container, 'Subtitle Size', 
        'Text size for subtitles', 
        settings.subtitleSize, [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ], (value) => {
          this.a11y.updateAuditorySettings({ subtitleSize: value as 'small' | 'medium' | 'large' });
        });

      this.createToggle(container, 'Subtitle Background', 
        'Add background to subtitles for better readability', 
        settings.subtitleBackground, 
        (value) => this.a11y.updateAuditorySettings({ subtitleBackground: value }));
    }
  }

  private renderScreenReaderSection(container: HTMLElement): void {
    const settings = this.a11y.getSettings().screenReader;

    this.createSectionTitle(container, 'Screen Reader Support', 
      'Settings for players using screen readers or assistive technologies.');

    this.createToggle(container, 'Enable Screen Reader Support', 
      'Announce game events and UI changes', 
      settings.enabled, 
      (value) => this.a11y.updateScreenReaderSettings({ enabled: value }));

    if (settings.enabled) {
      this.createToggle(container, 'Announce Events', 
        'Announce important game events (discoveries, achievements)', 
        settings.announceEvents, 
        (value) => this.a11y.updateScreenReaderSettings({ announceEvents: value }));

      this.createToggle(container, 'Announce Location', 
        'Announce location changes', 
        settings.announceLocation, 
        (value) => this.a11y.updateScreenReaderSettings({ announceLocation: value }));

      this.createToggle(container, 'Announce Inventory', 
        'Announce inventory changes', 
        settings.announceInventory, 
        (value) => this.a11y.updateScreenReaderSettings({ announceInventory: value }));

      this.createToggle(container, 'Announce Combat', 
        'Announce combat actions and damage', 
        settings.announceCombat, 
        (value) => this.a11y.updateScreenReaderSettings({ announceCombat: value }));

      // Test announcement button
      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.textContent = 'Test Announcement';
      testBtn.style.cssText = `
        margin-top: 20px;
        padding: 12px 24px;
        background: var(--menu-accent, #4CAF50);
        border: none;
        border-radius: 6px;
        color: white;
        cursor: pointer;
        font-size: 1rem;
      `;
      testBtn.addEventListener('click', () => {
        announce('This is a test announcement. Screen reader support is active!', 'polite');
      });
      container.appendChild(testBtn);
    }

    // ARIA information
    const ariaInfo = document.createElement('div');
    ariaInfo.style.cssText = `
      margin-top: 30px;
      padding: 15px;
      background: var(--menu-card, #333);
      border-radius: 8px;
      font-size: 0.9rem;
    `;
    ariaInfo.innerHTML = `
      <strong>ARIA Support</strong><br><br>
      This game supports WAI-ARIA standards for accessibility:<br>
      • All interactive elements have descriptive labels<br>
      • Live regions announce important changes<br>
      • Focus is managed in menus and dialogs<br>
      • Semantic HTML elements are used throughout<br>
      <br>
      For best results, use NVDA, JAWS, or VoiceOver with your browser.
    `;
    container.appendChild(ariaInfo);
  }

  // ============================================================================
  // UI Component Helpers
  // ============================================================================

  private createSectionTitle(container: HTMLElement, title: string, description: string): void {
    const h3 = document.createElement('h3');
    h3.textContent = title;
    h3.style.cssText = 'margin-top: 0;';
    container.appendChild(h3);

    const p = document.createElement('p');
    p.textContent = description;
    p.style.cssText = 'color: var(--menu-muted, #aaa); margin-bottom: 25px;';
    container.appendChild(p);
  }

  private createSectionSubtitle(container: HTMLElement, title: string): void {
    const h4 = document.createElement('h4');
    h4.textContent = title;
    h4.style.cssText = 'margin-top: 30px; margin-bottom: 15px;';
    container.appendChild(h4);
  }

  private createToggle(
    container: HTMLElement,
    label: string,
    description: string,
    value: boolean,
    onChange: (value: boolean) => void
  ): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 0;
      border-bottom: 1px solid var(--menu-border, #444);
    `;

    const uniqueId = `toggle-${label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

    const textDiv = document.createElement('div');
    
    const labelEl = document.createElement('label');
    labelEl.id = `${uniqueId}-label`;
    labelEl.textContent = label;
    labelEl.style.cssText = 'display: block; font-weight: 500;';

    const descEl = document.createElement('span');
    descEl.id = `${uniqueId}-desc`;
    descEl.textContent = description;
    descEl.style.cssText = 'display: block; color: var(--menu-muted, #aaa); font-size: 0.9rem; margin-top: 4px;';

    textDiv.appendChild(labelEl);
    textDiv.appendChild(descEl);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', value.toString());
    toggle.setAttribute('aria-labelledby', `${uniqueId}-label`);
    toggle.setAttribute('aria-describedby', `${uniqueId}-desc`);
    toggle.style.cssText = `
      width: 50px;
      height: 26px;
      background: ${value ? '#4CAF50' : '#666'};
      border: none;
      border-radius: 13px;
      position: relative;
      cursor: pointer;
      transition: background 0.2s;
    `;

    const knob = document.createElement('span');
    knob.style.cssText = `
      position: absolute;
      top: 3px;
      left: ${value ? '27px' : '3px'};
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: left 0.2s;
    `;
    toggle.appendChild(knob);

    toggle.addEventListener('mouseenter', () => {
      const isChecked = toggle.getAttribute('aria-checked') === 'true';
      toggle.style.background = isChecked ? '#66BB6A' : '#777'; // Lighten slightly
    });

    toggle.addEventListener('mouseleave', () => {
      const isChecked = toggle.getAttribute('aria-checked') === 'true';
      toggle.style.background = isChecked ? '#4CAF50' : '#666';
    });

    toggle.addEventListener('click', () => {
      const newValue = !value;
      onChange(newValue);
      toggle.setAttribute('aria-checked', newValue.toString());
      // Trigger hover style logic immediately based on hover state
      toggle.style.background = newValue ? '#66BB6A' : '#777'; // Still hovering when clicked
      knob.style.left = newValue ? '27px' : '3px';
      announce(`${label} ${newValue ? 'enabled' : 'disabled'}`, 'polite');
    });

    wrapper.appendChild(textDiv);
    wrapper.appendChild(toggle);
    container.appendChild(wrapper);
  }

  private createSlider(
    container: HTMLElement,
    label: string,
    description: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
  ): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      padding: 15px 0;
      border-bottom: 1px solid var(--menu-border, #444);
    `;

    const uniqueId = `slider-${label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 8px;';

    const labelEl = document.createElement('label');
    labelEl.htmlFor = uniqueId;
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-weight: 500;';

    const valueEl = document.createElement('span');
    valueEl.textContent = value.toFixed(step < 1 ? 1 : 0);
    valueEl.style.cssText = 'color: var(--menu-muted, #aaa);';

    header.appendChild(labelEl);
    header.appendChild(valueEl);

    const descEl = document.createElement('div');
    descEl.id = `${uniqueId}-desc`;
    descEl.textContent = description;
    descEl.style.cssText = 'color: var(--menu-muted, #aaa); font-size: 0.9rem; margin-bottom: 10px;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = uniqueId;
    slider.setAttribute('aria-describedby', `${uniqueId}-desc`);
    slider.min = min.toString();
    slider.max = max.toString();
    slider.step = step.toString();
    slider.value = value.toString();
    slider.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    slider.addEventListener('input', () => {
      const newValue = parseFloat(slider.value);
      valueEl.textContent = newValue.toFixed(step < 1 ? 1 : 0);
      onChange(newValue);
    });

    slider.addEventListener('change', () => {
      announceValueChange(label, parseFloat(slider.value), min, max);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(descEl);
    wrapper.appendChild(slider);
    container.appendChild(wrapper);
  }

  private createSelect(
    container: HTMLElement,
    label: string,
    description: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void
  ): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      padding: 15px 0;
      border-bottom: 1px solid var(--menu-border, #444);
    `;

    const uniqueId = `select-${label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

    const labelEl = document.createElement('label');
    labelEl.htmlFor = uniqueId;
    labelEl.textContent = label;
    labelEl.style.cssText = 'display: block; font-weight: 500; margin-bottom: 4px;';

    const descEl = document.createElement('div');
    descEl.id = `${uniqueId}-desc`;
    descEl.textContent = description;
    descEl.style.cssText = 'color: var(--menu-muted, #aaa); font-size: 0.9rem; margin-bottom: 10px;';

    const select = document.createElement('select');
    select.id = uniqueId;
    select.setAttribute('aria-describedby', `${uniqueId}-desc`);
    select.style.cssText = `
      width: 100%;
      padding: 10px;
      background: var(--menu-card, #333);
      border: 1px solid var(--menu-border, #444);
      border-radius: 6px;
      color: var(--menu-text, #fff);
      font-size: 1rem;
      cursor: pointer;
    `;

    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = opt.value === value;
      select.appendChild(option);
    });

    select.addEventListener('change', () => {
      onChange(select.value);
      const selected = options.find(o => o.value === select.value);
      announce(`${label} set to ${selected?.label || select.value}`, 'polite');
    });

    wrapper.appendChild(labelEl);
    wrapper.appendChild(descEl);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  }

  private createColorPicker(
    container: HTMLElement,
    label: string,
    description: string,
    value: string,
    onChange: (value: string) => void
  ): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px 0;
      border-bottom: 1px solid var(--menu-border, #444);
    `;

    const uniqueId = `color-${label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

    const textDiv = document.createElement('div');
    
    const labelEl = document.createElement('label');
    labelEl.id = `${uniqueId}-label`;
    labelEl.htmlFor = uniqueId;
    labelEl.textContent = label;
    labelEl.style.cssText = 'display: block; font-weight: 500;';

    const descEl = document.createElement('span');
    descEl.id = `${uniqueId}-desc`;
    descEl.textContent = description;
    descEl.style.cssText = 'display: block; color: var(--menu-muted, #aaa); font-size: 0.9rem; margin-top: 4px;';

    textDiv.appendChild(labelEl);
    textDiv.appendChild(descEl);

    const colorWrapper = document.createElement('div');
    colorWrapper.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = uniqueId;
    colorInput.setAttribute('aria-describedby', `${uniqueId}-desc`);
    colorInput.value = value;
    colorInput.style.cssText = `
      width: 50px;
      height: 35px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.id = `${uniqueId}-hex`;
    hexInput.setAttribute('aria-label', `Hex value for ${label}`);
    hexInput.value = value;
    hexInput.style.cssText = `
      width: 80px;
      padding: 8px;
      background: var(--menu-card, #333);
      border: 1px solid var(--menu-border, #444);
      border-radius: 4px;
      color: var(--menu-text, #fff);
      font-family: monospace;
    `;

    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      onChange(colorInput.value);
    });

    hexInput.addEventListener('change', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) {
        colorInput.value = hexInput.value;
        onChange(hexInput.value);
      }
    });

    colorWrapper.appendChild(colorInput);
    colorWrapper.appendChild(hexInput);

    wrapper.appendChild(textDiv);
    wrapper.appendChild(colorWrapper);
    container.appendChild(wrapper);
  }

  // ============================================================================
  // Keyboard Navigation
  // ============================================================================

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      event.preventDefault();
    }
  }

  private startKeyRebind(action: string, button: HTMLButtonElement): void {
    button.textContent = 'Press key...';
    button.style.background = 'var(--menu-active, #4a4a4a)';
    
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      
      if (e.key === 'Escape') {
        button.textContent = 'Cancelled';
        setTimeout(() => this.refreshMainPanel(), 500);
      } else {
        // Update keybinding
        const keybindings = new Map(this.a11y.getSettings().input.keybindings);
        const existing = keybindings.get(action);
        if (existing) {
          keybindings.set(action, { ...existing, key: e.key });
          this.a11y.updateInputSettings({ keybindings });
        }
        button.textContent = `Set to ${e.key}`;
        announce(`${this.formatActionName(action)} bound to ${e.key}`, 'polite');
        setTimeout(() => this.refreshMainPanel(), 500);
      }
      
      document.removeEventListener('keydown', handler);
    };

    document.addEventListener('keydown', handler);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private formatActionName(action: string): string {
    return action
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  private switchSection(section: MenuSection): void {
    this.currentSection = section;
    this.refreshMainPanel();
    announce(`Switched to ${this.formatActionName(section)} settings`, 'polite');
  }

  private refreshMainPanel(): void {
    const main = this.container?.querySelector('main');
    if (main) {
      main.id = `panel-${this.currentSection}`;
      main.setAttribute('aria-labelledby', `tab-${this.currentSection}`);
      this.renderSection(main, this.currentSection);
    }
    this.updateSidebarSelection();
  }

  private updateSidebarSelection(): void {
    const sidebar = this.container?.querySelector('nav');
    if (!sidebar) return;

    const buttons = sidebar.querySelectorAll('button');
    buttons.forEach((btn, index) => {
      const sections: MenuSection[] = ['presets', 'motor', 'visual', 'cognitive', 'auditory', 'screenReader'];
      const isActive = sections[index] === this.currentSection;
      btn.setAttribute('aria-selected', isActive.toString());
      btn.style.background = isActive ? 'var(--menu-active, #4a4a4a)' : 'transparent';
    });
  }

  // ============================================================================
  // Static Helpers
  // ============================================================================

  static open(): void {
    const menu = new AccessibilityMenu();
    menu.open();
  }
}

// ============================================================================
// Export singleton and helpers
// ============================================================================

let menuInstance: AccessibilityMenu | null = null;

export function openAccessibilityMenu(): void {
  if (!menuInstance) {
    menuInstance = new AccessibilityMenu();
  }
  menuInstance.open();
}

export function closeAccessibilityMenu(): void {
  menuInstance?.close();
}

export function createAccessibilityButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = '<span aria-hidden="true">♿</span> Accessibility';
  btn.setAttribute('aria-label', 'Open accessibility settings');
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #4CAF50;
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 1rem;
    cursor: pointer;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: transform 0.2s, box-shadow 0.2s;
  `;
  
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px)';
    btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
  });
  
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateY(0)';
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  });
  
  btn.addEventListener('click', () => openAccessibilityMenu());
  
  return btn;
}

export function addAccessibilityButtonToPage(): void {
  const existing = document.getElementById('a11y-menu-button');
  if (existing) return;

  const btn = createAccessibilityButton();
  btn.id = 'a11y-menu-button';
  document.body.appendChild(btn);
}

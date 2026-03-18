/**
 * Accessibility System for Candy World
 * Makes the game playable by everyone - WCAG 2.1 AA compliant
 * 
 * Features:
 * - Motor accessibility (remappable keys, sticky keys, toggle sprint)
 * - Visual accessibility (color blind modes, UI scaling, motion reduction)
 * - Cognitive accessibility (distraction-free mode, simplified UI)
 * - Auditory accessibility (visual sound indicators, mono audio)
 * - Screen reader support (ARIA labels, announcer)
 */

import type { AnnouncementPriority } from '../ui/announcer';

// ============================================================================
// Type Definitions
// ============================================================================

export type ColorBlindType = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
export type UIScale = 0.75 | 1.0 | 1.25 | 1.5 | 2.0;
export type VerbosityLevel = 'minimal' | 'standard' | 'verbose';
export type CrosshairStyle = 'default' | 'dot' | 'cross' | 'circle' | 'brackets';

export interface Keybinding {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  gamepadButton?: number;
}

export interface InputSettings {
  keybindings: Map<string, Keybinding>;
  sensitivity: number; // 0.1 to 2.0
  sprintToggle: boolean;
  stickyKeys: boolean;
  reducedLatency: boolean;
  gamepadEnabled: boolean;
  gamepadSensitivity: number;
  gamepadVibration: boolean;
}

export interface VisualSettings {
  highContrast: boolean;
  colorBlindMode: ColorBlindType;
  uiScale: UIScale;
  screenShake: boolean;
  motionReduction: boolean;
  cameraBob: boolean;
  particleEffects: boolean;
  crosshairSize: number; // 0.5 to 2.0
  crosshairColor: string;
  crosshairStyle: CrosshairStyle;
  outlineMode: boolean;
  outlineColor: string;
  brightness: number; // 0.5 to 1.5
}

export interface CognitiveSettings {
  distractionFree: boolean;
  simplifiedUI: boolean;
  extendedTimers: boolean;
  timerExtensionFactor: number; // 1.5x, 2x, etc.
  showTextLabels: boolean;
  verbosityLevel: VerbosityLevel;
  pauseOnFocusLost: boolean;
  showTutorialHints: boolean;
}

export interface AuditorySettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  monoAudio: boolean;
  visualSoundIndicators: boolean;
  subtitleEnabled: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  subtitleBackground: boolean;
  directionalIndicators: boolean;
}

export interface ScreenReaderSettings {
  enabled: boolean;
  announceEvents: boolean;
  announceLocation: boolean;
  announceInventory: boolean;
  announceCombat: boolean;
}

export interface AccessibilitySettings {
  input: InputSettings;
  visual: VisualSettings;
  cognitive: CognitiveSettings;
  auditory: AuditorySettings;
  screenReader: ScreenReaderSettings;
}

export interface AccessibilityPreset {
  name: string;
  description: string;
  settings: Partial<AccessibilitySettings>;
}

// ============================================================================
// Default Settings
// ============================================================================

const defaultKeybindings = new Map<string, Keybinding>([
  ['moveForward', { key: 'w' }],
  ['moveBackward', { key: 's' }],
  ['moveLeft', { key: 'a' }],
  ['moveRight', { key: 'd' }],
  ['jump', { key: ' ', gamepadButton: 0 }],
  ['sprint', { key: 'Shift', gamepadButton: 10 }],
  ['crouch', { key: 'Control', gamepadButton: 11 }],
  ['interact', { key: 'e', gamepadButton: 2 }],
  ['inventory', { key: 'i', gamepadButton: 3 }],
  ['pause', { key: 'Escape', gamepadButton: 9 }],
  ['attack', { key: 'Mouse0', gamepadButton: 7 }],
  ['block', { key: 'Mouse2', gamepadButton: 6 }],
  ['useItem', { key: 'f', gamepadButton: 1 }],
  ['quickSave', { key: 'F5' }],
  ['quickLoad', { key: 'F9' }],
]);

export const defaultSettings: AccessibilitySettings = {
  input: {
    keybindings: defaultKeybindings,
    sensitivity: 1.0,
    sprintToggle: false,
    stickyKeys: false,
    reducedLatency: false,
    gamepadEnabled: true,
    gamepadSensitivity: 1.0,
    gamepadVibration: true,
  },
  visual: {
    highContrast: false,
    colorBlindMode: 'none',
    uiScale: 1.0,
    screenShake: true,
    motionReduction: false,
    cameraBob: true,
    particleEffects: true,
    crosshairSize: 1.0,
    crosshairColor: '#ffffff',
    crosshairStyle: 'default',
    outlineMode: false,
    outlineColor: '#ffff00',
    brightness: 1.0,
  },
  cognitive: {
    distractionFree: false,
    simplifiedUI: false,
    extendedTimers: false,
    timerExtensionFactor: 1.5,
    showTextLabels: true,
    verbosityLevel: 'standard',
    pauseOnFocusLost: true,
    showTutorialHints: true,
  },
  auditory: {
    masterVolume: 1.0,
    musicVolume: 0.8,
    sfxVolume: 1.0,
    ambientVolume: 0.6,
    monoAudio: false,
    visualSoundIndicators: false,
    subtitleEnabled: true,
    subtitleSize: 'medium',
    subtitleBackground: true,
    directionalIndicators: true,
  },
  screenReader: {
    enabled: false,
    announceEvents: true,
    announceLocation: false,
    announceInventory: true,
    announceCombat: true,
  },
};

// ============================================================================
// Color Blindness Matrices (for WebGL/Canvas filtering)
// Based on "Digital Video Colourmaps for Checking the Legibility of Displays by Dichromats"
// ============================================================================

export const colorBlindMatrices: Record<ColorBlindType, number[]> = {
  none: [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
  ],
  // Protanopia - missing L cones (red-blind)
  protanopia: [
    0.567, 0.433, 0.000, 0.000,
    0.558, 0.442, 0.000, 0.000,
    0.000, 0.242, 0.758, 0.000,
    0.000, 0.000, 0.000, 1.000,
  ],
  // Deuteranopia - missing M cones (green-blind)
  deuteranopia: [
    0.625, 0.375, 0.000, 0.000,
    0.700, 0.300, 0.000, 0.000,
    0.000, 0.300, 0.700, 0.000,
    0.000, 0.000, 0.000, 1.000,
  ],
  // Tritanopia - missing S cones (blue-blind)
  tritanopia: [
    0.950, 0.050, 0.000, 0.000,
    0.000, 0.433, 0.567, 0.000,
    0.000, 0.475, 0.525, 0.000,
    0.000, 0.000, 0.000, 1.000,
  ],
  // Achromatopsia - no color vision
  achromatopsia: [
    0.299, 0.587, 0.114, 0.000,
    0.299, 0.587, 0.114, 0.000,
    0.299, 0.587, 0.114, 0.000,
    0.000, 0.000, 0.000, 1.000,
  ],
};

// Verify matrices are valid (16 elements each)
export function validateColorMatrices(): boolean {
  for (const [type, matrix] of Object.entries(colorBlindMatrices)) {
    if (matrix.length !== 16) {
      console.error(`Invalid color matrix for ${type}: expected 16 elements, got ${matrix.length}`);
      return false;
    }
  }
  return true;
}

// ============================================================================
// Preset Profiles
// ============================================================================

export const accessibilityPresets: Record<string, AccessibilityPreset> = {
  default: {
    name: 'Default',
    description: 'Standard game settings suitable for most players',
    settings: {},
  },
  highContrast: {
    name: 'High Contrast',
    description: 'Enhanced visibility with high contrast colors and outlines',
    settings: {
      visual: {
        ...defaultSettings.visual,
        highContrast: true,
        outlineMode: true,
        outlineColor: '#ffff00',
        brightness: 1.2,
        crosshairColor: '#00ff00',
        crosshairSize: 1.5,
      } as VisualSettings,
      cognitive: {
        ...defaultSettings.cognitive,
        showTextLabels: true,
        simplifiedUI: true,
      } as CognitiveSettings,
    },
  },
  lowMotion: {
    name: 'Low Motion',
    description: 'Reduced animations and motion effects for vestibular sensitivities',
    settings: {
      visual: {
        ...defaultSettings.visual,
        motionReduction: true,
        cameraBob: false,
        screenShake: false,
        particleEffects: false,
      } as VisualSettings,
      cognitive: {
        ...defaultSettings.cognitive,
        distractionFree: true,
      } as CognitiveSettings,
    },
  },
  colorBlindProtanopia: {
    name: 'Protanopia Friendly',
    description: 'Optimized for red-blind color vision',
    settings: {
      visual: {
        ...defaultSettings.visual,
        colorBlindMode: 'protanopia',
        outlineMode: true,
      } as VisualSettings,
    },
  },
  colorBlindDeuteranopia: {
    name: 'Deuteranopia Friendly',
    description: 'Optimized for green-blind color vision',
    settings: {
      visual: {
        ...defaultSettings.visual,
        colorBlindMode: 'deuteranopia',
        outlineMode: true,
      } as VisualSettings,
    },
  },
  colorBlindTritanopia: {
    name: 'Tritanopia Friendly',
    description: 'Optimized for blue-blind color vision',
    settings: {
      visual: {
        ...defaultSettings.visual,
        colorBlindMode: 'tritanopia',
        outlineMode: true,
      } as VisualSettings,
    },
  },
  screenReaderOptimized: {
    name: 'Screen Reader Optimized',
    description: 'Full audio and screen reader support',
    settings: {
      screenReader: {
        ...defaultSettings.screenReader,
        enabled: true,
        announceEvents: true,
        announceLocation: true,
        announceInventory: true,
        announceCombat: true,
      } as ScreenReaderSettings,
      auditory: {
        ...defaultSettings.auditory,
        subtitleEnabled: true,
        visualSoundIndicators: true,
        directionalIndicators: true,
      } as AuditorySettings,
    },
  },
  cognitiveSupport: {
    name: 'Cognitive Support',
    description: 'Reduced distractions with extended timers and clear labels',
    settings: {
      cognitive: {
        ...defaultSettings.cognitive,
        distractionFree: true,
        simplifiedUI: true,
        extendedTimers: true,
        timerExtensionFactor: 2.0,
        showTextLabels: true,
        verbosityLevel: 'verbose',
        pauseOnFocusLost: true,
      } as CognitiveSettings,
      visual: {
        ...defaultSettings.visual,
        motionReduction: true,
        particleEffects: false,
      } as VisualSettings,
    },
  },
  motorImpairment: {
    name: 'Motor Support',
    description: 'Toggle actions and reduced input requirements',
    settings: {
      input: {
        ...defaultSettings.input,
        sprintToggle: true,
        stickyKeys: true,
        sensitivity: 0.5,
      } as InputSettings,
      cognitive: {
        ...defaultSettings.cognitive,
        extendedTimers: true,
        timerExtensionFactor: 2.0,
      } as CognitiveSettings,
    },
  },
  deaf: {
    name: 'Deaf/HoH Friendly',
    description: 'Full visual representation of audio information',
    settings: {
      auditory: {
        ...defaultSettings.auditory,
        visualSoundIndicators: true,
        subtitleEnabled: true,
        subtitleSize: 'large',
        subtitleBackground: true,
        directionalIndicators: true,
      } as AuditorySettings,
    },
  },
};

// ============================================================================
// Accessibility System Class
// ============================================================================

export class AccessibilitySystem {
  private settings: AccessibilitySettings;
  private listeners: Set<(settings: AccessibilitySettings) => void> = new Set();
  private stickyKeysState: Map<string, boolean> = new Map();
  private lastStickyKeyTime: number = 0;
  private readonly STICKY_KEYS_TIMEOUT = 2000; // ms

  // CSS custom property names
  private readonly CSS_VARS = {
    uiScale: '--a11y-ui-scale',
    brightness: '--a11y-brightness',
    contrast: '--a11y-contrast',
    crosshairColor: '--a11y-crosshair-color',
    crosshairSize: '--a11y-crosshair-size',
    outlineColor: '--a11y-outline-color',
  };

  constructor() {
    this.settings = this.loadSettings();
    this.applySettings();
    this.setupFocusManagement();
    this.setupKeyboardNavigation();
  }

  // ============================================================================
  // Settings Management
  // ============================================================================

  getSettings(): AccessibilitySettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<AccessibilitySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  updateInputSettings(settings: Partial<InputSettings>): void {
    this.settings.input = { ...this.settings.input, ...settings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  updateVisualSettings(settings: Partial<VisualSettings>): void {
    this.settings.visual = { ...this.settings.visual, ...settings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  updateCognitiveSettings(settings: Partial<CognitiveSettings>): void {
    this.settings.cognitive = { ...this.settings.cognitive, ...settings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  updateAuditorySettings(settings: Partial<AuditorySettings>): void {
    this.settings.auditory = { ...this.settings.auditory, ...settings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  updateScreenReaderSettings(settings: Partial<ScreenReaderSettings>): void {
    this.settings.screenReader = { ...this.settings.screenReader, ...settings };
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  applyPreset(presetName: string): void {
    const preset = accessibilityPresets[presetName];
    if (!preset) {
      console.warn(`Unknown accessibility preset: ${presetName}`);
      return;
    }

    // Deep merge preset settings with defaults
    const newSettings: AccessibilitySettings = {
      input: { ...defaultSettings.input, ...(preset.settings.input || {}) },
      visual: { ...defaultSettings.visual, ...(preset.settings.visual || {}) },
      cognitive: { ...defaultSettings.cognitive, ...(preset.settings.cognitive || {}) },
      auditory: { ...defaultSettings.auditory, ...(preset.settings.auditory || {}) },
      screenReader: { ...defaultSettings.screenReader, ...(preset.settings.screenReader || {}) },
    };

    this.settings = newSettings;
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();

    // Announce preset application
    this.announce(`Applied ${preset.name} preset`, 'polite');
  }

  resetToDefaults(): void {
    this.settings = JSON.parse(JSON.stringify(defaultSettings));
    // Restore keybindings as Map
    this.settings.input.keybindings = new Map(defaultKeybindings);
    this.saveSettings();
    this.applySettings();
    this.notifyListeners();
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private readonly STORAGE_KEY = 'candy_world_accessibility';

  private loadSettings(): AccessibilitySettings {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restore keybindings as Map
        if (parsed.input?.keybindings) {
          parsed.input.keybindings = new Map(Object.entries(parsed.input.keybindings));
        }
        return { ...defaultSettings, ...parsed };
      }
    } catch (e) {
      console.error('Failed to load accessibility settings:', e);
    }
    return JSON.parse(JSON.stringify(defaultSettings));
  }

  private saveSettings(): void {
    try {
      const settingsToSave = {
        ...this.settings,
        input: {
          ...this.settings.input,
          keybindings: Object.fromEntries(this.settings.input.keybindings),
        },
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settingsToSave));
    } catch (e) {
      console.error('Failed to save accessibility settings:', e);
    }
  }

  // ============================================================================
  // Settings Application
  // ============================================================================

  private applySettings(): void {
    this.applyVisualSettings();
    this.applyCSSVariables();
    this.applyAudioSettings();
  }

  private applyVisualSettings(): void {
    const { visual } = this.settings;

    // Apply high contrast mode
    document.body.classList.toggle('a11y-high-contrast', visual.highContrast);
    
    // Apply motion reduction
    document.body.classList.toggle('a11y-motion-reduced', visual.motionReduction);
    document.body.classList.toggle('a11y-camera-bob-disabled', !visual.cameraBob);
    
    // Apply outline mode
    document.body.classList.toggle('a11y-outline-mode', visual.outlineMode);
    
    // Apply simplified UI
    document.body.classList.toggle('a11y-simplified-ui', this.settings.cognitive.simplifiedUI);
    
    // Apply distraction-free mode
    document.body.classList.toggle('a11y-distraction-free', this.settings.cognitive.distractionFree);

    // Apply color blind filter
    this.applyColorBlindMode(visual.colorBlindMode);
  }

  private applyCSSVariables(): void {
    const root = document.documentElement;
    const { visual } = this.settings;

    root.style.setProperty(this.CSS_VARS.uiScale, visual.uiScale.toString());
    root.style.setProperty(this.CSS_VARS.brightness, visual.brightness.toString());
    root.style.setProperty(this.CSS_VARS.contrast, visual.highContrast ? '1.5' : '1');
    root.style.setProperty(this.CSS_VARS.crosshairColor, visual.crosshairColor);
    root.style.setProperty(this.CSS_VARS.crosshairSize, visual.crosshairSize.toString());
    root.style.setProperty(this.CSS_VARS.outlineColor, visual.outlineColor);
  }

  private applyAudioSettings(): void {
    // Audio settings are applied when sounds are played
    // This method ensures the settings are available for the audio system
  }

  // ============================================================================
  // Color Blind Mode
  // ============================================================================

  applyColorBlindMode(type: ColorBlindType): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    // Remove existing filters
    canvas.style.filter = '';

    if (type === 'none') return;

    // Apply SVG filter for color blindness simulation/correction
    const filterId = `a11y-color-blind-${type}`;
    let filter = document.getElementById(filterId) as SVGFilterElement | null;

    if (!filter) {
      filter = this.createColorBlindFilter(type);
    }

    canvas.style.filter = `url(#${filterId})`;
  }

  private createColorBlindFilter(type: ColorBlindType): SVGFilterElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position: absolute; width: 0; height: 0;');
    
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter') as SVGFilterElement;
    filter.id = `a11y-color-blind-${type}`;
    
    const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', colorBlindMatrices[type].join(' '));
    
    filter.appendChild(matrix);
    svg.appendChild(filter);
    document.body.appendChild(svg);
    
    return filter;
  }

  // ============================================================================
  // Motion Reduction
  // ============================================================================

  setMotionReduction(enabled: boolean): void {
    this.updateVisualSettings({ motionReduction: enabled });
  }

  getMotionReduction(): boolean {
    return this.settings.visual.motionReduction;
  }

  shouldReduceMotion(): boolean {
    // Check both user preference and system preference
    return this.settings.visual.motionReduction || 
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ============================================================================
  // Input Handling
  // ============================================================================

  processInput(action: string, keyEvent?: KeyboardEvent): boolean {
    const keybinding = this.settings.input.keybindings.get(action);
    if (!keybinding) return false;

    // Handle sticky keys
    if (this.settings.input.stickyKeys && keyEvent) {
      return this.processStickyKey(action, keyEvent);
    }

    return true;
  }

  private processStickyKey(action: string, event: KeyboardEvent): boolean {
    const now = Date.now();
    
    // Reset sticky keys after timeout
    if (now - this.lastStickyKeyTime > this.STICKY_KEYS_TIMEOUT) {
      this.stickyKeysState.clear();
    }

    // Toggle sticky state for modifier keys
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      const isActive = this.stickyKeysState.get(event.key) || false;
      this.stickyKeysState.set(event.key, !isActive);
      this.lastStickyKeyTime = now;
      
      // Provide visual/audio feedback
      this.announce(`${event.key} ${!isActive ? 'locked' : 'unlocked'}`, 'polite');
      return false;
    }

    // Apply sticky modifiers
    const stickyShift = this.stickyKeysState.get('Shift') || false;
    const stickyCtrl = this.stickyKeysState.get('Control') || false;
    const stickyAlt = this.stickyKeysState.get('Alt') || false;

    // Check if action matches with sticky modifiers
    const kb = this.settings.input.keybindings.get(action);
    if (!kb) return false;

    const matches = kb.key === event.key &&
                   (!!kb.shift === (event.shiftKey || stickyShift)) &&
                   (!!kb.ctrl === (event.ctrlKey || stickyCtrl)) &&
                   (!!kb.alt === (event.altKey || stickyAlt));

    if (matches) {
      // Clear sticky modifiers after use (unless locked)
      this.stickyKeysState.forEach((locked, key) => {
        if (!locked) this.stickyKeysState.delete(key);
      });
    }

    return matches;
  }

  isSprintToggled(): boolean {
    return this.settings.input.sprintToggle;
  }

  getInputSensitivity(): number {
    return this.settings.input.sensitivity;
  }

  // ============================================================================
  // Volume Control
  // ============================================================================

  getEffectiveVolume(type: 'master' | 'music' | 'sfx' | 'ambient'): number {
    const { auditory } = this.settings;
    const master = auditory.masterVolume;
    
    switch (type) {
      case 'master': return master;
      case 'music': return master * auditory.musicVolume;
      case 'sfx': return master * auditory.sfxVolume;
      case 'ambient': return master * auditory.ambientVolume;
      default: return master;
    }
  }

  isMonoAudio(): boolean {
    return this.settings.auditory.monoAudio;
  }

  // ============================================================================
  // Screen Reader / Announcer
  // ============================================================================

  announce(message: string, priority: AnnouncementPriority = 'polite'): void {
    if (!this.settings.screenReader.enabled && priority === 'polite') {
      return; // Only announce if screen reader is enabled, except for assertive
    }

    // Dispatch custom event for announcer
    const event = new CustomEvent('a11y-announce', {
      detail: { message, priority },
    });
    document.dispatchEvent(event);

    // Also try to use the announcer directly if imported
    const announcer = document.getElementById('a11y-announcer');
    if (announcer) {
      announcer.setAttribute('aria-live', priority === 'assertive' ? 'assertive' : 'polite');
      announcer.textContent = message;
    }
  }

  // ============================================================================
  // Cognitive Support
  // ============================================================================

  getTimerExtensionFactor(): number {
    return this.settings.cognitive.extendedTimers 
      ? this.settings.cognitive.timerExtensionFactor 
      : 1.0;
  }

  getVerbosityLevel(): VerbosityLevel {
    return this.settings.cognitive.verbosityLevel;
  }

  shouldShowTutorialHints(): boolean {
    return this.settings.cognitive.showTutorialHints;
  }

  // ============================================================================
  // UI Helper Methods
  // ============================================================================

  getUIScale(): UIScale {
    return this.settings.visual.uiScale;
  }

  shouldPauseOnFocusLost(): boolean {
    return this.settings.cognitive.pauseOnFocusLost;
  }

  // ============================================================================
  // Focus Management
  // ============================================================================

  private setupFocusManagement(): void {
    // Track focus for menu navigation
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      if (target) {
        target.setAttribute('data-a11y-focused', 'true');
      }
    });

    document.addEventListener('focusout', (e) => {
      const target = e.target as HTMLElement;
      if (target) {
        target.removeAttribute('data-a11y-focused');
      }
    });
  }

  private setupKeyboardNavigation(): void {
    // Enable focus trapping in modals/menus
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        this.handleTabNavigation(e);
      }
    });
  }

  private handleTabNavigation(event: KeyboardEvent): void {
    const modal = document.querySelector('[data-a11y-trap-focus="true"]') as HTMLElement;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
    const activeElement = document.activeElement as HTMLElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  trapFocus(element: HTMLElement): void {
    element.setAttribute('data-a11y-trap-focus', 'true');
    // Focus first focusable element
    const firstFocusable = element.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ) as HTMLElement;
    if (firstFocusable) {
      firstFocusable.focus();
    }
  }

  releaseFocus(element: HTMLElement): void {
    element.removeAttribute('data-a11y-trap-focus');
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  addListener(callback: (settings: AccessibilitySettings) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback(this.settings);
      } catch (e) {
        console.error('Accessibility listener error:', e);
      }
    });
  }

  // ============================================================================
  // Visual Sound Indicators
  // ============================================================================

  showVisualSoundIndicator(direction: number, distance: number, type: string): void {
    if (!this.settings.auditory.visualSoundIndicators) return;

    const event = new CustomEvent('a11y-sound-indicator', {
      detail: { direction, distance, type },
    });
    document.dispatchEvent(event);
  }

  // ============================================================================
  // Subtitle System
  // ============================================================================

  showSubtitle(text: string, speaker?: string, duration?: number): void {
    if (!this.settings.auditory.subtitleEnabled) return;

    const event = new CustomEvent('a11y-subtitle', {
      detail: { 
        text, 
        speaker, 
        duration: duration || 3000,
        size: this.settings.auditory.subtitleSize,
        background: this.settings.auditory.subtitleBackground,
      },
    });
    document.dispatchEvent(event);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  destroy(): void {
    this.listeners.clear();
    this.stickyKeysState.clear();
    
    // Remove CSS classes
    document.body.classList.remove(
      'a11y-high-contrast',
      'a11y-motion-reduced',
      'a11y-camera-bob-disabled',
      'a11y-outline-mode',
      'a11y-simplified-ui',
      'a11y-distraction-free'
    );
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let accessibilitySystem: AccessibilitySystem | null = null;

export function getAccessibilitySystem(): AccessibilitySystem {
  if (!accessibilitySystem) {
    accessibilitySystem = new AccessibilitySystem();
  }
  return accessibilitySystem;
}

export function initAccessibilitySystem(): AccessibilitySystem {
  return getAccessibilitySystem();
}

// ============================================================================
// Helper Functions
// ============================================================================

export function applyColorBlindMode(type: ColorBlindType): void {
  getAccessibilitySystem().applyColorBlindMode(type);
}

export function setMotionReduction(enabled: boolean): void {
  getAccessibilitySystem().setMotionReduction(enabled);
}

export function announce(message: string, priority: AnnouncementPriority = 'polite'): void {
  getAccessibilitySystem().announce(message, priority);
}

export function getCurrentSettings(): AccessibilitySettings {
  return getAccessibilitySystem().getSettings();
}

// Re-export types
export { AnnouncementPriority };

// Validate color matrices on module load
if (typeof window !== 'undefined') {
  validateColorMatrices();
}

/**
 * Accessibility System Index
 * Central export point for all accessibility features
 */

// Core system
export {
  AccessibilitySystem,
  defaultSettings,
  colorBlindMatrices,
  validateColorMatrices,
  accessibilityPresets,
  getAccessibilitySystem,
  initAccessibilitySystem,
  applyColorBlindMode,
  setMotionReduction,
  announce,
  getCurrentSettings,
} from './systems/accessibility';

// Announcer
export {
  Announcer,
  getAnnouncer,
  initAnnouncer,
  announce as announceMessage,
  announceNow,
  announcePolite,
  announceDiscovery,
  announceCollection,
  announceCombat,
  announceEnvironment,
  announceQuest,
  announceInventory,
  announceStatus,
  announceDialogue,
  announceWarning,
  announceAchievement,
  announceValueChange,
} from './ui/announcer';

// Accessibility Menu
export {
  AccessibilityMenu,
  openAccessibilityMenu,
  closeAccessibilityMenu,
  createAccessibilityButton,
  addAccessibilityButtonToPage,
} from './ui/accessibility-menu';

// Types
export type {
  ColorBlindType,
  UIScale,
  VerbosityLevel,
  CrosshairStyle,
  Keybinding,
  InputSettings,
  VisualSettings,
  CognitiveSettings,
  AuditorySettings,
  ScreenReaderSettings,
  AccessibilitySettings,
  AccessibilityPreset,
} from './systems/accessibility';

export type {
  AnnouncementPriority,
  Announcement,
  AnnouncerOptions,
  GameEventType,
  GameEvent,
} from './ui/announcer';

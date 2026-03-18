# Candy World Accessibility Documentation

> **Games should be for everyone.** This document outlines the comprehensive accessibility features implemented in Candy World to ensure an inclusive gaming experience for players of all abilities.

## Table of Contents

- [Overview](#overview)
- [WCAG 2.1 Compliance](#wcag-21-compliance)
- [Motor Accessibility](#motor-accessibility)
- [Visual Accessibility](#visual-accessibility)
- [Cognitive Accessibility](#cognitive-accessibility)
- [Auditory Accessibility](#auditory-accessibility)
- [Screen Reader Support](#screen-reader-support)
- [Quick Start Presets](#quick-start-presets)
- [API Reference](#api-reference)
- [Implementation Notes](#implementation-notes)

---

## Overview

Candy World's accessibility system is designed with the principle that **games should be for everyone**. Our implementation follows the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standards and incorporates feedback from players with diverse accessibility needs.

### Key Features

- 🎮 **Motor**: Remappable controls, sticky keys, toggle sprint
- 👁️ **Visual**: Color blind modes, UI scaling, motion reduction
- 🧠 **Cognitive**: Distraction-free mode, extended timers, simplified UI
- 🔊 **Auditory**: Visual sound indicators, subtitles, mono audio
- 📢 **Screen Reader**: Full ARIA support, game event announcements

---

## WCAG 2.1 Compliance

Our accessibility implementation meets or exceeds the following WCAG 2.1 criteria:

### Level A Compliance

| Criterion | Description | Implementation |
|-----------|-------------|----------------|
| 1.1.1 Non-text Content | All non-text content has text alternatives | ARIA labels on all UI elements |
| 1.3.1 Info and Relationships | Information structure is programmatically determined | Semantic HTML, ARIA roles |
| 1.3.2 Meaningful Sequence | Content is presented in meaningful order | Logical DOM order, focus management |
| 2.1.1 Keyboard | All functionality available via keyboard | Full keyboard navigation |
| 2.1.2 No Keyboard Trap | Users can navigate away from any element | Escape key, focus trapping in modals |
| 2.4.1 Bypass Blocks | Skip links to bypass repetitive content | Future enhancement |
| 2.4.3 Focus Order | Focusable elements in logical order | TabIndex management |
| 2.4.4 Link Purpose | Link text describes destination | Descriptive labels |
| 3.1.1 Language of Page | Default language identified | `lang` attribute set |
| 3.2.1 On Focus | No context change on focus | Focus only highlights |
| 3.2.2 On Input | No context change on input | Explicit save/apply actions |
| 3.3.1 Error Identification | Errors clearly identified | Inline validation |
| 3.3.2 Labels/Instructions | Clear labels and instructions | Helper text on all inputs |
| 4.1.1 Parsing | Valid markup | Valid HTML5 |
| 4.1.2 Name/Role/Value | Components have name, role, value | ARIA attributes |

### Level AA Compliance

| Criterion | Description | Implementation |
|-----------|-------------|----------------|
| 1.4.3 Contrast (Minimum) | 4.5:1 contrast for normal text | CSS variables, high contrast mode |
| 1.4.4 Resize Text | Text can be resized to 200% | UI scaling (75%-200%) |
| 1.4.5 Images of Text | Avoid images of text | All text rendered as HTML |
| 1.4.10 Reflow | Content reflows at 320px | Responsive design |
| 1.4.11 Non-text Contrast | 3:1 contrast for UI components | High contrast mode |
| 1.4.12 Text Spacing | Text spacing adjustable | CSS custom properties |
| 1.4.13 Content on Hover | Hover content dismissible | Click to dismiss tooltips |
| 2.4.6 Headings/Labels | Descriptive headings and labels | Clear section organization |
| 2.4.7 Focus Visible | Visible focus indicator | CSS focus styles |
| 3.1.2 Language of Parts | Language of passages identified | Future enhancement |
| 3.2.3 Consistent Navigation | Navigation consistent across pages | Persistent menu structure |
| 3.2.4 Consistent Identification | Components identified consistently | Design system |
| 3.3.3 Error Suggestion | Suggestions for error correction | Inline help text |
| 3.3.4 Error Prevention | Prevention for legal/financial/data | Confirmation dialogs |
| 4.1.3 Status Messages | Status messages programmatically determined | ARIA live regions |

---

## Motor Accessibility

### Remappable Keybindings

Players can remap all keyboard and gamepad controls to suit their needs:

```typescript
import { getAccessibilitySystem } from './src/systems/accessibility.ts';

const a11y = getAccessibilitySystem();

// Get current keybindings
const settings = a11y.getSettings();
const jumpBinding = settings.input.keybindings.get('jump');
// { key: ' ', gamepadButton: 0 }

// Update a keybinding
const keybindings = new Map(settings.input.keybindings);
keybindings.set('jump', { key: 'Space', gamepadButton: 0 });
a11y.updateInputSettings({ keybindings });
```

**Default Keybindings:**

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Move Forward | W | Left Stick |
| Move Backward | S | Left Stick |
| Move Left | A | Left Stick |
| Move Right | D | Left Stick |
| Jump | Space | A (Button 0) |
| Sprint | Shift | Left Stick Click |
| Crouch | Ctrl | Right Stick Click |
| Interact | E | X (Button 2) |
| Inventory | I | Y (Button 3) |
| Attack | Left Click | RT (Button 7) |
| Block | Right Click | LT (Button 6) |
| Use Item | F | B (Button 1) |
| Pause | Escape | Menu (Button 9) |

### Adjustable Input Sensitivity

- **Range**: 0.1x to 2.0x
- **Default**: 1.0x
- Separate settings for mouse and gamepad

```typescript
// Adjust mouse sensitivity
a11y.updateInputSettings({ sensitivity: 0.5 });

// Adjust gamepad sensitivity
a11y.updateInputSettings({ gamepadSensitivity: 1.5 });
```

### Toggle Sprint

When enabled, press sprint once to toggle running instead of holding:

```typescript
a11y.updateInputSettings({ sprintToggle: true });
```

### Sticky Keys

Allows pressing modifier keys once to "lock" them:

```typescript
a11y.updateInputSettings({ stickyKeys: true });
```

**Usage:**
1. Press Shift once → "Shift locked"
2. Press any letter → Uppercase
3. Press Shift again → "Shift unlocked"

### Reduced Input Latency

Minimizes delay between input and response:

```typescript
a11y.updateInputSettings({ reducedLatency: true });
```

⚠️ May increase CPU usage slightly.

---

## Visual Accessibility

### Color Blind Modes

We provide scientifically accurate color transformation matrices for different types of color vision deficiency:

```typescript
import { applyColorBlindMode } from './src/systems/accessibility.ts';

// Apply color blind mode
applyColorBlindMode('protanopia');  // Red-blind
applyColorBlindMode('deuteranopia'); // Green-blind
applyColorBlindMode('tritanopia');   // Blue-blind
applyColorBlindMode('achromatopsia'); // No color
applyColorBlindMode('none');         // Normal vision
```

**Color Matrix Validation:**

All color matrices are validated on module load to ensure they contain exactly 16 elements (4x4 matrix for RGBA transformation).

### UI Scaling

Interface elements can be scaled from 75% to 200%:

```typescript
a11y.updateVisualSettings({ uiScale: 1.5 }); // 150%
```

**Available Scales:**
- 75% - Compact
- 100% - Default
- 125% - Large
- 150% - Extra Large
- 200% - Huge

### Motion Reduction

Reduces or disables animations for players with vestibular disorders:

```typescript
import { setMotionReduction } from './src/systems/accessibility.ts';

setMotionReduction(true);
```

**Effects:**
- Disables screen shake
- Reduces camera bob
- Minimizes particle effects
- Slows transition animations

### High Contrast Mode

Increases contrast for better visibility:

```typescript
a11y.updateVisualSettings({ highContrast: true });
```

This applies the `.a11y-high-contrast` CSS class which:
- Increases contrast ratios to 7:1+
- Adds borders to interactive elements
- Enhances text shadows

### Outline Mode

Adds colored outlines to interactive objects:

```typescript
a11y.updateVisualSettings({ 
  outlineMode: true,
  outlineColor: '#ffff00' // Yellow
});
```

### Crosshair Customization

```typescript
a11y.updateVisualSettings({
  crosshairStyle: 'dot',      // 'default' | 'dot' | 'cross' | 'circle' | 'brackets'
  crosshairSize: 1.5,         // 0.5 to 2.0
  crosshairColor: '#00ff00'   // Any valid CSS color
});
```

---

## Cognitive Accessibility

### Distraction-Free Mode

Hides ambient animations and decorative effects:

```typescript
a11y.updateCognitiveSettings({ distractionFree: true });
```

### Simplified UI

Shows only essential interface elements:

```typescript
a11y.updateCognitiveSettings({ simplifiedUI: true });
```

### Extended Timers

Increases time limits for challenges:

```typescript
a11y.updateCognitiveSettings({ 
  extendedTimers: true,
  timerExtensionFactor: 2.0 // 2x time
});
```

**Usage in Game Logic:**

```typescript
const a11y = getAccessibilitySystem();
const baseTime = 60; // 60 seconds
const extendedTime = baseTime * a11y.getTimerExtensionFactor();
```

### Verbosity Levels

Controls detail level of tooltips and tutorials:

```typescript
a11y.updateCognitiveSettings({ verbosityLevel: 'verbose' });
```

**Levels:**
- `minimal` - Essential information only
- `standard` - Balanced detail (default)
- `verbose` - Detailed explanations

### Pause on Focus Lost

Automatically pauses when switching windows:

```typescript
a11y.updateCognitiveSettings({ pauseOnFocusLost: true });
```

---

## Auditory Accessibility

### Volume Controls

Independent volume sliders for different audio types:

```typescript
a11y.updateAuditorySettings({
  masterVolume: 1.0,   // 0.0 to 1.0
  musicVolume: 0.8,    // Relative to master
  sfxVolume: 1.0,      // Relative to master
  ambientVolume: 0.6   // Relative to master
});
```

**Effective Volume Calculation:**

```typescript
const a11y = getAccessibilitySystem();
const effectiveMusicVol = a11y.getEffectiveVolume('music');
// = masterVolume * musicVolume
```

### Mono Audio

Combines all audio channels into mono:

```typescript
a11y.updateAuditorySettings({ monoAudio: true });
```

### Visual Sound Indicators

Shows on-screen indicators for important sounds:

```typescript
a11y.updateAuditorySettings({ visualSoundIndicators: true });

// In game code, trigger visual indicator
a11y.showVisualSoundIndicator(
  direction, // 0-360 degrees
  distance,  // 0-1 normalized
  'enemy'    // sound type
);
```

### Subtitles

Full subtitle support with customization:

```typescript
a11y.updateAuditorySettings({
  subtitleEnabled: true,
  subtitleSize: 'large',        // 'small' | 'medium' | 'large'
  subtitleBackground: true,     // Background for readability
  directionalIndicators: true   // Show sound direction
});

// Show subtitle
a11y.showSubtitle(
  'Enemy approaching from the north!',
  'Narrator',    // Speaker name (optional)
  5000           // Duration in ms (optional)
);
```

---

## Screen Reader Support

### Announcer System

The announcer provides spoken feedback for game events:

```typescript
import { 
  announce, 
  announceDiscovery,
  announceCollection,
  announceCombat,
  announceEnvironment 
} from './src/ui/announcer.ts';

// Simple announcement
announce('Welcome to Candy World!', 'polite');

// Game event announcements
announceDiscovery('Mushroom', 'Forest Edge');
announceCollection('Gems', 5, 25);
announceCombat('defeated', 'Slime', 10);
announceEnvironment('Night falls');
announceQuest('completed', 'Find the Golden Key');
announceAchievement('Explorer');
```

### Priority Levels

- `polite` - Waits for current speech to finish
- `assertive` - Interrupts immediately for urgent info
- `off` - No announcement

### Focus Management

```typescript
// Trap focus in a modal
const modal = document.getElementById('my-modal');
a11y.trapFocus(modal);

// Release focus when done
a11y.releaseFocus(modal);
```

### ARIA Live Regions

The announcer automatically creates ARIA live regions:

```html
<div id="a11y-announcer-container" aria-live="off">
  <div id="a11y-announcer-polite" aria-live="polite" aria-atomic="true"></div>
  <div id="a11y-announcer-assertive" aria-live="assertive" aria-atomic="true"></div>
</div>
```

---

## Quick Start Presets

Preset profiles allow players to quickly configure settings for common accessibility needs:

```typescript
import { accessibilityPresets, getAccessibilitySystem } from './src/systems/accessibility.ts';

const a11y = getAccessibilitySystem();
a11y.applyPreset('highContrast');
```

### Available Presets

| Preset | Description | Key Features |
|--------|-------------|--------------|
| `default` | Standard settings | Default game experience |
| `highContrast` | Enhanced visibility | High contrast, outlines, bright crosshair |
| `lowMotion` | Reduced animations | No screen shake, reduced particles |
| `colorBlindProtanopia` | Red-blind friendly | Protanopia matrix + outlines |
| `colorBlindDeuteranopia` | Green-blind friendly | Deuteranopia matrix + outlines |
| `colorBlindTritanopia` | Blue-blind friendly | Tritanopia matrix + outlines |
| `screenReaderOptimized` | Full audio support | All announcements enabled |
| `cognitiveSupport` | Reduced distractions | Simplified UI, extended timers |
| `motorImpairment` | Toggle actions | Sticky keys, toggle sprint, reduced sensitivity |
| `deaf` | Visual audio cues | Full subtitles, visual indicators |

### Creating Custom Presets

```typescript
const myPreset = {
  name: 'My Custom Preset',
  description: 'Optimized for my specific needs',
  settings: {
    visual: {
      uiScale: 1.25,
      motionReduction: true,
      // ... other settings
    }
  }
};
```

---

## API Reference

### AccessibilitySystem

#### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getSettings()` | Get current settings | - | `AccessibilitySettings` |
| `updateSettings(settings)` | Update all settings | `Partial<AccessibilitySettings>` | `void` |
| `updateInputSettings(settings)` | Update input settings | `Partial<InputSettings>` | `void` |
| `updateVisualSettings(settings)` | Update visual settings | `Partial<VisualSettings>` | `void` |
| `updateCognitiveSettings(settings)` | Update cognitive settings | `Partial<CognitiveSettings>` | `void` |
| `updateAuditorySettings(settings)` | Update auditory settings | `Partial<AuditorySettings>` | `void` |
| `updateScreenReaderSettings(settings)` | Update SR settings | `Partial<ScreenReaderSettings>` | `void` |
| `applyPreset(name)` | Apply a preset profile | `string` | `void` |
| `resetToDefaults()` | Reset all settings | - | `void` |
| `applyColorBlindMode(type)` | Apply color matrix | `ColorBlindType` | `void` |
| `setMotionReduction(enabled)` | Reduce motion | `boolean` | `void` |
| `getMotionReduction()` | Check motion reduction | - | `boolean` |
| `shouldReduceMotion()` | Check user preference | - | `boolean` |
| `announce(message, priority)` | Screen reader announce | `string`, `AnnouncementPriority` | `void` |
| `getEffectiveVolume(type)` | Get calculated volume | `'master' \| 'music' \| 'sfx' \| 'ambient'` | `number` |
| `getTimerExtensionFactor()` | Get timer multiplier | - | `number` |
| `trapFocus(element)` | Trap focus in element | `HTMLElement` | `void` |
| `releaseFocus(element)` | Release focus trap | `HTMLElement` | `void` |
| `addListener(callback)` | Listen for changes | `(settings) => void` | `() => void` |
| `destroy()` | Cleanup resources | - | `void` |

#### Static Functions

```typescript
import { 
  getAccessibilitySystem,
  initAccessibilitySystem,
  applyColorBlindMode,
  setMotionReduction,
  announce,
  getCurrentSettings 
} from './src/systems/accessibility.ts';

// Get or create singleton
const a11y = getAccessibilitySystem();

// Initialize with defaults
const a11y = initAccessibilitySystem();

// Quick functions
applyColorBlindMode('protanopia');
setMotionReduction(true);
announce('Game saved', 'polite');
const settings = getCurrentSettings();
```

### Announcer

```typescript
import { 
  getAnnouncer,
  announce,
  announceDiscovery,
  announceCollection,
  announceCombat,
  announceEnvironment,
  announceQuest,
  announceInventory,
  announceStatus,
  announceDialogue,
  announceWarning,
  announceAchievement 
} from './src/ui/announcer.ts';

const announcer = getAnnouncer();

// Direct announcement
announcer.announce('Message', 'polite');

// Game events
announcer.announceDiscovery('Item Name', 'Location');
announcer.announceCollection('Coins', 10, 100);
announcer.announceCombat('hit', 'Enemy', 25);
```

### AccessibilityMenu

```typescript
import { 
  AccessibilityMenu,
  openAccessibilityMenu,
  closeAccessibilityMenu,
  createAccessibilityButton,
  addAccessibilityButtonToPage 
} from './src/ui/accessibility-menu.ts';

// Open menu
openAccessibilityMenu();

// Or use class directly
const menu = new AccessibilityMenu();
menu.open();

// Add floating button
addAccessibilityButtonToPage();
```

---

## Implementation Notes

### Settings Persistence

Settings are automatically saved to `localStorage`:

```typescript
// Key used in localStorage
const STORAGE_KEY = 'candy_world_accessibility';
```

Settings are applied immediately without requiring a restart.

### CSS Custom Properties

The accessibility system sets CSS custom properties for styling:

```css
:root {
  --a11y-ui-scale: 1;
  --a11y-brightness: 1;
  --a11y-contrast: 1;
  --a11y-crosshair-color: #ffffff;
  --a11y-crosshair-size: 1;
  --a11y-outline-color: #ffff00;
}
```

### CSS Classes Applied

The system applies these classes to `document.body`:

| Class | Description |
|-------|-------------|
| `.a11y-high-contrast` | High contrast mode active |
| `.a11y-motion-reduced` | Motion reduction active |
| `.a11y-camera-bob-disabled` | Camera bob disabled |
| `.a11y-outline-mode` | Outline mode active |
| `.a11y-simplified-ui` | Simplified UI active |
| `.a11y-distraction-free` | Distraction-free mode active |

### Event Handling

Listen for accessibility changes:

```typescript
const a11y = getAccessibilitySystem();

const unsubscribe = a11y.addListener((settings) => {
  console.log('Settings changed:', settings);
});

// Later...
unsubscribe();
```

### Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

Screen reader support tested with:
- NVDA (Windows)
- JAWS (Windows)
- VoiceOver (macOS/iOS)
- TalkBack (Android)

### Performance Considerations

- Color blind filters use GPU-accelerated SVG filters
- Announcements are debounced to prevent screen reader flooding
- Settings changes trigger minimal DOM updates
- localStorage operations are throttled

### Testing Accessibility

Use these tools to verify accessibility:

```bash
# Accessibility audit (requires Chrome)
npx lighthouse --only-categories=accessibility http://localhost:3000

# Axe Core (automated testing)
npm install @axe-core/cli
npx axe http://localhost:3000
```

### Feedback and Contributions

We welcome feedback on our accessibility features. Please report issues or suggestions through our issue tracker with the `accessibility` label.

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/)
- [Microsoft Accessibility Insights](https://accessibilityinsights.io/)
- [A11y Project](https://www.a11yproject.com/)

---

## License

This accessibility system is part of Candy World and follows the same license terms. We encourage other developers to adapt these patterns for their own games.

---

*Last updated: March 2026*
*Accessibility version: 1.0.0*

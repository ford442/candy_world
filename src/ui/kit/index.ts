/**
 * 🍭 Candy UI Kit
 *
 * Shared HUD/GUI primitives: panel, meter, tooltip, shortcut hint, plus theme
 * tokens and focus-trap reuse. Custom CSS + small TS — no UI framework.
 *
 * Styles live in styles/kit-tokens.css and styles/kit.css (imported by
 * style.css). See docs/UI_KIT.md.
 */

export { el, nextId } from './dom.ts';
export type { ElementSpec } from './dom.ts';

export { createPanel } from './panel.ts';
export type { Panel, PanelOptions, PanelAnchor, PanelLayer } from './panel.ts';

export { createMeter } from './meter.ts';
export type { Meter, MeterOptions } from './meter.ts';

export { attachTooltip } from './tooltip.ts';
export type { Tooltip, TooltipOptions } from './tooltip.ts';

export { createShortcutHint, setShortcut } from './shortcut-hint.ts';
export type { ShortcutHint, ShortcutHintOptions } from './shortcut-hint.ts';

export { setKitTheme, getKitTheme } from './theme.ts';
export type { KitTheme } from './theme.ts';

// Focus management: one audited implementation, shared by kit panels and the
// existing menus (tests/focus-trap.test.ts).
export { trapFocusInside } from '../../utils/interaction-utils.ts';

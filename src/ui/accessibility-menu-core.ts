/**
 * Accessibility Menu Core Module
 * 
 * Handles the core logic and state management for the Accessibility Menu.
 * Includes:
 * - Type definitions for menu structure
 * - AccessibilityMenu class with state and lifecycle methods
 * - Core navigation and state switching logic
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
  getAccessibilitySystem,
} from '../systems/accessibility';
import { announce } from './announcer';
import { trapFocusInside } from '../utils/interaction-utils';
import { yieldToPaint } from '../utils/yield-to-paint';

// ============================================================================
// Menu Section Types
// ============================================================================

export type MenuSection = 
  | 'presets'
  | 'motor'
  | 'visual'
  | 'cognitive'
  | 'auditory'
  | 'screenReader';

export interface MenuItem {
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

/**
 * AccessibilityMenuCore manages the accessibility settings dialog.
 * Provides state management, lifecycle hooks, and focus trapping.
 */
export class AccessibilityMenuCore {
  protected container: HTMLElement | null = null;
  protected overlay: HTMLElement | null = null;
  protected isOpen = false;
  protected a11y: AccessibilitySystem;
  protected currentSection: MenuSection = 'presets';
  protected menuItems: MenuItem[] = [];
  protected focusIndex = 0;
  protected saveButton: HTMLButtonElement | null = null;
  protected releaseFocusTrap: (() => void) | null = null;
  protected lastFocusedElement: HTMLElement | null = null;
  protected boundKeyHandler = this.handleKeyDown.bind(this);

  constructor() {
    this.a11y = getAccessibilitySystem();
  }

  // ============================================================================
  // Menu Lifecycle
  // ============================================================================

  open(): void {
    if (this.isOpen) return;
    
    this.lastFocusedElement = document.activeElement as HTMLElement;

    this.createMenu();
    this.isOpen = true;
    document.addEventListener('keydown', this.boundKeyHandler);
    
    // Force DOM reflow
    void this.overlay!.offsetWidth;
    void this.container!.offsetWidth;

    // Apply active CSS styles
    this.overlay!.style.opacity = '1';
    this.container!.style.opacity = '1';
    this.container!.style.transform = 'scale(1)';

    // Trap focus after transition
    if (this.container) {
      yieldToPaint(50).then(() => {
        if (this.container && this.isOpen) {
          this.releaseFocusTrap = trapFocusInside(this.container);
        }
      });
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

    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus({ preventScroll: true });
    }
    this.lastFocusedElement = null;

    // Remove elements
    if (this.container) {
      this.container.style.opacity = '0';
      this.container.style.transform = 'scale(0.95)';
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
    }

    setTimeout(() => {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.container = null;
      this.overlay = null;
    }, 300);

    document.removeEventListener('keydown', this.boundKeyHandler);
    this.isOpen = false;

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) openA11yBtn.setAttribute('aria-expanded', 'false');
    const a11yMenuButton = document.getElementById('a11y-menu-button');
    if (a11yMenuButton) a11yMenuButton.setAttribute('aria-expanded', 'false');
    
    announce('Accessibility menu closed', 'polite');
  }

  // ============================================================================
  // Menu Creation (delegated to rendering module)
  // ============================================================================

  protected createMenu(): void {
    throw new Error('createMenu() must be implemented by subclass or mixin');
  }

  // ============================================================================
  // Keyboard Navigation (delegated to handlers module)
  // ============================================================================

  protected handleKeyDown(event: KeyboardEvent): void {
    throw new Error('handleKeyDown() must be implemented by subclass or mixin');
  }

  // ============================================================================
  // State Management
  // ============================================================================

  protected switchSection(section: MenuSection): void {
    this.currentSection = section;
    this.refreshMainPanel();
    announce(`Switched to ${this.formatActionName(section)} settings`, 'polite');
    const newTab = this.container?.querySelector(`#tab-${section}`) as HTMLElement;
    if (newTab) newTab.focus({ preventScroll: true });
  }

  protected refreshMainPanel(): void {
    const panel = this.container?.querySelector('[role="tabpanel"]');
    if (!panel) return;

    const panels = this.container?.querySelectorAll('[role="tabpanel"]');
    panels?.forEach(p => {
      (p as HTMLElement).style.display = 'none';
    });

    const currentPanel = this.container?.querySelector(`#panel-${this.currentSection}`) as HTMLElement;
    if (currentPanel) {
      currentPanel.style.display = 'block';
      currentPanel.id = `panel-${this.currentSection}`;
      currentPanel.setAttribute('aria-labelledby', `tab-${this.currentSection}`);
    }
  }

  protected updateSidebarSelection(): void {
    const buttons = this.container?.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>;
    const sections = ['presets', 'motor', 'visual', 'cognitive', 'auditory', 'screenReader'] as const;
    
    buttons?.forEach((btn, index) => {
      const isActive = sections[index] === this.currentSection;
      btn.setAttribute('aria-selected', isActive.toString());
      btn.tabIndex = isActive ? 0 : -1;
      btn.style.background = isActive ? 'var(--menu-active, #4a4a4a)' : 'transparent';
    });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  protected formatActionName(action: string): string {
    return action
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

}

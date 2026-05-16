/**
 * Accessibility Menu - Event Handlers Module
 * Handles keyboard navigation and key rebinding for the accessibility settings menu.
 */

import { AccessibilityMenuRendering } from './accessibility-menu-rendering';
import { MenuSection } from './accessibility-menu-core';
import { announce } from '../systems/accessibility';

/**
 * Extension of AccessibilityMenuRendering with event handler methods.
 * These methods handle keyboard navigation and keybinding management.
 */
export class AccessibilityMenuHandlers extends AccessibilityMenuRendering {
  
  // ============================================================================
  // Event Handlers
  // ============================================================================

  protected handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      event.preventDefault();
      return;
    }

    // ♿ Aria: Keyboard navigation for Tabs (Up/Down/Left/Right Arrows)
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && activeElement.getAttribute('role') === 'tab') {
        event.preventDefault();
        const tabs = Array.from(this.container?.querySelectorAll('[role="tab"]') || []) as HTMLElement[];
        const currentIndex = tabs.indexOf(activeElement);
        if (currentIndex >= 0) {
          let nextIndex = (event.key === 'ArrowDown' || event.key === 'ArrowRight') ? currentIndex + 1 : currentIndex - 1;
          if (nextIndex >= tabs.length) nextIndex = 0;
          if (nextIndex < 0) nextIndex = tabs.length - 1;

          const nextTab = tabs[nextIndex];
          nextTab.focus();

          // Assuming tab id is like 'tab-presets' and section is 'presets'
          const tabIdMatch = nextTab.id.match(/^tab-(.+)$/);
          if (tabIdMatch && tabIdMatch[1]) {
            this.switchSection(tabIdMatch[1] as MenuSection);
          }
        }
      }
    }
  }

  protected startKeyRebind(action: string, button: HTMLButtonElement): void {
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
}

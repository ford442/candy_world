/**
 * Accessibility Menu - Main Barrel Export
 * 
 * This is the public-facing module that exports:
 * - Type definitions (MenuSection, MenuItem)
 * - AccessibilityMenu class (main implementation via handler inheritance)
 * - Utility functions (openAccessibilityMenu, closeAccessibilityMenu, etc.)
 * 
 * The implementation is split across four modular files:
 * - accessibility-menu-core.ts: Core state, lifecycle, and types
 * - accessibility-menu-rendering.ts: DOM creation and section rendering
 * - accessibility-menu-handlers.ts: Keyboard event handlers and keybinding management
 * - accessibility-menu.ts: This barrel export with standalone utilities
 */

import './accessibility-menu.css';
import { AccessibilityMenuHandlers } from './accessibility-menu-handlers';
export type { MenuSection, MenuItem } from './accessibility-menu-core';
export { AccessibilityMenuRendering } from './accessibility-menu-rendering';
export { AccessibilityMenuHandlers } from './accessibility-menu-handlers';

/**
 * Export the complete AccessibilityMenu implementation.
 * The handlers module extends rendering which extends core, providing the full feature set.
 */
export class AccessibilityMenu extends AccessibilityMenuHandlers {}

// ============================================================================
// Singleton instance and helper functions
// ============================================================================

let menuInstance: AccessibilityMenu | null = null;

/**
 * Open the accessibility menu (creates instance if needed).
 */
export function openAccessibilityMenu(): void {
  if (!menuInstance) {
    menuInstance = new AccessibilityMenu();
  }
  menuInstance.open();
}

/**
 * Close the accessibility menu if it's open.
 */
export function closeAccessibilityMenu(): void {
  menuInstance?.close();
}

/**
 * Create a standalone accessibility button for the page.
 * Returns a button element ready to be added to the DOM.
 */
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

/**
 * Add the accessibility button to the page (if not already present).
 * This is a convenience function for initialization.
 */
export function addAccessibilityButtonToPage(): void {
  const existing = document.getElementById('a11y-menu-button');
  if (existing) return;

  const btn = createAccessibilityButton();
  btn.id = 'a11y-menu-button';
  document.body.appendChild(btn);
}

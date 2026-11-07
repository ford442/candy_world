/**
 * Accessibility Menu - Event Handlers Module
 * Handles keyboard navigation for the accessibility settings menu. Rebinding
 * lives in input-controls-section.ts, on the action layer.
 */

import { AccessibilityMenuRendering } from './accessibility-menu-rendering';

/**
 * Extension of AccessibilityMenuRendering with event handler methods.
 * These methods handle keyboard navigation.
 */
export class AccessibilityMenuHandlers extends AccessibilityMenuRendering {
    // ============================================================================
    // Event Handlers
    // ============================================================================

    protected handleKeyDown(event: KeyboardEvent): void {
        // ♿ Aria: Keyboard navigation for Tabs (Up/Down/Left/Right Arrows)
        if (
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight'
        ) {
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && activeElement.getAttribute('role') === 'tab') {
                event.preventDefault();
                const tabs = Array.from(
                    this.container?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
                );
                const currentIndex = tabs.indexOf(activeElement);
                if (currentIndex >= 0) {
                    let nextIndex =
                        event.key === 'ArrowDown' || event.key === 'ArrowRight'
                            ? currentIndex + 1
                            : currentIndex - 1;
                    if (nextIndex >= tabs.length) nextIndex = 0;
                    if (nextIndex < 0) nextIndex = tabs.length - 1;

                    const nextTab = tabs[nextIndex];
                    nextTab.focus({ preventScroll: true });
                    // ♿ Aria: Add tactile feedback for arrow key navigation
                    nextTab.classList.add('keyboard-active');
                    nextTab.click(); // Selection follows focus
                    setTimeout(() => {
                        nextTab.classList.remove('keyboard-active');
                    }, 50);
                }
            }
        }
    }
}

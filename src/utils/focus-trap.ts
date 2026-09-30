// Pure DOM helper with no imports: UI modules (loading screen, menus, overlays)
// take it from here rather than from interaction-utils.ts, whose 3D and
// persistence imports put the loading screen in an import cycle with the WASM
// loader (#1827 Part C.2).

/**
 * Traps keyboard focus within a specified HTML element.
 * Useful for accessibility in modals and overlay menus.
 * @param element - The HTMLElement to trap focus within.
 * @param options - Options for focus trapping.
 * @returns A cleanup function to remove the event listener when the modal closes.
 */
export function trapFocusInside(
    element: HTMLElement,
    options?: { skipAutoFocus?: boolean }
): () => void {
    // 1. Select all potentially focusable elements within the modal
    const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea',
        'input[type="text"]:not([disabled])',
        'input[type="radio"]:not([disabled])',
        'input[type="checkbox"]:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const handleKeyDown = (e: KeyboardEvent) => {
        const isTabPressed = e.key === 'Tab' || e.keyCode === 9;

        if (!isTabPressed) {
            return; // Only intercept Tab keys
        }

        // Get current focusable elements (queried on keydown in case the DOM changed)
        const focusableEls = Array.from(
            element.querySelectorAll<HTMLElement>(focusableSelectors)
        ).filter((el) => el.offsetParent !== null); // Ensure they are visibly rendered

        if (focusableEls.length === 0) return;

        const firstFocusableEl = focusableEls[0];
        const lastFocusableEl = focusableEls[focusableEls.length - 1];

        if (e.shiftKey) /* Shift + Tab */ {
            if (document.activeElement === firstFocusableEl) {
                lastFocusableEl.focus({ preventScroll: true });
                e.preventDefault(); // Prevent default browser tab behavior
            }
        } else /* Tab */ {
            if (document.activeElement === lastFocusableEl) {
                firstFocusableEl.focus({ preventScroll: true });
                e.preventDefault();
            }
        }
    };

    // 2. Attach the listener
    element.addEventListener('keydown', handleKeyDown);

    // 3. Auto-focus the first element when triggered
    if (!options?.skipAutoFocus) {
        const initialFocusableEls = element.querySelectorAll<HTMLElement>(focusableSelectors);
        if (initialFocusableEls.length > 0) {
            initialFocusableEls[0].focus({ preventScroll: true });
        }
    }

    // 4. Return a cleanup function to prevent memory leaks
    return function cleanup() {
        element.removeEventListener('keydown', handleKeyDown);
    };
}

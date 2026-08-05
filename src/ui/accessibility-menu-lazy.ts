/**
 * Lazy accessibility menu — DOM UI loads on first open, not at boot.
 */
export function openAccessibilityMenu(): void {
    void import('./accessibility-menu.ts').then((m) => m.openAccessibilityMenu());
}

export function closeAccessibilityMenu(): void {
    void import('./accessibility-menu.ts').then((m) => m.closeAccessibilityMenu());
}

export function isAccessibilityMenuOpen(): boolean {
    return false;
}

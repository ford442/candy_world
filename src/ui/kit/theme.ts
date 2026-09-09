/**
 * Candy UI Kit — theme switching.
 *
 * All kit colours resolve through the CSS variables in styles/kit-tokens.css.
 * Switching theme flips one attribute on <html>; no component needs to know.
 */

export type KitTheme = 'day' | 'night';

let _theme: KitTheme = 'day';

export function setKitTheme(theme: KitTheme | boolean): void {
    const next: KitTheme = typeof theme === 'boolean' ? (theme ? 'night' : 'day') : theme;
    if (next === _theme) return;
    _theme = next;
    if (typeof document === 'undefined') return;
    if (next === 'night') {
        document.documentElement.setAttribute('data-ck-theme', 'night');
    } else {
        document.documentElement.removeAttribute('data-ck-theme');
    }
}

export function getKitTheme(): KitTheme {
    return _theme;
}

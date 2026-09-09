/**
 * Candy UI Kit — Shortcut hint primitive.
 *
 * Renders the keycap badge on a control. The badge itself is `aria-hidden`:
 * the shortcut is exposed to assistive tech through `aria-keyshortcuts` on the
 * control, which is the attribute screen readers actually announce.
 */

import { el } from './dom.ts';

export interface ShortcutHintOptions {
    /** Display text, e.g. "E" or "Shift". */
    key: string;
    /** Absolute-position the badge in the parent's top-left corner. */
    corner?: boolean;
    classes?: string[];
}

export interface ShortcutHint {
    readonly root: HTMLElement;
    /** Flash the keycap (call on key-down feedback). */
    highlight(on: boolean): void;
}

export function createShortcutHint(options: ShortcutHintOptions): ShortcutHint {
    const { key, corner = false, classes = [] } = options;

    const root = el('kbd', {
        classes: ['ck-kbd', corner && 'ck-kbd--corner', ...classes],
        attrs: { 'aria-hidden': 'true' },
        text: key,
    });

    return {
        root,
        highlight(on: boolean) {
            root.classList.toggle('ck-kbd--highlight', on);
        },
    };
}

/**
 * Declare a control's keyboard shortcut for assistive tech.
 * `keys` uses the aria-keyshortcuts grammar, e.g. "E" or "Control+Shift+P".
 */
export function setShortcut(control: HTMLElement, keys: string): void {
    control.setAttribute('aria-keyshortcuts', keys);
}

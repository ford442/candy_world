/**
 * Candy UI Kit — Panel primitive.
 *
 * A glossy candy surface with a labelled ARIA region (or dialog) and an
 * opt-in focus trap that reuses the audited `trapFocusInside` helper.
 */

import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { el } from './dom.ts';

export type PanelAnchor = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'none';
export type PanelLayer = 'hud' | 'raised' | 'overlay';

export interface PanelOptions {
    id?: string;
    /** Accessible name. Required unless `role` is 'presentation'. */
    label?: string;
    /** Defaults to 'region'; use 'dialog' for modal surfaces. */
    role?: 'region' | 'group' | 'dialog' | 'presentation' | 'status';
    anchor?: PanelAnchor;
    layer?: PanelLayer;
    /** Stack children vertically. */
    column?: boolean;
    /** Drop the panel chrome — children provide their own surfaces. */
    bare?: boolean;
    /**
     * 🖱️ `pointer-events: none`, so clicks pass through to the canvas and the
     * pointer-lock re-acquire keeps working. Default true for read-only panels;
     * pass false when the panel contains controls.
     */
    inert?: boolean;
    /** Optional visible title row (rendered as the first child). */
    title?: string;
    /** Extra classes for surface-specific styling. */
    classes?: string[];
    children?: Array<HTMLElement | null | undefined>;
}

export interface Panel {
    readonly root: HTMLElement;
    /** Append content after construction. */
    add(...children: Array<HTMLElement | null | undefined>): void;
    show(): void;
    hide(): void;
    setVisible(visible: boolean): void;
    isVisible(): boolean;
    /**
     * Trap Tab focus inside the panel. Returns a release function; calling
     * `trapFocus` again while trapped is a no-op that returns the same release.
     */
    trapFocus(options?: { skipAutoFocus?: boolean }): () => void;
    releaseFocus(): void;
    destroy(): void;
}

export function createPanel(options: PanelOptions = {}): Panel {
    const {
        id,
        label,
        role = 'region',
        anchor = 'none',
        layer = 'hud',
        column = false,
        bare = false,
        inert = true,
        title,
        classes = [],
        children = [],
    } = options;

    const root = el('div', {
        id,
        classes: [
            'ck-panel',
            bare && 'ck-panel--bare',
            column && 'ck-panel--column',
            anchor !== 'none' && `ck-panel--${anchor}`,
            layer !== 'hud' && `ck-panel--layer-${layer}`,
            inert && 'ck-panel--inert',
            ...classes,
        ],
        attrs: {
            role: role === 'presentation' ? 'presentation' : role,
            // ♿ Every non-presentational region needs a name to be announced.
            'aria-label': role === 'presentation' ? null : (label ?? null),
        },
    });

    if (title) {
        root.appendChild(el('div', { classes: ['ck-panel-title'], text: title }));
    }

    for (const child of children) {
        if (child) root.appendChild(child);
    }

    let release: (() => void) | null = null;

    const releaseFocus = () => {
        if (release) {
            release();
            release = null;
        }
    };

    return {
        root,
        add(...nodes) {
            for (const node of nodes) {
                if (node) root.appendChild(node);
            }
        },
        show() {
            root.hidden = false;
            root.removeAttribute('aria-hidden');
        },
        hide() {
            releaseFocus();
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
        },
        setVisible(visible: boolean) {
            if (visible) this.show();
            else this.hide();
        },
        isVisible() {
            return !root.hidden;
        },
        trapFocus(trapOptions) {
            if (!release) {
                release = trapFocusInside(root, trapOptions);
            }
            return releaseFocus;
        },
        releaseFocus,
        destroy() {
            releaseFocus();
            root.remove();
        },
    };
}

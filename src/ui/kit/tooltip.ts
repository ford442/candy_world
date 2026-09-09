/**
 * Candy UI Kit — Tooltip primitive.
 *
 * Two halves, deliberately:
 *   1. a visually-hidden description linked with `aria-describedby`, which is
 *      always in the accessibility tree (unlike `title`, whose announcement is
 *      inconsistent across screen readers);
 *   2. a floating candy bubble shown on hover / focus-visible.
 *
 * 🖱️ Pointer lock: while `document.pointerLockElement` is set there is no
 * cursor, so the bubble is suppressed — the description stays available to AT.
 */

import { el, nextId } from './dom.ts';

export interface TooltipOptions {
    /** Description text. */
    text: string;
    /** Where the bubble sits relative to the control. Default 'top'. */
    placement?: 'top' | 'bottom';
    /** Gap in px between control and bubble. Default 8. */
    offset?: number;
}

export interface Tooltip {
    /** Change the description (updates both halves). */
    setText(text: string): void;
    show(): void;
    hide(): void;
    /** Remove listeners and nodes, and unlink aria-describedby. */
    destroy(): void;
}

let sharedBubble: HTMLElement | null = null;
let bubbleOwner: HTMLElement | null = null;

function getBubble(): HTMLElement {
    if (!sharedBubble) {
        sharedBubble = el('div', {
            classes: ['ck-tooltip'],
            // The bubble is decorative; the SR copy carries the text.
            attrs: { 'aria-hidden': 'true', role: 'presentation' },
        });
        document.body.appendChild(sharedBubble);
    }
    return sharedBubble;
}

/** Attach a tooltip to a control. Idempotent per control. */
export function attachTooltip(control: HTMLElement, options: TooltipOptions): Tooltip {
    const { text, placement = 'top', offset = 8 } = options;

    // ♿ The persistent, screen-reader-visible description.
    const srId = nextId('ck-tip');
    const srCopy = el('span', {
        id: srId,
        classes: ['ck-tooltip--sr'],
        text,
    });
    control.appendChild(srCopy);

    const previousDescribedBy = control.getAttribute('aria-describedby');
    control.setAttribute(
        'aria-describedby',
        previousDescribedBy ? `${previousDescribedBy} ${srId}` : srId
    );

    // `title` would duplicate the description as a second, native tooltip.
    control.removeAttribute('title');

    let currentText = text;

    const position = () => {
        const bubble = getBubble();
        const rect = control.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const left = Math.max(
            4,
            Math.min(
                window.innerWidth - bubbleRect.width - 4,
                rect.left + rect.width / 2 - bubbleRect.width / 2
            )
        );
        const top =
            placement === 'top' ? rect.top - bubbleRect.height - offset : rect.bottom + offset;
        bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };

    const show = () => {
        // No cursor while pointer-locked — a floating bubble would be noise.
        if (document.pointerLockElement) return;
        const bubble = getBubble();
        bubble.textContent = currentText;
        bubbleOwner = control;
        bubble.setAttribute('data-ck-visible', 'true');
        position();
    };

    const hide = () => {
        if (bubbleOwner !== control) return;
        bubbleOwner = null;
        if (sharedBubble) sharedBubble.removeAttribute('data-ck-visible');
    };

    const onFocus = (event: FocusEvent) => {
        // Only for keyboard focus; a mouse press already got the hover bubble.
        const target = event.currentTarget as HTMLElement;
        if (typeof target.matches === 'function' && !target.matches(':focus-visible')) return;
        show();
    };

    control.addEventListener('pointerenter', show);
    control.addEventListener('pointerleave', hide);
    control.addEventListener('focus', onFocus);
    control.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    document.addEventListener('pointerlockchange', hide);

    return {
        setText(next: string) {
            currentText = next;
            srCopy.textContent = next;
            if (bubbleOwner === control && sharedBubble) sharedBubble.textContent = next;
        },
        show,
        hide,
        destroy() {
            hide();
            control.removeEventListener('pointerenter', show);
            control.removeEventListener('pointerleave', hide);
            control.removeEventListener('focus', onFocus);
            control.removeEventListener('blur', hide);
            window.removeEventListener('scroll', hide);
            window.removeEventListener('resize', hide);
            document.removeEventListener('pointerlockchange', hide);
            srCopy.remove();
            if (previousDescribedBy) control.setAttribute('aria-describedby', previousDescribedBy);
            else control.removeAttribute('aria-describedby');
        },
    };
}

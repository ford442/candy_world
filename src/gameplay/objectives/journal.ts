/**
 * @file src/gameplay/objectives/journal.ts
 * @brief The Melody journal: a dialog listing the Melodies in progress, with the step to do next,
 * then the ones finished (#2028 slice B).
 *
 * Its own panel in the lazy `objectives` chunk, not a tab of the discovery log: `discovery-log.ts`
 * is in `app`, and a tab would put the journal there too.
 *
 * Opened from a button appended to `#ability-hud`; there is no key binding in this cut. While open
 * it holds the `menu` input context (as the discovery log does), traps Tab inside, and closes on
 * Escape or its close button. Escape is consumed here: left to bubble, the global handler would
 * also re-lock the pointer or raise the pause overlay over the dialog.
 *
 * Photo mode hides it: `#journal-panel` is in its HUD selectors, and the button sits inside
 * `#ability-hud`, which already is.
 *
 * Plain DOM through the Candy UI Kit; the look is in `journal.css`, imported by `index.ts` so this
 * module stays importable from Node tests.
 */

import { input } from '../../core/input/actions/index.ts';
import { attachTooltip, createPanel, el } from '../../ui/kit/index.ts';
import { trapFocusInside } from '../../utils/focus-trap.ts';
import type { MelodyView, ObjectiveSystem } from './objective-system.ts';

/** Photo mode lists this id in its HUD selectors (`photo-mode.ts`). */
export const JOURNAL_ID = 'journal-panel';
export const JOURNAL_BUTTON_ID = 'ability-journal';

export interface Journal {
    readonly root: HTMLElement;
    readonly button: HTMLButtonElement;
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
    /** Close, unsubscribe and remove the nodes. */
    destroy(): void;
}

function section(heading: string, items: HTMLElement[], empty: string): HTMLElement {
    return el('section', {
        classes: ['journal-section'],
        children: [
            el('h3', { classes: ['journal-heading'], text: heading }),
            items.length > 0
                ? el('ul', { classes: ['journal-list'], children: items })
                : el('p', { classes: ['journal-empty'], text: empty }),
        ],
    });
}

function activeItem(view: MelodyView): HTMLElement {
    return el('li', {
        classes: ['journal-item'],
        children: [
            el('div', {
                classes: ['journal-item-head'],
                children: [
                    el('strong', { classes: ['journal-item-title'], text: view.title }),
                    el('span', {
                        classes: ['journal-item-progress'],
                        text: `Step ${Math.min(view.done + 1, view.total)} of ${view.total}`,
                    }),
                ],
            }),
            el('p', { classes: ['journal-item-step'], text: view.current ?? '' }),
        ],
    });
}

function completedItem(view: MelodyView): HTMLElement {
    return el('li', {
        classes: ['journal-item', 'journal-item--done'],
        children: [
            el('span', { classes: ['journal-check'], attrs: { 'aria-hidden': 'true' }, text: '✓' }),
            el('strong', { classes: ['journal-item-title'], text: view.title }),
        ],
    });
}

export function mountJournal(system: ObjectiveSystem): Journal {
    const panel = createPanel({
        id: JOURNAL_ID,
        label: 'Melody journal',
        role: 'dialog',
        layer: 'overlay',
        column: true,
        // It holds controls, and `#journal-panel` is a `[role="dialog"]`, which keeps a click here
        // from re-acquiring pointer lock (`isInteractiveTarget`).
        inert: false,
        title: 'Melody journal',
        classes: ['journal-panel'],
    });
    panel.root.setAttribute('aria-modal', 'true');

    const closeButton = el('button', {
        classes: ['journal-close', 'ck-focusable'],
        attrs: { type: 'button', 'aria-label': 'Close Melody journal' },
        text: '✕',
    });
    const body = el('div', { classes: ['journal-body'] });
    panel.add(closeButton, body);
    panel.hide();

    const button = el('button', {
        id: JOURNAL_BUTTON_ID,
        classes: ['ability-slot', 'ck-focusable', 'journal-button'],
        attrs: {
            type: 'button',
            'aria-label': 'Melody journal',
            'aria-haspopup': 'dialog',
            'aria-controls': JOURNAL_ID,
            'aria-expanded': 'false',
        },
        children: [
            el('span', { classes: ['ability-icon'], attrs: { 'aria-hidden': 'true' }, text: '📖' }),
        ],
    });
    const tooltip = attachTooltip(button, { text: 'Melody journal' });

    let opened = false;
    let popMenuContext: (() => void) | null = null;
    let releaseTrap: (() => void) | null = null;

    function render(): void {
        const views = system.getViews();
        body.replaceChildren(
            section(
                'In progress',
                views.filter((v) => v.status === 'active').map(activeItem),
                'No Melodies in progress.'
            ),
            section(
                'Completed',
                views.filter((v) => v.status === 'completed').map(completedItem),
                'None yet.'
            )
        );
    }

    function close(): void {
        if (!opened) return;
        opened = false;
        // Release the trap first: its cleanup puts focus back where it was, which is the button.
        releaseTrap?.();
        releaseTrap = null;
        popMenuContext?.();
        popMenuContext = null;
        panel.hide();
        button.setAttribute('aria-expanded', 'false');
    }

    function open(): void {
        if (opened) return;
        opened = true;
        render();
        panel.show();
        button.setAttribute('aria-expanded', 'true');
        popMenuContext = input.pushContext('menu');
        releaseTrap = trapFocusInside(panel.root, { onEscape: close });
    }

    const toggle = (): void => (opened ? close() : open());

    closeButton.addEventListener('click', close);
    button.addEventListener('click', toggle);
    panel.root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') event.stopPropagation();
    });

    const stopListening = system.onChange(() => {
        if (opened) render();
    });

    // The button joins the ability HUD; the dialog sits on the page. Without a HUD (it is mounted
    // at boot, well before this chunk loads) the journal still works through its API.
    const hud = document.getElementById('ability-hud');
    if (hud) hud.appendChild(button);
    else console.warn('[Objectives] #ability-hud not found: the journal has no open button');
    document.body.appendChild(panel.root);

    return {
        root: panel.root,
        button,
        open,
        close,
        toggle,
        isOpen: () => opened,
        destroy() {
            close();
            stopListening();
            tooltip.destroy();
            button.remove();
            panel.destroy();
        },
    };
}

/**
 * Pause and menus on a gamepad (#2027 slice 2). The keyboard gets through
 * menus with the DOM (Tab, Enter, Escape, focus traps); a pad has none of
 * those, so the `menu` and `photo` contexts bind it to actions and this file
 * turns them into the same DOM steps:
 *
 * - `pause` (Start): playing → release pointer lock, which opens the pause
 *   menu as Escape does; paused → resume. Other menus → back out.
 * - `menu.next` / `menu.prev` (d-pad): move focus, wrapping, within the open
 *   dialog.
 * - `menu.confirm` (A): click the focused control.
 * - `menu.back` (B): an Escape keydown on the focused element, so each menu's
 *   own Escape handling (closing, the pause menu's resume) runs unchanged.
 *
 * Resuming needs pointer lock. Chrome may refuse a lock requested without a
 * click or key; then the menu stays open and says to click.
 */

import { announce } from '../../../ui/announcer.ts';
import { input } from '../actions/index.ts';
import type { InputSession } from './session.ts';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The open dialog focus should stay in: the focused element's, or the pause menu. */
function focusScope(session: InputSession): HTMLElement {
    const active = document.activeElement;
    const dialog =
        active instanceof HTMLElement && active !== document.body
            ? active.closest<HTMLElement>('[role="dialog"], [aria-modal="true"], #instructions')
            : null;
    if (dialog) return dialog;
    if (isPauseMenuOpen(session)) return session.instructions!;
    const open = document.querySelector<HTMLElement>('[aria-modal="true"]');
    return open ?? document.body;
}

function focusables(scope: HTMLElement): HTMLElement[] {
    return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]')
    );
}

function moveFocus(session: InputSession, step: 1 | -1): void {
    const list = focusables(focusScope(session));
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next =
        at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next].focus({ preventScroll: false });
}

function isPauseMenuOpen(session: InputSession): boolean {
    return !!session.instructions && session.instructions.style.display !== 'none';
}

/** Escape on the focused element: menus close and the pause menu resumes as from the keyboard. */
function sendEscape(): void {
    const target =
        document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true,
        })
    );
    target.dispatchEvent(
        new KeyboardEvent('keyup', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true,
        })
    );
    // The keyboard device saw that Escape; prompts should stay on the pad's glyphs.
    input.setDevice('gamepad');
}

function resume(session: InputSession): void {
    // Still generating the world: the start button is disabled, as for a click.
    if (session.startButton?.disabled) return;
    const el = session.controls.domElement as HTMLElement | null;
    try {
        // Older browsers return nothing instead of a promise.
        const p: Promise<void> | undefined = el?.requestPointerLock();
        p?.catch(() => announce('Click or press Enter to resume', 'assertive'));
    } catch {
        announce('Click or press Enter to resume', 'assertive');
    }
}

export function bindGamepadMenu(session: InputSession): () => void {
    const offs = [
        input.onPress('pause', () => {
            if (isPauseMenuOpen(session)) resume(session);
            else if (input.isContextActive('menu')) sendEscape();
            else if (session.controls.isLocked) session.controls.unlock();
        }),
        input.onPress('menu.next', () => moveFocus(session, 1), { repeat: true }),
        input.onPress('menu.prev', () => moveFocus(session, -1), { repeat: true }),
        input.onPress('menu.confirm', () => {
            const el = document.activeElement;
            // The start button's own click locks without catching a refusal.
            if (el === session.startButton) resume(session);
            else if (el instanceof HTMLElement && el !== document.body) el.click();
            else moveFocus(session, 1);
        }),
        input.onPress('menu.back', sendEscape),
    ];
    return () => offs.forEach((off) => off());
}

import { openAccessibilityMenu } from '../../../ui/accessibility-menu-lazy.ts';
import { keyStates } from '../input-types.ts';
import type { InputKeyboardHandlers } from './keyboard-handlers.ts';
import type { InputSession } from './session.ts';

function setupAbilityKeyboardInteractions(
    handlers: InputKeyboardHandlers,
    element: HTMLElement | null,
    keyCode: string
): void {
    if (!element) return;
    const { onKeyDown, onKeyUp } = handlers;

    element.addEventListener('keydown', (e: KeyboardEvent) => {
        // ♿ Aria: Support native keyboard activation (Enter/Space) for non-semantic role="button" elements
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.repeat) return;
            element.classList.add('keyboard-active');
            onKeyDown(new KeyboardEvent('keydown', { code: keyCode }));
        }
    });

    element.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            element.classList.remove('keyboard-active');
            onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
        }
    });

    element.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return; // Only left click / primary touch
        e.preventDefault();
        e.stopPropagation();
        element.setPointerCapture(e.pointerId);
        element.classList.add('keyboard-active');
        onKeyDown(new KeyboardEvent('keydown', { code: keyCode }));
    });

    element.addEventListener('pointerup', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('keyboard-active');
        onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
    });

    element.addEventListener('pointercancel', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('keyboard-active');
        onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
    });

    element.addEventListener('pointerout', () => {
        if (element.classList.contains('keyboard-active')) {
            element.classList.remove('keyboard-active');
            onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
        }
    });

    element.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
    });

    element.addEventListener('blur', () => {
        element.classList.remove('keyboard-active');
        onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
    });
}

export function setupHudControls(session: InputSession, handlers: InputKeyboardHandlers): () => void {
    session.toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (session.toggleDayNightBtn && session.toggleDayNightCallback) {
        session.toggleDayNightBtn.addEventListener('click', session.toggleDayNightCallback);
    }

    type DpadDirection = 'forward' | 'backward' | 'left' | 'right';

    const dpadMap: Record<string, DpadDirection> = {
        'dpad-forward': 'forward',
        'dpad-backward': 'backward',
        'dpad-left': 'left',
        'dpad-right': 'right',
    };

    const dpadHeld = new Set<DpadDirection>();

    const dpadPress = (dir: DpadDirection, btn: HTMLElement) => {
        dpadHeld.add(dir);
        keyStates[dir] = true;
        btn.setAttribute('aria-pressed', 'true');
    };

    const dpadRelease = (dir: DpadDirection, btn: HTMLElement) => {
        dpadHeld.delete(dir);
        keyStates[dir] = false;
        btn.setAttribute('aria-pressed', 'false');
    };

    for (const [id, dir] of Object.entries(dpadMap)) {
        const btn = document.getElementById(id) as HTMLElement | null;
        if (!btn) continue;

        btn.addEventListener('pointerdown', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            btn.setPointerCapture(e.pointerId);
            dpadPress(dir, btn);
        });

        btn.addEventListener('pointerup', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(dir, btn);
        });

        btn.addEventListener('pointercancel', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(dir, btn);
        });

        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    const releaseDpadAll = () => {
        for (const [id, dir] of Object.entries(dpadMap)) {
            const btn = document.getElementById(id) as HTMLElement | null;
            if (btn) dpadRelease(dir, btn);
        }
    };
    window.addEventListener('blur', releaseDpadAll);

    setupAbilityKeyboardInteractions(handlers, session.hudDash, 'KeyE');
    setupAbilityKeyboardInteractions(handlers, session.hudMine, 'KeyF');
    setupAbilityKeyboardInteractions(handlers, session.hudPhase, 'KeyZ');

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) {
        openA11yBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAccessibilityMenu();
        });
    }

    // ♿ Aria: Generic tactile keyboard feedback for HUD buttons
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.key === 'Enter' || e.key === ' ') {
            const activeElement = document.activeElement as HTMLElement;
            if (
                activeElement &&
                !activeElement.classList.contains('keyboard-active') &&
                (activeElement.classList.contains('toggle-button') ||
                 activeElement.classList.contains('cta-button') ||
                 activeElement.classList.contains('secondary-button') ||
                 activeElement.classList.contains('file-label') ||
                 activeElement.classList.contains('mode-btn'))
            ) {
                activeElement.classList.add('keyboard-active');
            }
        }
    });

    document.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const activeElements = document.querySelectorAll('.keyboard-active');
            activeElements.forEach(el => {
                // ability-slots manage their own state to trigger onKeyUp logic
                if (!el.classList.contains('ability-slot')) {
                    el.classList.remove('keyboard-active');
                }
            });
        }
    });

    document.addEventListener('focusout', (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target && target.classList && target.classList.contains('keyboard-active')) {
            // ability-slots manage their own state
            if (!target.classList.contains('ability-slot')) {
                target.classList.remove('keyboard-active');
            }
        }
    });

    return releaseDpadAll;
}

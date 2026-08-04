import { openAccessibilityMenu } from '../../../ui/accessibility-menu.ts';
import { keyStates } from '../input-types.ts';
import type { InputSession } from './session.ts';
import type { InputKeyboardHandlers } from './keyboard-handlers.ts';

function setupAbilityKeyboardInteractions(
    handlers: InputKeyboardHandlers,
    element: HTMLElement | null,
    keyCode: string
): void {
    if (!element) return;
    const { onKeyDown, onKeyUp } = handlers;

    element.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            onKeyDown(new KeyboardEvent('keydown', { code: keyCode }));
        }
    });

    element.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
        }
    });

    element.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        element.setPointerCapture(e.pointerId);
        onKeyDown(new KeyboardEvent('keydown', { code: keyCode }));
    });

    element.addEventListener('pointerup', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
    });

    element.addEventListener('pointercancel', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onKeyUp(new KeyboardEvent('keyup', { code: keyCode }));
    });

    element.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
    });

    element.addEventListener('blur', () => {
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

    return releaseDpadAll;
}

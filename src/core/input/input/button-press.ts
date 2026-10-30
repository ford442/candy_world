import type { InputSession } from './session.ts';

export interface ButtonPressHandlers {
    triggerButtonPressDown: (buttonId: string) => void;
    triggerButtonPressUp: (buttonId: string) => void;
}

export function createButtonPressHandlers(session: InputSession): ButtonPressHandlers {
    const elementCache = new Map<string, HTMLElement | null>();

    function getCachedElement(id: string): HTMLElement | null {
        if (!elementCache.has(id)) {
            elementCache.set(id, document.getElementById(id));
        }
        return elementCache.get(id) || null;
    }

    function triggerButtonPressDown(buttonId: string): void {
        const btn = getCachedElement(buttonId);
        if (btn && btn.getAttribute('aria-disabled') !== 'true') {
            btn.classList.add('keyboard-active');
            session.activeKeyboardButtons.add(buttonId);
        }
    }

    function triggerButtonPressUp(buttonId: string): void {
        const btn = getCachedElement(buttonId);
        if (btn) {
            btn.classList.remove('keyboard-active');
        }
        session.activeKeyboardButtons.delete(buttonId);
    }

    const clearAll = () => {
        for (const buttonId of session.activeKeyboardButtons) {
            triggerButtonPressUp(buttonId);
        }
    };
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearAll();
    });

    return { triggerButtonPressDown, triggerButtonPressUp };
}

import type { InputSession } from './session.ts';

export interface ButtonPressHandlers {
    triggerButtonPressDown: (buttonId: string) => void;
    triggerButtonPressUp: (buttonId: string) => void;
}

export function createButtonPressHandlers(session: InputSession): ButtonPressHandlers {
    function triggerButtonPressDown(buttonId: string): void {
        const btn = document.getElementById(buttonId);
        if (btn && btn.getAttribute('aria-disabled') !== 'true') {
            session.activeKeyboardButtons.add(buttonId);
        }
    }

    function triggerButtonPressUp(buttonId: string): void {
        const btn = document.getElementById(buttonId);
        if (btn) {
        }
        session.activeKeyboardButtons.delete(buttonId);
    }

    window.addEventListener('blur', () => {
        for (const buttonId of session.activeKeyboardButtons) {
            triggerButtonPressUp(buttonId);
        }
    });

    return { triggerButtonPressDown, triggerButtonPressUp };
}

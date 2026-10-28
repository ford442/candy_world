import { openAccessibilityMenu } from '../../../ui/accessibility-menu-lazy.ts';
import { input, type Device } from '../actions/index.ts';
import type { InputSession } from './session.ts';

const deviceOf = (e: PointerEvent): Device => (e.pointerType === 'touch' ? 'touch' : 'kbm');

/**
 * An ability slot is an on-screen button for its action (#2027): it presses
 * the `ui:<name>` source, which the gameplay context binds like a key.
 */
function setupAbilitySlot(element: HTMLElement | null, name: string): void {
    if (!element) return;
    const source = `ui:${name}`;
    const press = (device: Device) => input.press(source, 0, device);
    const release = () => input.release(source);

    element.addEventListener('keydown', (e: KeyboardEvent) => {
        // ♿ Aria: Support native keyboard activation (Enter/Space) for non-semantic role="button" elements
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.repeat) return;
            element.classList.add('keyboard-active');
            press('kbm');
        }
    });

    element.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            element.classList.remove('keyboard-active');
            release();
        }
    });

    element.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return; // Only left click / primary touch
        e.preventDefault();
        e.stopPropagation();
        element.setPointerCapture(e.pointerId);
        element.classList.add('keyboard-active');
        press(deviceOf(e));
    });

    element.addEventListener('pointerup', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('keyboard-active');
        release();
    });

    element.addEventListener('pointercancel', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('keyboard-active');
        release();
    });

    element.addEventListener('pointerout', (e: PointerEvent) => {
        const nextTarget = e.relatedTarget;
        if (nextTarget instanceof Node && element.contains(nextTarget)) return;
        if (element.hasPointerCapture(e.pointerId)) return;
        if (element.classList.contains('keyboard-active')) {
            element.classList.remove('keyboard-active');
            release();
        }
    });

    element.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
    });

    element.addEventListener('blur', () => {
        element.classList.remove('keyboard-active');
        release();
    });
}

export function setupHudControls(session: InputSession): () => void {
    session.toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (session.toggleDayNightBtn && session.toggleDayNightCallback) {
        session.toggleDayNightBtn.addEventListener('click', session.toggleDayNightCallback);
    }

    const dpadIds = ['dpad-forward', 'dpad-backward', 'dpad-left', 'dpad-right'];

    // Each D-pad button is the `ui:<id>` source the gameplay context binds to `move`.
    const dpadPress = (id: string, btn: HTMLElement, device: Device) => {
        input.press(`ui:${id}`, 0, device);
        btn.setAttribute('aria-pressed', 'true');
    };

    const dpadRelease = (id: string, btn: HTMLElement) => {
        input.release(`ui:${id}`);
        btn.setAttribute('aria-pressed', 'false');
    };

    for (const id of dpadIds) {
        const btn = document.getElementById(id);
        if (!btn) continue;

        btn.addEventListener('pointerdown', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            btn.setPointerCapture(e.pointerId);
            dpadPress(id, btn, deviceOf(e));
        });

        btn.addEventListener('pointerup', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(id, btn);
        });

        btn.addEventListener('pointercancel', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(id, btn);
        });

        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    const releaseDpadAll = () => {
        for (const id of dpadIds) {
            const btn = document.getElementById(id);
            if (btn) dpadRelease(id, btn);
        }
    };
    window.addEventListener('blur', releaseDpadAll);

    setupAbilitySlot(session.hudDash, 'dash');
    setupAbilitySlot(session.hudMine, 'mine');
    setupAbilitySlot(session.hudPhase, 'phase');
    setupAbilitySlot(document.getElementById('ability-build'), 'build');

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) {
        openA11yBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAccessibilityMenu();
        });
    }

    return releaseDpadAll;
}

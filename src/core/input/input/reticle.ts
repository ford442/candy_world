/**
 * Visual reticle + ability-slot pointer/keyboard forwarding.
 */

export function ensureGameReticle(): void {
    if (!document.getElementById('game-reticle')) {
        const reticle = document.createElement('div');
        reticle.id = 'game-reticle';
        document.body.appendChild(reticle);
    }
}

export function createUpdateReticleState(): (
    state: 'idle' | 'hover' | 'interact',
    label?: string
) => void {
    return function updateReticleState(state: 'idle' | 'hover' | 'interact', label?: string): void {
        const reticle = document.getElementById('game-reticle');
        if (!reticle) return;
        const reticleLabel = document.getElementById('reticle-label');

        reticle.classList.remove('hover', 'interact');

        if (state === 'hover') {
            reticle.classList.add('hover');
        } else if (state === 'interact') {
            reticle.classList.add('interact');
        }

        if (reticleLabel) {
            if (state === 'hover' && label) {
                reticleLabel.innerText = label;
                reticleLabel.classList.add('visible');
            } else if (state === 'idle') {
                reticleLabel.classList.remove('visible');
            }
        }
    };
}

export function setupAbilitySlotInputs(): void {
    const abilitySlots = document.querySelectorAll('.ability-slot[role="button"]');
    abilitySlots.forEach((slot) => {
        const actionKey = slot.getAttribute('aria-keyshortcuts');
        if (!actionKey) return;

        // Pointer / touch support (hold)
        slot.addEventListener('pointerdown', (e) => {
            if (slot.getAttribute('aria-disabled') === 'true') return;
            const ev = e as PointerEvent;
            if (ev.button !== 0) return; // Only left click / primary touch
            const keyEvent = new KeyboardEvent('keydown', {
                key: actionKey,
                code: `Key${actionKey.toUpperCase()}`,
                bubbles: true,
            });
            document.dispatchEvent(keyEvent);
            slot.classList.add('keyboard-active');
        });

        slot.addEventListener('pointerup', () => {
            const keyEvent = new KeyboardEvent('keyup', {
                key: actionKey,
                code: `Key${actionKey.toUpperCase()}`,
                bubbles: true,
            });
            document.dispatchEvent(keyEvent);
            slot.classList.remove('keyboard-active');
        });

        slot.addEventListener('pointercancel', () => {
            const keyEvent = new KeyboardEvent('keyup', {
                key: actionKey,
                code: `Key${actionKey.toUpperCase()}`,
                bubbles: true,
            });
            document.dispatchEvent(keyEvent);
            slot.classList.remove('keyboard-active');
        });

        slot.addEventListener('pointerout', () => {
            // In case pointer leaves element while held
            if (slot.classList.contains('keyboard-active')) {
                const keyEvent = new KeyboardEvent('keyup', {
                    key: actionKey,
                    code: `Key${actionKey.toUpperCase()}`,
                    bubbles: true,
                });
                document.dispatchEvent(keyEvent);
                slot.classList.remove('keyboard-active');
            }
        });

        // Keyboard (Enter/Space)
        slot.addEventListener('keydown', (e) => {
            if (slot.getAttribute('aria-disabled') === 'true') return;
            const ev = e as KeyboardEvent;
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                const keyEvent = new KeyboardEvent('keydown', {
                    key: actionKey,
                    code: `Key${actionKey.toUpperCase()}`,
                    bubbles: true,
                });
                document.dispatchEvent(keyEvent);
                slot.classList.add('keyboard-active');
            }
        });

        slot.addEventListener('keyup', (e) => {
            const ev = e as KeyboardEvent;
            if (ev.key === 'Enter' || ev.key === ' ') {
                const keyEvent = new KeyboardEvent('keyup', {
                    key: actionKey,
                    code: `Key${actionKey.toUpperCase()}`,
                    bubbles: true,
                });
                document.dispatchEvent(keyEvent);
                slot.classList.remove('keyboard-active');
            }
        });

        // Prevent context menu on long-press/touch
        slot.addEventListener('contextmenu', (e) => e.preventDefault());
    });
}

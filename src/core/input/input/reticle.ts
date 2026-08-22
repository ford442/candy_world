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


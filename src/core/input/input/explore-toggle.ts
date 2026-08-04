import { announcePolite } from '../../../ui/announcer.ts';
import { bootstrapExploreFromPreference, isExploreActive } from '../../camera-modes.ts';
import type { InputSession } from './session.ts';

export function setupExploreToggle(session: InputSession): void {
    const toggleExploreBtn = document.getElementById('toggleExploreBtn');
    if (toggleExploreBtn) {
        toggleExploreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            session.exploreCamera.togglePersistent();
            const active = isExploreActive();
            toggleExploreBtn.setAttribute('aria-checked', String(active));
            toggleExploreBtn.innerHTML = active
                ? '<span aria-hidden="true">🚶</span> First-Person <span class="key-badge" aria-hidden="true">Tab</span>'
                : '<span aria-hidden="true">🎥</span> Explore Mode <span class="key-badge" aria-hidden="true">Tab</span>';
            toggleExploreBtn.setAttribute(
                'aria-label',
                active ? 'Toggle First-person camera mode' : 'Toggle Explore camera mode'
            );
            toggleExploreBtn.title = active
                ? 'Return to first-person view (Tab)'
                : 'Cinematic orbit camera (hold Tab)';
            announcePolite(active ? 'Explore mode enabled' : 'First-person mode');
        });
    }

    void bootstrapExploreFromPreference();
}

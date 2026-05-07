/**
 * Audio Controls Module
 * Handles mute toggle, volume adjustment, and audio button UI state
 */

import { AudioSystem } from '../../audio/audio-system';
import { keyStates } from './input-types.ts';
import { announce, announceValueChange } from '../../ui/announcer.ts';

let audioSystemRef: AudioSystem | null = null;

// DOM Elements
let toggleMuteBtn: HTMLElement | null = null;
let volDownBtn: HTMLButtonElement | null = null;
let volUpBtn: HTMLButtonElement | null = null;

/**
 * Initialize audio controls with DOM references
 */
export function initAudioControls(audioSystem: AudioSystem): void {
    audioSystemRef = audioSystem;
    
    toggleMuteBtn = document.getElementById('toggleMuteBtn');
    volDownBtn = document.getElementById('volDownBtn') as HTMLButtonElement | null;
    volUpBtn = document.getElementById('volUpBtn') as HTMLButtonElement | null;

    // Initialize Volume Buttons State
    if (volDownBtn) volDownBtn.setAttribute('aria-disabled', String(audioSystem.volume <= 0.01));
    if (volUpBtn) volUpBtn.setAttribute('aria-disabled', String(audioSystem.volume >= 0.99));

    // NEW: Initialize Tooltips
    const initialVolPct = Math.round(audioSystem.volume * 100);
    if (volDownBtn) {
        const isMin = audioSystem.volume <= 0.01;
        volDownBtn.title = isMin ? "Minimum volume reached" : `Decrease Volume (-) • ${initialVolPct}%`;
        volDownBtn.setAttribute('aria-label', isMin ? "Decrease Volume (Disabled: Minimum reached)" : `Decrease Volume (Current: ${initialVolPct}%)`);
    }
    if (volUpBtn) {
        const isMax = audioSystem.volume >= 0.99;
        volUpBtn.title = isMax ? "Maximum volume reached" : `Increase Volume (+) • ${initialVolPct}%`;
        volUpBtn.setAttribute('aria-label', isMax ? "Increase Volume (Disabled: Maximum reached)" : `Increase Volume (Current: ${initialVolPct}%)`);
    }
    if (toggleMuteBtn) toggleMuteBtn.title = audioSystem.isMuted ? 'Unmute Audio (M)' : 'Mute Audio (M)';

    // Attach event listeners
    if (volDownBtn) {
        volDownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (volDownBtn!.getAttribute('aria-disabled') === 'true') return;
            adjustVolume(-0.1);
        });
    }

    if (volUpBtn) {
        volUpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (volUpBtn!.getAttribute('aria-disabled') === 'true') return;
            adjustVolume(0.1);
        });
    }

    if (toggleMuteBtn) {
        toggleMuteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent locking/unlocking if that's an issue
            toggleMute();
        });
    }
}

// Helper: Update Mute UI
export const updateMuteUI = (isMuted: boolean) => {
    if (toggleMuteBtn) {
        toggleMuteBtn.setAttribute('aria-pressed', String(isMuted));
        toggleMuteBtn.innerHTML = isMuted ? '<span aria-hidden="true">🔇</span> Unmute <span class="key-badge" aria-hidden="true">M</span>' : '<span aria-hidden="true">🔊</span> Mute <span class="key-badge" aria-hidden="true">M</span>';
        toggleMuteBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
        toggleMuteBtn.title = isMuted ? 'Unmute Audio (M)' : 'Mute Audio (M)';
    }
};

// Helper: Mute Toggle Logic
export const toggleMute = () => {
    if (!audioSystemRef) return false;
    
    const isMuted = audioSystemRef.toggleMute();
    updateMuteUI(isMuted);

    import('../../utils/toast.js').then(({ showToast }) => {
        showToast(isMuted ? "Audio Muted 🔇" : "Audio Unmuted 🔊", isMuted ? '🔇' : '🔊');
    });
    
    announce(isMuted ? "Audio Muted" : "Audio Unmuted", "polite");

    return isMuted;
};

// Helper: Adjust Volume
export const adjustVolume = (delta: number) => {
    if (!audioSystemRef) return;
    
    let newVol = audioSystemRef.volume + delta;
    newVol = Math.max(0, Math.min(1, newVol));
    audioSystemRef.setVolume(newVol);

    if (newVol > 0 && audioSystemRef.isMuted) {
        audioSystemRef.isMuted = false;
        updateMuteUI(false);
    }

    const percentage = Math.round(newVol * 100);

    // UX: Update Button States (Visual Polish)
    // Use epsilon for float comparison safety
    if (volDownBtn) {
        const isDisabled = newVol <= 0.01;
        volDownBtn.setAttribute('aria-disabled', String(isDisabled));
        // 🎨 Palette: Explain why the button is disabled
        volDownBtn.title = isDisabled ? "Minimum volume reached" : `Decrease Volume (-) • ${percentage}%`;
        volDownBtn.setAttribute('aria-label', isDisabled ? "Decrease Volume (Disabled: Minimum reached)" : `Decrease Volume (Current: ${percentage}%)`);
    }
    if (volUpBtn) {
        const isDisabled = newVol >= 0.99;
        volUpBtn.setAttribute('aria-disabled', String(isDisabled));
        // 🎨 Palette: Explain why the button is disabled
        volUpBtn.title = isDisabled ? "Maximum volume reached" : `Increase Volume (+) • ${percentage}%`;
        volUpBtn.setAttribute('aria-label', isDisabled ? "Increase Volume (Disabled: Maximum reached)" : `Increase Volume (Current: ${percentage}%)`);
    }

    const icon = newVol === 0 ? '🔇' : newVol < 0.5 ? '🔉' : '🔊';

    import('../../utils/toast.js').then(({ showToast }) => {
        showToast(`Volume: ${percentage}% ${icon}`, icon);
    });

    announceValueChange('Volume', percentage, 0, 100);
};

/**
 * Handle KeyM for mute toggle from keyboard handler
 */
export function handleMuteKey(): void {
    toggleMute();
}

/**
 * Handle volume adjustment keys (+/-)
 */
export function handleVolumeKey(delta: number): void {
    adjustVolume(delta);
}

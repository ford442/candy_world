/**
 * Playlist Manager Module
 * Handles playlist UI rendering, jukebox modal, and playlist-related event handlers
 */

import { AudioSystem } from '../../audio/audio-system';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { formatSongTitle, filterValidMusicFiles } from './input-types.ts';
import { announce } from '../../ui/announcer.ts';

// State
let isPlaylistOpen = false;
let wasPausedBeforePlaylist = false;
let lastFocusedElement: Element | null = null;
let releaseJukeboxFocus: (() => void) | null = null;

// DOM Elements
let playlistOverlay: HTMLElement | null = null;
let playlistBackdrop: HTMLElement | null = null;
let playlistList: HTMLElement | null = null;
let closePlaylistBtn: HTMLElement | null = null;
let playlistCloseX: HTMLElement | null = null;
let playlistUploadInput: HTMLInputElement | null = null;
let openJukeboxBtn: HTMLElement | null = null;
let nowPlayingContainer: HTMLElement | null = null;
let nowPlayingText: HTMLElement | null = null;

// References passed from main input module
let audioSystemRef: AudioSystem | null = null;
let controlsRef: PointerLockControls | null = null;
let instructionsRef: HTMLElement | null = null;

/**
 * Initialize playlist manager
 */
export function initPlaylistManager(
    audioSystem: AudioSystem,
    controls: PointerLockControls,
    instructions: HTMLElement | null
): void {
    audioSystemRef = audioSystem;
    controlsRef = controls;
    instructionsRef = instructions;

    // Get DOM elements
    playlistOverlay = document.getElementById('playlist-overlay');
    playlistBackdrop = document.getElementById('playlist-backdrop');
    playlistList = document.getElementById('playlist-list');
    closePlaylistBtn = document.getElementById('closePlaylistBtn');
    playlistCloseX = document.getElementById('playlistCloseX');
    playlistUploadInput = document.getElementById('playlistUploadInput') as HTMLInputElement | null;
    openJukeboxBtn = document.getElementById('openJukeboxBtn');
    nowPlayingContainer = document.getElementById('nowPlayingContainer');
    nowPlayingText = document.getElementById('nowPlayingText');

    // Initialize state
    if (audioSystem.getPlaylist) {
        const playlist = audioSystem.getPlaylist();
        updateJukeboxButtonState(playlist.length);

        // 🎨 Palette: Restore Now Playing info if music is already running
        const currentIdx = audioSystem.getCurrentIndex();
        if (currentIdx >= 0 && playlist[currentIdx]) {
            if (nowPlayingContainer && nowPlayingText) {
                const trackName = formatSongTitle(playlist[currentIdx].name);
                nowPlayingText.innerText = trackName;
                nowPlayingContainer.style.display = 'flex';
                nowPlayingContainer.setAttribute('aria-label', `Now Playing: ${trackName}`);
                document.title = `🎵 ${trackName} - Candy World`;
            }
        }
    }

    // Hook up AudioSystem callbacks
    audioSystem.onPlaylistUpdate = (playlist: File[]) => {
        if (isPlaylistOpen) renderPlaylist();
        updateJukeboxButtonState(playlist ? playlist.length : 0);

        if (!playlist || playlist.length === 0) {
            document.title = "Candy World";
        }
    };

    // UX: Show toast and update playlist when track changes
    audioSystem.onTrackChange = (index: number) => {
        if (isPlaylistOpen) renderPlaylist();

        // Show "Now Playing" toast
        const songs = audioSystem.getPlaylist();
        if (songs && songs[index]) {
            const trackName = formatSongTitle(songs[index].name);
            import('../../utils/toast.js').then(({ showToast }) => {
                showToast(`Now Playing: ${trackName}`, '🎵');
            });

            // 🎨 Palette: Update "Now Playing" in Pause Menu
            if (nowPlayingContainer && nowPlayingText) {
                nowPlayingText.innerText = trackName;
                nowPlayingContainer.style.display = 'flex';
                nowPlayingContainer.setAttribute('aria-label', `Now Playing: ${trackName}`);
            }

            // 🎨 Palette: Update Browser Tab Title
            document.title = `🎵 ${trackName} - Candy World`;

            // ♿ Aria: Announce the new track to screen readers dynamically
            announce(`Now Playing: ${trackName}`, 'polite');
        }
    };

    // Event Listeners for UI
    if (closePlaylistBtn) {
        closePlaylistBtn.addEventListener('click', togglePlaylist);
    }

    if (playlistCloseX) {
        playlistCloseX.addEventListener('click', togglePlaylist);
    }

    if (playlistBackdrop) {
        playlistBackdrop.addEventListener('click', togglePlaylist);
    }

    if (playlistUploadInput) {
        playlistUploadInput.addEventListener('change', handlePlaylistUpload);
    }

    if (openJukeboxBtn) {
        openJukeboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlaylist();
        });
    }
}

/**
 * Handle playlist file upload
 */
function handlePlaylistUpload(e: Event): void {
    if (!audioSystemRef) return;
    
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
        const { validFiles, invalidFiles } = filterValidMusicFiles(files);
        if (validFiles.length > 0) {
            audioSystemRef.addToQueue(validFiles);
            import('../../utils/toast.js').then(({ showToast }) => {
                if (invalidFiles.length > 0) {
                    showToast(`Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`, '⚠️');
                } else {
                    showToast(`Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`, '📂');
                }
            });
        } else {
            import('../../utils/toast.js').then(({ showToast }) => {
                showToast("❌ Only .mod, .xm, .it, .s3m allowed!", '🚫');
            });
        }
    }
    target.value = '';
}

/**
 * Check if playlist is currently open
 */
export function getIsPlaylistOpen(): boolean {
    return isPlaylistOpen;
}

/**
 * Set the playlist open state (used by main input for forced closes)
 */
export function setIsPlaylistOpen(value: boolean): void {
    isPlaylistOpen = value;
}

/**
 * Close playlist and release focus (for cleanup)
 */
export function closePlaylist(): void {
    if (isPlaylistOpen) {
        togglePlaylist();
    }
}

/**
 * Get the focus release function for cleanup
 */
export function getReleaseJukeboxFocus(): (() => void) | null {
    return releaseJukeboxFocus;
}

/**
 * Set the focus release function
 */
export function setReleaseJukeboxFocus(fn: (() => void) | null): void {
    releaseJukeboxFocus = fn;
}

/**
 * Render the playlist UI
 */
export function renderPlaylist(): void {
    if (!playlistList || !audioSystemRef) return;
    
    playlistList.innerHTML = '';
    const songs = audioSystemRef.getPlaylist();
    const currentIdx = audioSystemRef.getCurrentIndex();

    songs.forEach((file: File, index: number) => {
        const li = document.createElement('li');
        li.className = `playlist-item ${index === currentIdx ? 'active' : ''}`;

        // UX: Use a button for keyboard accessibility
        const displayName = formatSongTitle(file.name);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'playlist-btn';
        // 🎨 Palette: Use formatted title for tooltip and screen readers
        btn.title = displayName;
        btn.setAttribute('aria-label', `Play ${displayName}`);
        if (index === currentIdx) {
            btn.setAttribute('aria-current', 'true');
        }

        btn.innerHTML = `
            <span class="song-title">${index + 1}. ${displayName}</span>
            <span class="status-icon" aria-hidden="true">${index === currentIdx ? '🔊' : '▶️'}</span>
        `;

        btn.onclick = (e) => {
            // Prevent bubbling if needed, though li has no click handler now
            e.stopPropagation();
            audioSystemRef!.playAtIndex(index);
            renderPlaylist(); // Re-render to update active state

            // Keep focus on the clicked item (re-rendered)
            // We need to find the new button after render
            requestAnimationFrame(() => {
                const newItems = playlistList!.querySelectorAll('.playlist-btn');
                if (newItems[index] && newItems[index] instanceof HTMLElement) {
                    (newItems[index] as HTMLElement).focus();
                }
            });
        };

        // Remove Button (UX Improvement)
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'playlist-remove-btn';
        removeBtn.innerHTML = '<span aria-hidden="true">×</span>';
        // 🎨 Palette: Use formatted title for tooltip and screen readers
        removeBtn.title = `Remove ${displayName}`;
        removeBtn.setAttribute('aria-label', `Remove ${displayName} from playlist`);

        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const wasActive = document.activeElement === removeBtn;
            audioSystemRef!.removeTrack(index);
            renderPlaylist();

            // 🎨 Palette: Provide explicit feedback for destructive action
            import('../../utils/toast.js').then(({ showToast }) => {
                showToast(`Removed ${displayName}`, '🗑️', 3000);
            });

            // UX: Restore Focus to an appropriate element
            requestAnimationFrame(() => {
                const removeBtns = playlistList!.querySelectorAll('.playlist-remove-btn');
                const playBtns = playlistList!.querySelectorAll('.playlist-btn');

                // Try focusing the next remove button (at same index, since list shifted)
                if (removeBtns[index]) {
                    (removeBtns[index] as HTMLElement).focus();
                } else if (removeBtns[index - 1]) {
                    // Or the previous one
                    (removeBtns[index - 1] as HTMLElement).focus();
                } else if (playBtns[0]) {
                    // Or the first song
                    (playBtns[0] as HTMLElement).focus();
                }
            });
        };

        li.appendChild(btn);
        li.appendChild(removeBtn);
        playlistList.appendChild(li);
    });
    
    if (songs.length === 0) {
        // UX: Make Empty State Actionable
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        li.style.padding = '20px 0';
        li.style.textAlign = 'center';

        const emptyBtn = document.createElement('button');
        emptyBtn.type = 'button';
        emptyBtn.className = 'secondary-button'; // Reuse existing class for consistent look
        // 🎨 Palette: Improve empty state by making it clear and actionable using existing styles
        emptyBtn.style.fontSize = '1em'; // Make it slightly more prominent if needed
        emptyBtn.style.width = '100%';
        emptyBtn.innerHTML = `
            <span style="display: block; margin-bottom: 4px;"><span aria-hidden="true">🎵</span> Your playlist is empty</span>
            <span style="display: block; font-size: 0.9em; opacity: 0.9;">Click to add music! <span aria-hidden="true">🍭</span></span>
        `;
        emptyBtn.setAttribute('aria-label', 'Playlist empty. Click to upload music files.');

        emptyBtn.onclick = (e) => {
            e.stopPropagation();
            if (playlistUploadInput) playlistUploadInput.click();
        };

        li.appendChild(emptyBtn);
        playlistList.appendChild(li);
    }
}

/**
 * Update jukebox button state with song count
 */
export function updateJukeboxButtonState(count: number): void {
    if (!openJukeboxBtn) return;
    const countText = count > 0 ? ` (${count})` : '';
    openJukeboxBtn.innerHTML = `Open Jukebox${countText} <span class="key-badge" aria-hidden="true">Q</span>`;
    openJukeboxBtn.setAttribute('aria-label', `Open Jukebox playlist${count > 0 ? `, ${count} songs` : ''}`);
    // Ensure aria-expanded state is preserved when updating innerHTML
    openJukeboxBtn.setAttribute('aria-expanded', String(isPlaylistOpen));
}

/**
 * Toggle playlist open/closed
 */
export function togglePlaylist(): void {
    if (!controlsRef) return;
    
    isPlaylistOpen = !isPlaylistOpen;

    if (openJukeboxBtn) {
        openJukeboxBtn.setAttribute('aria-expanded', String(isPlaylistOpen));
    }

    if (isPlaylistOpen) {
        // OPENING

        // 🎨 Palette: Smart Context Preservation
        // Check if we are opening from the Pause Menu (instructions visible)
        wasPausedBeforePlaylist = instructionsRef ? (instructionsRef.style.display !== 'none') : false;

        lastFocusedElement = document.activeElement;
        controlsRef.unlock(); // Unlock mouse so we can click

        // Note: releasePauseMenuFocus is managed by the main input module
        // We notify via a callback mechanism if needed
        if (instructionsRef) instructionsRef.style.display = 'none'; // Ensure pause menu is hidden

        if (playlistOverlay) {
            playlistOverlay.style.display = 'flex';
            releaseJukeboxFocus = trapFocusInside(playlistOverlay);
        }
        if (playlistBackdrop) playlistBackdrop.style.display = 'block';
        renderPlaylist();
        
        // UX: Auto-focus the currently playing track for immediate context
        requestAnimationFrame(() => {
            if (!audioSystemRef || !playlistList) return;
            const currentIdx = audioSystemRef.getCurrentIndex();
            const playlistBtns = playlistList.querySelectorAll('.playlist-btn');

            if (currentIdx >= 0 && playlistBtns[currentIdx]) {
                const activeBtn = playlistBtns[currentIdx] as HTMLElement;
                activeBtn.focus();
                // Ensure the active song is visible in the scrollable list
                activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } else if (closePlaylistBtn) {
                closePlaylistBtn.focus();
            }
        });
    } else {
        // CLOSING
        if (playlistOverlay) playlistOverlay.style.display = 'none';
        if (playlistBackdrop) playlistBackdrop.style.display = 'none';

        if (releaseJukeboxFocus) {
            releaseJukeboxFocus();
            releaseJukeboxFocus = null;
        }

        // 🎨 Palette: Smart Context Restoration
        if (wasPausedBeforePlaylist) {
            // Return to Pause Menu
            if (instructionsRef) {
                instructionsRef.style.display = 'flex';
                // Focus trap is re-established by main input module
            }
            // Restore focus to the button that opened the jukebox (e.g. Open Jukebox button)
            if (lastFocusedElement && lastFocusedElement instanceof HTMLElement) {
                lastFocusedElement.focus();
            }
            // Do NOT lock controls, stay unlocked
        } else {
            // Return to Game
            controlsRef.lock(); // Re-lock mouse to play
        }
    }
}

/**
 * Get the "wasPausedBeforePlaylist" state for context restoration
 */
export function getWasPausedBeforePlaylist(): boolean {
    return wasPausedBeforePlaylist;
}

/**
 * Set the "wasPausedBeforePlaylist" state
 */
export function setWasPausedBeforePlaylist(value: boolean): void {
    wasPausedBeforePlaylist = value;
}

/**
 * Get the last focused element before opening playlist
 */
export function getLastFocusedElement(): Element | null {
    return lastFocusedElement;
}

/**
 * Handle playlist-specific key events
 * Returns true if the key was handled
 */
export function handlePlaylistKeyDown(event: KeyboardEvent): boolean {
    if (!isPlaylistOpen || !playlistOverlay) return false;
    
    // Close on Q
    if (event.code === 'KeyQ') {
        event.preventDefault();
        togglePlaylist();
        return true;
    }

    // Upload on U
    if (event.code === 'KeyU') {
        const playlistInput = document.getElementById('playlistUploadInput') as HTMLInputElement;
        if (playlistInput) playlistInput.click();
        return true;
    }

    // UX: Arrow Key Navigation for Playlist
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        const playlistBtns = Array.from(playlistOverlay.querySelectorAll('.playlist-btn')) as HTMLElement[];
        if (playlistBtns.length > 0) {
            event.preventDefault(); // Prevent scrolling
            const currentIndex = playlistBtns.indexOf(document.activeElement as HTMLElement);
            let nextIndex;

            if (event.code === 'ArrowDown') {
                nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % playlistBtns.length;
            } else {
                nextIndex = currentIndex === -1 ? playlistBtns.length - 1 : (currentIndex - 1 + playlistBtns.length) % playlistBtns.length;
            }
            playlistBtns[nextIndex].focus();
        }
        return true;
    }

    // Focus Trap Logic for Tab
    if (event.code === 'Tab') {
        const focusable = playlistOverlay.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return true;

        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;

        if (event.shiftKey) {
            if (document.activeElement === first) {
                last.focus();
                event.preventDefault();
            }
        } else {
            if (document.activeElement === last) {
                first.focus();
                event.preventDefault();
            }
        }
        return true;
    }

    // Block game controls while in menu
    return true;
}

/**
 * Handle legacy music upload (main menu compatibility)
 */
export function initLegacyMusicUpload(audioSystem: AudioSystem): void {
    const musicUpload = document.getElementById('musicUpload') as HTMLInputElement | null;
    if (musicUpload) {
        musicUpload.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            const files = target.files;
            if (files && files.length > 0) {
                const { validFiles, invalidFiles } = filterValidMusicFiles(files);

                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);

                    import('../../utils/toast.js').then(({ showToast }) => {
                        if (invalidFiles.length > 0) {
                            showToast(`Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`, '⚠️');
                        } else {
                            showToast(`Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`, '📂');
                        }
                    });
                } else {
                     // All files were invalid
                    import('../../utils/toast.js').then(({ showToast }) => {
                        showToast("❌ Only .mod, .xm, .it, .s3m allowed!", '🚫');
                    });
                }
            }
            target.value = '';
        });
    }
}

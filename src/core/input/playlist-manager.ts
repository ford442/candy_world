/**
 * Playlist Manager Module (Coordinator)
 * Orchestrates playlist initialization and holds shared state.
 */

import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AudioSystem } from '../../audio/audio-system';
import { announce } from '../../ui/announcer.ts';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { showToast } from '../../utils/toast.ts';
import { yieldToPaint } from '../../utils/yield-to-paint.ts';
import { formatSongTitle, filterValidMusicFiles } from './input-types.ts';
import { handlePlaylistUpload } from './playlist-events.ts';
import type { PlaylistManagerState } from './playlist-types.ts';
import { renderPlaylist, updateJukeboxButtonState } from './playlist-ui.ts';

// Shared State Instance
const _state: PlaylistManagerState = {
    isPlaylistOpen: false,
    wasPausedBeforePlaylist: false,
    lastFocusedElement: null,
    releaseJukeboxFocus: null,

    playlistOverlay: null,
    playlistBackdrop: null,
    playlistList: null,
    closePlaylistBtn: null,
    playlistCloseX: null,
    playlistUploadInput: null,
    addSongsBtn: null,
    openJukeboxBtn: null,
    nowPlayingContainer: null,
    nowPlayingText: null,

    audioSystemRef: null,
    controlsRef: null,
    instructionsRef: null,
};

/**
 * Accessor for the shared state
 */
export function getPlaylistManagerState(): PlaylistManagerState {
    return _state;
}

/**
 * Initialize playlist manager
 */
export function initPlaylistManager(
    audioSystem: AudioSystem,
    controls: PointerLockControls,
    instructions: HTMLElement | null
): void {
    _state.audioSystemRef = audioSystem;
    _state.controlsRef = controls;
    _state.instructionsRef = instructions;

    // Get DOM elements
    _state.playlistOverlay = document.getElementById('playlist-overlay');
    _state.playlistBackdrop = document.getElementById('playlist-backdrop');
    _state.playlistList = document.getElementById('playlist-list');
    _state.closePlaylistBtn = document.getElementById('closePlaylistBtn');
    _state.playlistCloseX = document.getElementById('playlistCloseX');
    _state.playlistUploadInput = document.getElementById('playlistUploadInput') as HTMLInputElement | null;
    _state.addSongsBtn = document.getElementById('addSongsBtn');
    _state.openJukeboxBtn = document.getElementById('openJukeboxBtn');
    _state.nowPlayingContainer = document.getElementById('nowPlayingContainer');
    _state.nowPlayingText = document.getElementById('nowPlayingText');

    // Initialize state
    if (audioSystem.getPlaylist) {
        const playlist = audioSystem.getPlaylist();
        updateJukeboxButtonState(playlist.length);

        // 🎨 Palette: Restore Now Playing info if music is already running
        const currentIdx = audioSystem.getCurrentIndex();
        if (currentIdx >= 0 && playlist[currentIdx]) {
            if (_state.nowPlayingContainer && _state.nowPlayingText) {
                const trackName = formatSongTitle(playlist[currentIdx].name);
                _state.nowPlayingText.innerText = trackName;
                _state.nowPlayingContainer.style.display = 'flex';
                _state.nowPlayingContainer.setAttribute('aria-label', `Now Playing: ${trackName}`);
                document.title = `🎵 ${trackName} - Candy World`;
            }
        }
    }

    // Hook up AudioSystem callbacks
    audioSystem.onPlaylistUpdate = (playlist: File[]) => {
        if (_state.isPlaylistOpen) renderPlaylist();
        updateJukeboxButtonState(playlist ? playlist.length : 0);

        if (!playlist || playlist.length === 0) {
            document.title = 'Candy World';
        }
    };

    // UX: Show toast and update playlist when track changes
    audioSystem.onTrackChange = (index: number) => {
        if (_state.isPlaylistOpen) renderPlaylist();

        // Show "Now Playing" toast
        const songs = audioSystem.getPlaylist();
        if (songs && songs[index]) {
            const trackName = formatSongTitle(songs[index].name);
            showToast(`Now Playing: ${trackName}`, '🎵');

            // ♿ Aria: Use unified announcer instead of DOM live regions
            announce(`Now playing: ${trackName}`, 'polite');

            // 🎨 Palette: Update "Now Playing" in Pause Menu
            if (_state.nowPlayingContainer && _state.nowPlayingText) {
                _state.nowPlayingText.innerText = trackName;
                _state.nowPlayingContainer.style.display = 'flex';
                _state.nowPlayingContainer.setAttribute('aria-label', `Now Playing: ${trackName}`);
            }

            // 🎨 Palette: Update Browser Tab Title
            document.title = `🎵 ${trackName} - Candy World`;
        }
    };

    // Event Listeners for UI
    if (_state.closePlaylistBtn) {
        _state.closePlaylistBtn.addEventListener('click', togglePlaylist);
    }

    if (_state.playlistCloseX) {
        _state.playlistCloseX.addEventListener('click', togglePlaylist);
    }

    if (_state.playlistBackdrop) {
        _state.playlistBackdrop.addEventListener('click', togglePlaylist);
    }

    if (_state.playlistUploadInput) {
        _state.playlistUploadInput.addEventListener('change', handlePlaylistUpload);
    }

    if (_state.addSongsBtn) {
        _state.addSongsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_state.playlistUploadInput) _state.playlistUploadInput.click();
        });
    }

    if (_state.openJukeboxBtn) {
        _state.openJukeboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlaylist();
        });
    }

    // 🎨 Palette: Improve Drag & Drop Feedback in Jukebox
    if (_state.playlistOverlay) {
        const dropZoneText = document.createElement('div');
        dropZoneText.className = 'playlist-drop-zone-text';
        dropZoneText.innerHTML = '<span aria-hidden="true">📂</span> Drop tracks here...';
        _state.playlistOverlay.appendChild(dropZoneText);

        let playlistDragCounter = 0;

        _state.playlistOverlay.addEventListener('dragenter', (e: DragEvent) => {
            e.preventDefault();
            playlistDragCounter++;
            _state.playlistOverlay?.classList.add('playlist-drag-active');
        });

        _state.playlistOverlay.addEventListener('dragleave', (e: DragEvent) => {
            e.preventDefault();
            playlistDragCounter--;
            if (playlistDragCounter <= 0) {
                playlistDragCounter = 0;
                _state.playlistOverlay?.classList.remove('playlist-drag-active');
            }
        });

        _state.playlistOverlay.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
        });

        _state.playlistOverlay.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            playlistDragCounter = 0;
            _state.playlistOverlay?.classList.remove('playlist-drag-active');

            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const { validFiles, invalidFiles } = filterValidMusicFiles(files);

                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);

                    if (invalidFiles.length > 0) {
                        const msg = `Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`;
                        showToast(msg, '⚠️');
                        announce(msg, 'polite');
                    } else {
                        const msg = `Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`;
                        showToast(msg, '📂');
                        if (validFiles.length === 1) {
                            announce(
                                `Song '${validFiles[0].name}' has been added and is ready to play.`,
                                'polite'
                            );
                        } else {
                            announce(`Added ${validFiles.length} songs to the playlist.`, 'polite');
                        }
                    }
                } else {
                    showToast('❌ Only .mod, .xm, .it, .s3m allowed!', '🚫');
                    announce('Failed to add songs, invalid format.', 'polite');
                }
            }
        });
    }
}

/**
 * Check if playlist is currently open
 */
export function getIsPlaylistOpen(): boolean {
    return _state.isPlaylistOpen;
}

/**
 * Set the playlist open state (used by main input for forced closes)
 */
export function setIsPlaylistOpen(value: boolean): void {
    _state.isPlaylistOpen = value;
}

/**
 * Close playlist and release focus (for cleanup)
 */
export function closePlaylist(): void {
    if (_state.isPlaylistOpen) {
        togglePlaylist();
    }
}

/**
 * Get the focus release function for cleanup
 */
export function getReleaseJukeboxFocus(): (() => void) | null {
    return _state.releaseJukeboxFocus;
}

/**
 * Set the focus release function
 */
export function setReleaseJukeboxFocus(fn: (() => void) | null): void {
    _state.releaseJukeboxFocus = fn;
}

/**
 * Toggle playlist open/closed
 */
export function togglePlaylist(): void {
    if (!_state.controlsRef) return;

    _state.isPlaylistOpen = !_state.isPlaylistOpen;

    if (_state.openJukeboxBtn) {
        _state.openJukeboxBtn.setAttribute('aria-expanded', String(_state.isPlaylistOpen));
    }

    if (_state.isPlaylistOpen) {
        // OPENING

        // 🎨 Palette: Smart Context Preservation
        // Check if we are opening from the Pause Menu (instructions visible)
        _state.wasPausedBeforePlaylist = _state.instructionsRef
            ? _state.instructionsRef.style.display !== 'none'
            : false;

        _state.lastFocusedElement = document.activeElement;
        _state.controlsRef.unlock(); // Unlock mouse so we can click

        // Note: releasePauseMenuFocus is managed by the main input module
        // We notify via a callback mechanism if needed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = (window as any).__inputSession;
        if (session && session.focus && session.focus.releasePauseMenuFocus) {
            session.focus.releasePauseMenuFocus();
            session.focus.releasePauseMenuFocus = null;
        }

        if (_state.instructionsRef) _state.instructionsRef.style.display = 'none'; // Ensure pause menu is hidden

        if (_state.playlistOverlay) {
            _state.playlistOverlay.style.display = 'flex';
            // Force DOM reflow
            void _state.playlistOverlay.offsetWidth;
            _state.playlistOverlay.style.opacity = '1';
            _state.playlistOverlay.style.transform = 'translate(-50%, -50%) scale(1)';
            _state.playlistOverlay.setAttribute('aria-hidden', 'false');

            // Wait for paint before intensive DOM manipulations and focus trapping
            yieldToPaint(50).then(() => {
                if (_state.isPlaylistOpen && _state.playlistOverlay) {
                    _state.releaseJukeboxFocus = trapFocusInside(_state.playlistOverlay, { skipAutoFocus: true });

                    announce('Jukebox opened. Use Tab to navigate, Enter to select.', 'polite');

                    // UX: Auto-focus the currently playing track for immediate context
                    if (!_state.audioSystemRef || !_state.playlistList) return;
                    const currentIdx = _state.audioSystemRef.getCurrentIndex();
                    const playlistBtns = _state.playlistList.querySelectorAll('.playlist-btn');

                    if (currentIdx >= 0 && playlistBtns[currentIdx]) {
                        const activeBtn = playlistBtns[currentIdx] as HTMLElement;
                        activeBtn.focus({ preventScroll: true });
                        // Ensure the active song is visible in the scrollable list
                        activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    } else {
                        const emptyBtn = _state.playlistList.querySelector('.jukebox-browse-btn');
                        if (emptyBtn) {
                            (emptyBtn as HTMLElement).focus({ preventScroll: true });
                        } else if (_state.closePlaylistBtn) {
                            _state.closePlaylistBtn.focus({ preventScroll: true });
                        }
                    }
                }
            });

            announce('Jukebox opened. Use Tab to navigate, Enter to select.', 'polite');
        }
        if (_state.playlistBackdrop) _state.playlistBackdrop.style.display = 'block';
        renderPlaylist();
    } else {
        // CLOSING
        if (_state.releaseJukeboxFocus) {
            _state.releaseJukeboxFocus();
            _state.releaseJukeboxFocus = null;
        }

        if (_state.playlistOverlay) {
            _state.playlistOverlay.style.opacity = '0';
            _state.playlistOverlay.style.transform = 'translate(-50%, -50%) scale(0.95)';
            _state.playlistOverlay.setAttribute('aria-hidden', 'true');
        }

        announce('Jukebox closed', 'polite');

        setTimeout(() => {
            if (!_state.isPlaylistOpen) {
                if (_state.playlistOverlay) _state.playlistOverlay.style.display = 'none';
                if (_state.playlistBackdrop) _state.playlistBackdrop.style.display = 'none';
            }
        }, 300);

        // 🎨 Palette: Smart Context Restoration
        if (_state.wasPausedBeforePlaylist) {
            // Return to Pause Menu
            if (_state.instructionsRef) {
                _state.instructionsRef.style.display = 'flex';

                yieldToPaint(50).then(() => {
                     // eslint-disable-next-line @typescript-eslint/no-explicit-any
                     const session = (window as any).__inputSession;
                     if (session && _state.instructionsRef && _state.instructionsRef.style.display !== 'none') {
                         session.focus.releasePauseMenuFocus = trapFocusInside(_state.instructionsRef, { skipAutoFocus: true });
                     }
                });
            }
            // Restore focus to the button that opened the jukebox (e.g. Open Jukebox button)
            yieldToPaint(50).then(() => {
                if (_state.lastFocusedElement && _state.lastFocusedElement instanceof HTMLElement && _state.lastFocusedElement.isConnected && (!_state.playlistOverlay || !_state.playlistOverlay.contains(_state.lastFocusedElement))) {
                    _state.lastFocusedElement.focus({ preventScroll: true });
                } else if (_state.openJukeboxBtn) {
                    _state.openJukeboxBtn.focus({ preventScroll: true });
                }
            });
            // Do NOT lock controls, stay unlocked
        } else {
            // Return to Game
            _state.controlsRef.lock(); // Re-lock mouse to play
        }
    }
}

/**
 * Get the "wasPausedBeforePlaylist" state for context restoration
 */
export function getWasPausedBeforePlaylist(): boolean {
    return _state.wasPausedBeforePlaylist;
}

/**
 * Set the "wasPausedBeforePlaylist" state
 */
export function setWasPausedBeforePlaylist(value: boolean): void {
    _state.wasPausedBeforePlaylist = value;
}

/**
 * Get the last focused element before opening playlist
 */
export function getLastFocusedElement(): Element | null {
    return _state.lastFocusedElement;
}

// Re-export everything else for backward compatibility with consumer modules
export { renderPlaylist, updateJukeboxButtonState } from './playlist-ui.ts';
export { handlePlaylistUpload, handlePlaylistKeyDown, handlePlaylistKeyUp, initLegacyMusicUpload } from './playlist-events.ts';

/**
 * Playlist Events Module
 * Handles input events and DOM uploads for the playlist manager
 */

import { AudioSystem } from '../../audio/audio-system';
import { announce } from '../../ui/announcer.ts';
import { showToast } from '../../utils/toast.ts';
import { filterValidMusicFiles } from './input-types.ts';
import { getPlaylistManagerState, togglePlaylist } from './playlist-manager.ts';

/**
 * Handle playlist file upload
 */
export function handlePlaylistUpload(e: Event): void {
    const state = getPlaylistManagerState();
    if (!state.audioSystemRef) return;

    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
        const browseBtn = state.playlistList?.querySelector('.jukebox-browse-btn') as HTMLElement | null;

        const originalAddSongsHtml = state.addSongsBtn ? state.addSongsBtn.innerHTML : '';
        const originalBrowseHtml = browseBtn ? browseBtn.innerHTML : '';

        const setBusy = (btn: HTMLElement | null) => {
            if (btn) {
                btn.setAttribute('aria-busy', 'true');
                btn.setAttribute('aria-disabled', 'true');
                btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Processing...';
            }
        };

        const restoreBusy = (btn: HTMLElement | null, originalHtml: string) => {
            if (btn) {
                btn.removeAttribute('aria-busy');
                btn.removeAttribute('aria-disabled');
                btn.innerHTML = originalHtml;
            }
        };

        setBusy(state.addSongsBtn);
        setBusy(browseBtn);

        // Brief delay for satisfying UX feedback
        setTimeout(() => {
            const { validFiles, invalidFiles } = filterValidMusicFiles(files);

            if (validFiles.length > 0) {
                state.audioSystemRef!.addToQueue(validFiles);
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

            restoreBusy(state.addSongsBtn, originalAddSongsHtml);
            restoreBusy(browseBtn, originalBrowseHtml);
            target.value = '';
        }, 500);
    } else {
        target.value = '';
    }
}

/**
 * Handle playlist-specific key events
 * Returns true if the key was handled
 */
export function handlePlaylistKeyDown(event: KeyboardEvent): boolean {
    const state = getPlaylistManagerState();
    if (!state.isPlaylistOpen || !state.playlistOverlay) return false;

    // Close on Escape or Q
    if (event.code === 'Escape' || event.code === 'KeyQ') {
        event.preventDefault();
        if (state.closePlaylistBtn) {
            state.closePlaylistBtn.classList.add('keyboard-active');
            // ♿ Aria: Removed setTimeout; state cleared on keyup to accurately mirror tactile hold
        }
        togglePlaylist();
        return true;
    }

    // Upload on U
    if (event.code === 'KeyU') {
        const playlistInput = document.getElementById('playlistUploadInput') as HTMLInputElement;
        const addSongsBtnEl = document.getElementById('addSongsBtn');
        if (addSongsBtnEl) {
            addSongsBtnEl.classList.add('keyboard-active');
            // ♿ Aria: Removed setTimeout; state cleared on keyup to accurately mirror tactile hold
        }
        if (playlistInput) playlistInput.click();
        return true;
    }

    // UX: Arrow Key Navigation for Playlist
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        // Query all visually accessible buttons within the playlist overlay
        const focusableBtns = Array.from(
            state.playlistOverlay.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')
        ).filter((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement[];
        if (focusableBtns.length > 0) {
            event.preventDefault(); // Prevent scrolling
            const currentIndex = focusableBtns.indexOf(document.activeElement as HTMLElement);
            let nextIndex;

            if (event.code === 'ArrowDown') {
                nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % focusableBtns.length;
            } else {
                nextIndex =
                    currentIndex === -1
                        ? focusableBtns.length - 1
                        : (currentIndex - 1 + focusableBtns.length) % focusableBtns.length;
            }
            focusableBtns[nextIndex].focus({ preventScroll: true });
        }
        return true;
    }

    // Block game controls while in menu
    return true;
}

/**
 * Handle playlist-specific keyup events (for tactile feedback)
 * Returns true if the key was handled
 */
export function handlePlaylistKeyUp(event: KeyboardEvent): boolean {
    const state = getPlaylistManagerState();
    let handled = false;
    // ♿ Aria: Do not guard by isPlaylistOpen, because closing the playlist
    // on keydown changes the state, and we still need to clear the keyup state.

    if (event.code === 'Escape' || event.code === 'KeyQ') {
        if (state.closePlaylistBtn) {
            state.closePlaylistBtn.classList.remove('keyboard-active');
        }
        // If playlist is currently open, we consider this key handled by the playlist
        if (state.isPlaylistOpen && state.playlistOverlay) handled = true;
    }

    if (event.code === 'KeyU') {
        const addSongsBtnEl = document.getElementById('addSongsBtn');
        if (addSongsBtnEl) {
            addSongsBtnEl.classList.remove('keyboard-active');
        }
        if (state.isPlaylistOpen && state.playlistOverlay) handled = true;
    }

    if (event.code === 'Escape') {
        if (state.closePlaylistBtn) {
            state.closePlaylistBtn.classList.remove('keyboard-active');
        }
        if (state.isPlaylistOpen && state.playlistOverlay) handled = true;
    }

    return handled;
}

/**
 * Handle legacy music upload (main menu compatibility)
 */
export function initLegacyMusicUpload(audioSystem: AudioSystem): void {
    const musicUpload = document.getElementById('musicUpload') as HTMLInputElement | null;
    const musicUploadBtn = document.getElementById('musicUploadBtn');

    if (musicUploadBtn && musicUpload) {
        musicUploadBtn.addEventListener('click', () => {
            musicUpload.click();
        });
    }

    if (musicUpload) {
        musicUpload.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            const files = target.files;
            if (files && files.length > 0) {
                const originalHtml = musicUploadBtn ? musicUploadBtn.innerHTML : '';
                if (musicUploadBtn) {
                    musicUploadBtn.setAttribute('aria-busy', 'true');
                    musicUploadBtn.setAttribute('aria-disabled', 'true');
                    musicUploadBtn.innerHTML =
                        '<span class="spinner" aria-hidden="true"></span> Processing...';
                }

                // Brief delay for satisfying UX feedback
                setTimeout(() => {
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
                                announce(
                                    `Added ${validFiles.length} songs to the playlist.`,
                                    'polite'
                                );
                            }
                        }
                    } else {
                        // All files were invalid
                        showToast('❌ Only .mod, .xm, .it, .s3m allowed!', '🚫');
                        announce('Failed to add songs, invalid format.', 'polite');
                    }

                    if (musicUploadBtn) {
                        musicUploadBtn.removeAttribute('aria-busy');
                        musicUploadBtn.removeAttribute('aria-disabled');
                        musicUploadBtn.innerHTML = originalHtml;
                    }
                    target.value = '';
                }, 500);
            } else {
                target.value = '';
            }
        });
    }
}

/**
 * Playlist UI Module
 * Handles playlist UI rendering and updates for the jukebox modal
 */

import { formatSongTitle } from './input-types.ts';
import { showToast } from '../../utils/toast.ts';
import { getPlaylistManagerState } from './playlist-manager.ts';

export function renderPlaylist(): void {
    const state = getPlaylistManagerState();
    if (!state.playlistList || !state.audioSystemRef) return;

    state.playlistList.innerHTML = '';
    const songs = state.audioSystemRef.getPlaylist();
    const currentIdx = state.audioSystemRef.getCurrentIndex();

    songs.forEach((file: File, index: number) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';

        // UX: Use a button for keyboard accessibility
        const displayName = formatSongTitle(file.name);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'playlist-btn';
        if (index === currentIdx) {
            btn.title = `Currently playing: ${displayName}`;
            btn.setAttribute('aria-label', `Currently playing: ${displayName}`);
            btn.setAttribute('aria-current', 'true');
        } else {
            btn.title = `Play ${displayName}`;
            btn.setAttribute('aria-label', `Play ${displayName}`);
        }

        btn.innerHTML = `
            <span class="song-title">${index + 1}. ${displayName}</span>
            <span class="status-icon" aria-hidden="true">${index === currentIdx ? '🔊' : '▶️'}</span>
        `;
        btn.onclick = (e) => {
            // Prevent bubbling if needed, though li has no click handler now
            e.stopPropagation();
            state.audioSystemRef!.playAtIndex(index);
            renderPlaylist(); // Re-render to update active state

            // Keep focus on the clicked item (re-rendered)
            // We need to find the new button after render
            requestAnimationFrame(() => {
                const newItems = state.playlistList!.querySelectorAll('.playlist-btn');
                if (newItems && newItems[index] && newItems[index] instanceof HTMLElement) {
                    (newItems[index] as HTMLElement).focus({ preventScroll: true });
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
            const _wasActive = document.activeElement === removeBtn;
            state.audioSystemRef!.removeTrack(index);
            renderPlaylist();

            // 🎨 Palette: Provide explicit feedback for destructive action
            showToast(`Removed ${displayName}`, '🗑️', 3000);

            // UX: Restore Focus to an appropriate element
            requestAnimationFrame(() => {
                // If it was active and the element is gone, or it was the last song
                const remainingSongs = state.audioSystemRef!.getPlaylist().length;
                if (remainingSongs === 0) {
                    // Fallback to empty state button if list is now empty
                    const emptyBtn =
                        state.playlistList?.querySelector('.jukebox-browse-btn') ||
                        document.getElementById('addSongsBtn');
                    if (emptyBtn) {
                        (emptyBtn as HTMLElement).focus({ preventScroll: true });
                    }
                } else {
                    const removeBtns = state.playlistList?.querySelectorAll('.playlist-remove-btn') || [];
                    const playBtns = state.playlistList?.querySelectorAll('.playlist-btn') || [];

                    // Try focusing the next remove button (at same index, since list shifted)
                    if (removeBtns && removeBtns[index]) {
                        (removeBtns[index] as HTMLElement).focus({ preventScroll: true });
                    } else if (removeBtns && removeBtns[index - 1]) {
                        // Or the previous one
                        (removeBtns[index - 1] as HTMLElement).focus({ preventScroll: true });
                    } else if (playBtns && playBtns[0]) {
                        // Or the first song
                        (playBtns[0] as HTMLElement).focus({ preventScroll: true });
                    }
                }
            });
        };

        li.appendChild(btn);
        li.appendChild(removeBtn);
        state.playlistList?.appendChild(li);
    });

    if (songs.length === 0) {
        // 🎨 Palette: Rich Empty State for the Jukebox
        const li = document.createElement('li');
        li.className = 'jukebox-empty-state';
        li.style.listStyle = 'none';

        const iconContainer = document.createElement('div');
        iconContainer.className = 'jukebox-empty-icon-container';
        const icon = document.createElement('div');
        icon.className = 'jukebox-empty-icon';
        icon.innerHTML = '<span aria-hidden="true">🎵</span>';
        iconContainer.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'jukebox-empty-text';
        text.id = 'jukebox-empty-desc';
        text.innerText = 'Your playlist is empty — drop some tracks in!';

        const browseBtn = document.createElement('button');
        browseBtn.type = 'button';
        browseBtn.className = 'cta-button jukebox-browse-btn';
        browseBtn.innerHTML = 'Browse Music <span aria-hidden="true">📂</span>';
        browseBtn.setAttribute('aria-label', 'Browse for music files to add to playlist');
        browseBtn.setAttribute('aria-describedby', 'jukebox-empty-desc');

        browseBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.playlistUploadInput) state.playlistUploadInput.click();
        };

        li.appendChild(iconContainer);
        li.appendChild(text);
        li.appendChild(browseBtn);
        state.playlistList?.appendChild(li);
    }
}

export function updateJukeboxButtonState(count: number): void {
    const state = getPlaylistManagerState();
    if (!state.openJukeboxBtn) return;
    const countText = count > 0 ? ` (${count})` : '';
    state.openJukeboxBtn.innerHTML = `Open Jukebox${countText} <span class="key-badge" aria-hidden="true">Q</span>`;
    state.openJukeboxBtn.setAttribute(
        'aria-label',
        `Open Jukebox playlist${count > 0 ? `, ${count} songs` : ''}`
    );
    // Ensure aria-expanded state is preserved when updating innerHTML
    state.openJukeboxBtn.setAttribute('aria-expanded', String(state.isPlaylistOpen));
}

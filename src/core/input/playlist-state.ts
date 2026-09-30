/**
 * Shared playlist state. Split out of playlist-manager.ts so playlist-ui.ts and
 * playlist-events.ts can read it without importing the manager, which imports
 * both of them (#1827).
 */
import type { PlaylistManagerState } from './playlist-types.ts';

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

let _toggle: () => void = () => {};

/** playlist-manager.ts registers togglePlaylist() here for the keyboard handler. */
export function setPlaylistToggle(toggle: () => void): void {
    _toggle = toggle;
}

export function requestPlaylistToggle(): void {
    _toggle();
}

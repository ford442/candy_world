/**
 * Shared types for the playlist manager submodules
 */

import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AudioSystem } from '../../audio/audio-system';

export interface PlaylistManagerState {
    isPlaylistOpen: boolean;
    wasPausedBeforePlaylist: boolean;
    lastFocusedElement: Element | null;
    releaseJukeboxFocus: (() => void) | null;

    playlistOverlay: HTMLElement | null;
    playlistBackdrop: HTMLElement | null;
    playlistList: HTMLElement | null;
    closePlaylistBtn: HTMLElement | null;
    playlistCloseX: HTMLElement | null;
    playlistUploadInput: HTMLInputElement | null;
    addSongsBtn: HTMLElement | null;
    openJukeboxBtn: HTMLElement | null;
    nowPlayingContainer: HTMLElement | null;
    nowPlayingText: HTMLElement | null;

    audioSystemRef: AudioSystem | null;
    controlsRef: PointerLockControls | null;
    instructionsRef: HTMLElement | null;
}

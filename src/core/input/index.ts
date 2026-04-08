/**
 * Input Module Barrel Export
 * Re-exports all public APIs from the input system
 */

export { initInput, keyStates } from './input.ts';
export type { KeyStates, InitInputResult } from './input-types.ts';

// Re-export specific utilities if needed by other modules
export { formatSongTitle, filterValidMusicFiles } from './input-types.ts';

// Sub-module exports (for advanced use cases)
export {
    initPlaylistManager,
    togglePlaylist,
    getIsPlaylistOpen,
    renderPlaylist,
    updateJukeboxButtonState,
    handlePlaylistKeyDown,
    initLegacyMusicUpload
} from './playlist-manager.ts';

export {
    initAudioControls,
    toggleMute,
    adjustVolume,
    updateMuteUI,
    handleMuteKey,
    handleVolumeKey
} from './audio-controls.ts';

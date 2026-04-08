/**
 * Input Types and Shared State
 * Contains type definitions, shared state, and utility functions used across input modules
 */

export interface KeyStates {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    sneak: boolean;
    sprint: boolean;
    dash: boolean;
    dodgeRoll: boolean;
    dance: boolean;
    action: boolean;
    phase: boolean;
    clap: boolean;
    strike: boolean;
}

export const keyStates: KeyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false,
    dash: false,
    dodgeRoll: false,
    dance: false,
    action: false,
    phase: false,
    clap: false,
    strike: false
};

export interface InitInputResult {
    controls: import('three/examples/jsm/controls/PointerLockControls.js').PointerLockControls;
    updateReticleState: (state: 'idle' | 'hover' | 'interact', label?: string) => void;
    updateDayNightButtonState: (isPressed: boolean) => void;
    cleanup: () => void;
}

// Helper: Format song title for display
export const formatSongTitle = (filename: string): string => {
    // Remove extension
    let name = filename.replace(/\.[^/.]+$/, "");
    // Replace underscores and hyphens with spaces
    name = name.replace(/[_-]/g, " ");
    // Capitalize words
    name = name.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
    return name;
};

// Helper: Validate and filter files by extension
export const filterValidMusicFiles = (files: FileList): { validFiles: File[]; invalidFiles: File[] } => {
    const validExtensions = ['.mod', '.xm', '.it', '.s3m'];
    const validFiles: File[] = [];
    const invalidFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const lowerName = file.name.toLowerCase();
        if (validExtensions.some(ext => lowerName.endsWith(ext))) {
            validFiles.push(file);
        } else {
            invalidFiles.push(file);
        }
    }
    return { validFiles, invalidFiles };
};

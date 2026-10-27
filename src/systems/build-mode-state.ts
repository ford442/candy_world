/**
 * @file src/systems/build-mode-state.ts
 * @brief Build mode's on/off and gizmo flags, readable from `app` without
 * loading the `authoring` chunk. The chunk reports here; the HUD and the
 * input layer read here.
 */

let _active = false;
let _gizmoOpen = false;
let _onStateChange: ((active: boolean) => void) | null = null;

export function isBuildModeActive(): boolean {
    return _active;
}

/**
 * True while the transform gizmo has released pointer lock for a drag. The
 * input layer must not show the pause menu or re-lock on click meanwhile.
 */
export function isBuildGizmoOpen(): boolean {
    return _gizmoOpen;
}

export function reportBuildModeState(active: boolean, gizmoOpen: boolean): void {
    const changed = active !== _active;
    _active = active;
    _gizmoOpen = gizmoOpen;
    if (changed) _onStateChange?.(active);
}

/** HUD hook (the Build button's pressed state). */
export function onBuildModeStateChange(listener: (active: boolean) => void): void {
    _onStateChange = listener;
}

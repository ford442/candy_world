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

/**
 * The reticle, for co-editing cursors (#1975). Build mode writes it in place
 * every other frame; the shared-world room reads it a few times a second.
 * `hit` is false off the ground or outside build mode.
 */
export interface BuildCursor {
    hit: boolean;
    x: number;
    y: number;
    z: number;
    tool: string;
}

const _cursor: BuildCursor = { hit: false, x: 0, y: 0, z: 0, tool: 'place' };
let _selectionSource: (() => string[]) | null = null;

export function getBuildCursor(): Readonly<BuildCursor> {
    return _cursor;
}

export function reportBuildCursor(
    hit: boolean,
    x: number,
    y: number,
    z: number,
    tool: string
): void {
    _cursor.hit = hit && _active;
    _cursor.x = x;
    _cursor.y = y;
    _cursor.z = z;
    _cursor.tool = tool;
}

/** Build mode registers how to read its selection (ids), so nothing copies it per frame. */
export function setBuildSelectionSource(source: (() => string[]) | null): void {
    _selectionSource = source;
}

export function getBuildSelection(): string[] {
    return _active && _selectionSource ? _selectionSource() : [];
}

/**
 * Set while the open world may not be edited from here (a shared world opened
 * read-only); build mode refuses to open with this message.
 */
let _lockedReason: string | null = null;

export function setBuildModeLock(reason: string | null): void {
    _lockedReason = reason;
}

export function getBuildModeLock(): string | null {
    return _lockedReason;
}

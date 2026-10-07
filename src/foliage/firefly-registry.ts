/**
 * Every firefly mesh in the scene, so the game loop can show them from dusk to
 * dawn. World generation builds fireflies at two sites (initial outdoor world,
 * and the extra count added on the Lobby → outdoor path), so a single
 * dependency-injected ref could only ever gate one of them.
 *
 * Deliberately import-free: game-loop and world generation both use it, and it
 * must not pull either into the other's import graph.
 */

interface Visible {
    visible: boolean;
}

const _meshes: Visible[] = [];
let _visible: boolean | null = null;

/** Track a firefly mesh. It takes the current gate state straight away. */
export function registerFireflyMesh(mesh: Visible): void {
    if (_meshes.indexOf(mesh) !== -1) return;
    _meshes.push(mesh);
    if (_visible !== null) mesh.visible = _visible;
}

/** Show or hide every registered firefly mesh. Writes only when the gate flips. */
export function setFireflyMeshesVisible(visible: boolean): void {
    if (visible === _visible) return;
    _visible = visible;
    for (let i = 0; i < _meshes.length; i++) _meshes[i].visible = visible;
}

export function getFireflyMeshCount(): number {
    return _meshes.length;
}

/** @internal test seam */
export function __resetFireflyRegistryForTests(): void {
    _meshes.length = 0;
    _visible = null;
}

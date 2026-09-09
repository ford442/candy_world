/**
 * Experimental soft-body demo — `?softBody=1`.
 *
 * Hangs one candy banner (a PBD cloth grid, `src/systems/physics/soft-body.ts`)
 * near the player spawn: pinned along its top edge, blown by a slow breeze,
 * resting on the terrain and shoved aside when the player walks through it.
 *
 * This is a prototype demo surface, not a system: nothing else in the world
 * uses the solver, and nothing in here loads unless the flag is set. See
 * docs/PERF_BUDGETS.md § "Soft Bodies (experimental)".
 *
 * Controls (while the flag is on):
 *   H — reset the banner to its bind pose
 */

import * as THREE from 'three';
import { ClothSim, type SoftBodyPlayerProxy } from '../systems/physics/soft-body.ts';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';

/** Grid resolution: 14×10 = 140 particles, ~700 constraints. */
const COLS = 14;
const ROWS = 10;
const SPACING = 0.34;

/** Where the banner hangs, relative to the spawn origin. */
const OFFSET = { dx: 4.5, dz: -4.5, topHeight: 4.2 };

const BANNER_COLOR = 0xffa9d4;

let _enabled = false;
let _scene: THREE.Scene | null = null;
let _cloth: ClothSim | null = null;
let _mesh: THREE.Mesh | null = null;
let _rod: THREE.Mesh | null = null;
let _normals: Float32Array | null = null;
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;
const _origin = new THREE.Vector3();

const _player: SoftBodyPlayerProxy = {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    radius: 0.65,
    height: 1.8,
};

/** Ground sampler passed to the solver — the same unified query physics uses. */
const groundAt = (x: number, z: number): number => getUnifiedGroundHeightTyped(x, z);

export function isSoftBodyDemoEnabled(): boolean {
    return _enabled;
}

/**
 * Build the banner around `origin` (normally the player spawn).
 * Safe to call twice — the second call rebuilds.
 */
export function initSoftBodyDemo(scene: THREE.Scene, origin: THREE.Vector3): void {
    disposeSoftBodyDemo();

    _enabled = true;
    _scene = scene;
    _origin.copy(origin);

    const cx = origin.x + OFFSET.dx;
    const cz = origin.z + OFFSET.dz;
    const topY = groundAt(cx, cz) + OFFSET.topHeight;

    const cloth = new ClothSim({
        cols: COLS,
        rows: ROWS,
        spacing: SPACING,
        // Centre the sheet on the anchor point.
        originX: cx - ((COLS - 1) * SPACING) / 2,
        originY: topY,
        originZ: cz,
    });
    cloth.pinTopEdge();
    _cloth = cloth;

    const geo = new THREE.BufferGeometry();
    // The solver owns the position array; the attribute is a view onto it, so
    // the per-frame update is a `needsUpdate` flag rather than a copy.
    geo.setAttribute('position', new THREE.BufferAttribute(cloth.positions, 3));
    _normals = new Float32Array(cloth.count * 3);
    geo.setAttribute('normal', new THREE.BufferAttribute(_normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cloth.buildUVs(), 2));
    geo.setIndex(new THREE.BufferAttribute(cloth.buildIndices(), 1));
    // Positions move every frame and the sheet is small; skip the bounds math.
    geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx, topY, cz),
        (Math.max(COLS, ROWS) + 2) * SPACING
    );

    const mat = new THREE.MeshPhysicalMaterial({
        color: BANNER_COLOR,
        roughness: 0.32,
        metalness: 0.0,
        clearcoat: 0.75,
        clearcoatRoughness: 0.25,
        side: THREE.DoubleSide,
    });

    _mesh = new THREE.Mesh(geo, mat);
    _mesh.frustumCulled = false;
    _mesh.castShadow = false;
    _mesh.receiveShadow = false;
    scene.add(_mesh);

    // The rod the banner hangs from, so the pinned edge reads as intentional.
    const rodGeo = new THREE.CylinderGeometry(0.05, 0.05, (COLS - 1) * SPACING + 0.4, 8);
    rodGeo.rotateZ(Math.PI / 2);
    _rod = new THREE.Mesh(
        rodGeo,
        new THREE.MeshPhysicalMaterial({
            color: 0xfff4f8,
            roughness: 0.3,
            clearcoat: 0.6,
        })
    );
    _rod.position.set(cx, topY, cz);
    scene.add(_rod);

    cloth.computeNormals(_normals);
    installKeys();
    exposeDebugHandle();

    console.warn(
        `[soft-body] Experimental cloth demo enabled — ${cloth.count} particles, ` +
            `${cloth.linkCount} constraints (JS PBD solver)`
    );
}

/** One-way player proxy: the banner is pushed, the player is never pushed back. */
export function setSoftBodyDemoPlayer(position: THREE.Vector3): void {
    _player.active = true;
    _player.x = position.x;
    _player.y = position.y;
    _player.z = position.z;
}

/** Live wind hookup, so the banner follows weather when the caller has it. */
export function setSoftBodyDemoWind(x: number, y: number, z: number, strength: number): void {
    _cloth?.setWind(x, y, z, strength);
}

/** Step the solver and push the new positions/normals to the GPU. */
export function updateSoftBodyDemo(delta: number): void {
    const cloth = _cloth;
    const mesh = _mesh;
    if (!_enabled || !cloth || !mesh || !_normals) return;

    const before = cloth.resetCount;
    cloth.step(delta, groundAt, _player.active ? _player : null);
    if (cloth.resetCount !== before) {
        // Debug assert: a non-finite particle means the solver diverged. The
        // sim self-heals to the bind pose; this makes it impossible to miss.
        console.error(
            `[soft-body] NaN detected — banner reset to bind pose (resets: ${cloth.resetCount})`
        );
    }

    cloth.computeNormals(_normals);
    const geo = mesh.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
}

function installKeys(): void {
    if (_keyHandler) return;
    _keyHandler = (e: KeyboardEvent) => {
        if (!_enabled) return;
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            return;
        }
        if (e.code === 'KeyH') {
            _cloth?.reset();
            console.warn('[soft-body] Banner reset');
        }
    };
    window.addEventListener('keydown', _keyHandler);
}

/** Console/inspection handle, matching the rigid-body sandbox's shape. */
function exposeDebugHandle(): void {
    (window as unknown as Record<string, unknown>).__softBody = {
        particles: () => _cloth?.count ?? 0,
        constraints: () => _cloth?.linkCount ?? 0,
        /** Debug assert surface: must stay 0 across a play session. */
        resets: () => _cloth?.resetCount ?? 0,
        finite: () => _cloth?.isFinite() ?? true,
        reset: () => _cloth?.reset(),
    };
}

/** Full teardown — mesh, rod, solver and the hotkey listener. */
export function disposeSoftBodyDemo(): void {
    if (_mesh) {
        _scene?.remove(_mesh);
        _mesh.geometry.dispose();
        (_mesh.material as THREE.Material).dispose();
        _mesh = null;
    }
    if (_rod) {
        _scene?.remove(_rod);
        _rod.geometry.dispose();
        (_rod.material as THREE.Material).dispose();
        _rod = null;
    }
    if (_keyHandler) {
        window.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
    }
    _cloth = null;
    _normals = null;
    _enabled = false;
    _scene = null;
    _player.active = false;
}

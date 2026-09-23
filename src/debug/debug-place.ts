/**
 * @file src/debug/debug-place.ts
 * @brief Optional in-world placement editor gizmo.
 *
 * Enabled via URL flag:
 *   ?debugPlace=1
 *
 * Provides an interface to place and adjust props or entities on the map,
 * with controls for scale and rotation, and outputs JSON config for map.json.
 */

import * as THREE from 'three';
import {
    CURRENT_SNAPSHOT_VERSION,
    nextSnapshotId,
    snapshotEntity,
    type EntitySnapshot,
} from '../systems/entity-snapshot-core.ts';
import { loadDevSnapshots, saveSnapshot } from '../systems/entity-snapshot-store.ts';
import { restoreEntity } from '../systems/entity-snapshot.ts';
import { getGroundHeight, sampleGroundNormal } from '../systems/ground-system.ts';
import { applyEntitySnapshots } from '../systems/save-system/entity-snapshot.ts';
import { showToast } from '../utils/toast.ts';

const _hasFlag = (key: string): boolean => {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
};

const DEBUG_PLACE = _hasFlag('debugPlace');

const _up = new THREE.Vector3(0, 1, 0);
const _scratchQuat = new THREE.Quaternion();
const _scratchQuatY = new THREE.Quaternion();

let _scene: THREE.Scene | null = null;
let _camera: THREE.PerspectiveCamera | null = null;
let _panel: HTMLElement | null = null;
let _reticle: THREE.Mesh | null = null;

let _currentType = 'mushroom';
let _currentScale = 1.0;
let _currentRotation = 0.0;
let _lastSpawnedObject: THREE.Object3D | null = null;

const ENTITY_TYPES = [
    'mushroom',
    'flower',
    'tree',
    'shrub',
    'portamento_pine',
    'bubble_willow',
    'balloon_bush',
    'helix_plant',
    'gem_canopy_tree',
    'arpeggio_fern',
    'luminous_plant',
    'glowing_flower',
    'starflower',
    'vibrato_violet',
    'tremolo_tulip',
    'cymbal_dandelion',
    'rock',
    'grass',
    'kick_drum_geyser',
    'snare_trap',
    'subwoofer_lotus',
    'panning_pad',
    'instrument_shrine',
    'wisteria_cluster',
    'glass_mushroom',
    'sky_island',
    'night_market_stall',
];

export function isPlacementDebugEnabled(): boolean {
    return DEBUG_PLACE;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

/** Resolves once boot has published `window.__sceneReady` (world generated), or after the timeout. */
function whenSceneReady(timeoutMs = 180_000): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now();
        const poll = () => {
            if ((window as any).__sceneReady || performance.now() - start > timeoutMs) resolve();
            else setTimeout(poll, 250);
        };
        poll();
    });
}

/**
 * Re-apply every `?debugPlace` placement from the dev sidecar after the world
 * has generated, through the same `applyEntitySnapshots` path a save load uses.
 */
async function restoreDevPlacements(): Promise<void> {
    await whenSceneReady();
    const snapshots = await loadDevSnapshots();
    if (snapshots.length === 0) return;
    const result = applyEntitySnapshots(snapshots);
    console.log(
        `[DebugPlace] Restored ${result.restored} dev placements ` +
            `(${result.alreadyLive} already live, ${result.skipped} skipped)`
    );
    if (result.restored > 0) showToast(`Restored ${result.restored} placements`, '🏗️', 2500);
}

function updatePanel() {
    if (!_panel) return;
    const select = _panel.querySelector('select');
    if (select) select.value = _currentType;

    const scaleEl = _panel.querySelector('#debug-place-scale');
    if (scaleEl) scaleEl.textContent = _currentScale.toFixed(2);

    const rotEl = _panel.querySelector('#debug-place-rot');
    if (rotEl) rotEl.textContent = ((_currentRotation * 180) / Math.PI).toFixed(0);
}

export function initPlacementDebug(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!DEBUG_PLACE) return;

    _scene = scene;
    _camera = camera;

    _panel = document.createElement('div');
    _panel.id = 'debug-place-panel';
    _panel.style.cssText = [
        'position:fixed',
        'left:8px',
        'top:8px',
        'z-index:10000',
        'font:12px/1.4 ui-monospace, SFMono-Regular, monospace',
        'color:#fff',
        'background:rgba(20,20,30,0.85)',
        'padding:10px',
        'border-radius:6px',
        'pointer-events:auto',
        'backdrop-filter:blur(4px)',
        'border:1px solid rgba(255,255,255,0.2)',
        'display:flex',
        'flex-direction:column',
        'gap:6px',
    ].join(';');

    const typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'background:#000;color:#fff;border:1px solid #555;padding:2px;';
    ENTITY_TYPES.forEach((type) => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        typeSelect.appendChild(opt);
    });
    typeSelect.value = _currentType;
    typeSelect.addEventListener('change', (e) => {
        _currentType = (e.target as HTMLSelectElement).value;
        updatePanel();
    });

    _panel.innerHTML = `
        <div style="font-weight:bold;color:#4ade80">🏗️ Placement Debug</div>
        <div style="display:flex;align-items:center;gap:6px">Type: </div>
        <div>Scale: <span id="debug-place-scale">${_currentScale.toFixed(2)}</span> (Wheel)</div>
        <div>Rot: <span id="debug-place-rot">0</span>° (R to rotate)</div>
        <div style="opacity:0.7;font-size:10px;margin-top:4px">
            [E]/[Q] Next/Prev Type<br>
            [Click] Place (logs to console)
        </div>
    `;

    const flexRow = _panel.children[1] as HTMLElement;
    flexRow.appendChild(typeSelect);
    const snapshotBtn = document.createElement('button');
    snapshotBtn.textContent = 'Capture Snapshot';
    snapshotBtn.style.cssText =
        'background:#1a4;color:#fff;border:1px solid #3c6;padding:2px 6px;margin-left:4px;cursor:pointer;';
    snapshotBtn.addEventListener('click', () => {
        if (!_lastSpawnedObject) {
            showToast('No recent object to capture', '⚠️', 2000);
            return;
        }
        try {
            // Keep the placement's id so this overwrites its sidecar record
            // instead of adding a duplicate that would restore twice.
            const liveId = _lastSpawnedObject.userData.mapEntityId;
            const snap = snapshotEntity(
                _lastSpawnedObject,
                typeof liveId === 'string' ? { id: liveId } : undefined
            );
            if (snap) {
                console.log('[DebugPlace] Entity Snapshot:');
                console.log(JSON.stringify(snap, null, 2));
                // Dev-only sidecar write; never touches assets/map.json.
                void saveSnapshot(snap);
                showToast('Snapshot captured to console', '✅', 2000);
            } else {
                showToast('Failed to capture snapshot', '❌', 2000);
            }
        } catch (err) {
            console.error(err);
            showToast('Error capturing snapshot', '❌', 2000);
        }
    });
    flexRow.appendChild(snapshotBtn);

    document.body.appendChild(_panel);

    const geo = new THREE.RingGeometry(0.8, 1.0, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true, depthTest: false });
    _reticle = new THREE.Mesh(geo, mat);
    _reticle.renderOrder = 9999;
    scene.add(_reticle);

    window.addEventListener('wheel', (e) => {
        if (!isPlacementDebugEnabled()) return;
        // Don't intercept if mouse is over the panel
        if (_panel && _panel.contains(e.target as Node)) return;

        _currentScale += e.deltaY < 0 ? 0.1 : -0.1;
        _currentScale = Math.max(0.1, Math.min(10.0, _currentScale));
        updatePanel();
    });

    window.addEventListener('keydown', (e) => {
        if (!isPlacementDebugEnabled()) return;

        if (e.key === 'r' || e.key === 'R') {
            _currentRotation += Math.PI / 8;
            if (_currentRotation >= Math.PI * 2) _currentRotation -= Math.PI * 2;
            updatePanel();
        } else if (e.key === 'e' || e.key === 'E') {
            const idx = ENTITY_TYPES.indexOf(_currentType);
            _currentType = ENTITY_TYPES[(idx + 1) % ENTITY_TYPES.length];
            updatePanel();
        } else if (e.key === 'q' || e.key === 'Q') {
            const idx = ENTITY_TYPES.indexOf(_currentType);
            _currentType = ENTITY_TYPES[(idx - 1 + ENTITY_TYPES.length) % ENTITY_TYPES.length];
            updatePanel();
        }
    });

    window.addEventListener('mousedown', (e) => {
        if (!isPlacementDebugEnabled() || !_reticle || !_scene) return;
        if (_panel && _panel.contains(e.target as Node)) return;
        // Left click only
        if (e.button !== 0) return;

        // Place through the snapshot restore path (processMapEntity), not a bare
        // scene.add: batched species get a live instance slot, the object joins
        // animatedFoliage (so saves serialize it) and ChunkStreamer can evict it.
        const id = nextSnapshotId(_currentType);
        const q = _reticle.quaternion;
        const px = round2(_reticle.position.x);
        const py = round2(_reticle.position.y);
        const pz = round2(_reticle.position.z);
        const snapshot: EntitySnapshot = {
            schemaVersion: CURRENT_SNAPSHOT_VERSION,
            id,
            entity: {
                type: _currentType,
                position: [px, py, pz],
                rotation: { quat: [q.x, q.y, q.z, q.w] },
                scale: round2(_currentScale),
                placement: 'absolute',
                params: {},
            },
        };
        const created = restoreEntity(snapshot, null, { rebuildPhysicsGrid: true });
        const obj = created[0];
        if (obj) {
            _lastSpawnedObject = obj;
            // Dev sidecar write so the placement survives a reload (?debugPlace only).
            void saveSnapshot(snapshot);

            console.log(`[DebugPlace] Spawned ${_currentType}`);
            console.log(JSON.stringify({ ...snapshot.entity, id }, null, 2) + ',');
        } else {
            console.warn(`[DebugPlace] Could not create type ${_currentType}`);
        }
    });

    void restoreDevPlacements();

    console.log('[debug-place] Enabled — ?debugPlace=1');
}

export function updatePlacementDebug(cameraPos: THREE.Vector3, cameraDir: THREE.Vector3): void {
    if (!DEBUG_PLACE || !_reticle) return;

    // Raycast roughly forward to the ground
    // If looking up (cameraDir.y >= 0), just project a fixed distance ahead
    let dist = 10.0;
    if (cameraDir.y < -0.01) {
        // Distance to intersection with horizontal plane at roughly ground level
        // (Assuming ground is near Y=0 for the rough projection distance)
        dist = Math.max(2.0, Math.min(50.0, cameraPos.y / -cameraDir.y));
    }

    const rx = cameraPos.x + cameraDir.x * dist;
    const rz = cameraPos.z + cameraDir.z * dist;
    const ry = getGroundHeight(rx, rz);

    _reticle.position.set(rx, ry, rz);

    const normal = sampleGroundNormal(rx, rz);
    _scratchQuat.setFromUnitVectors(_up, normal);
    _scratchQuatY.setFromAxisAngle(_up, _currentRotation);

    _reticle.quaternion.copy(_scratchQuat).multiply(_scratchQuatY);
    _reticle.scale.setScalar(_currentScale);
}

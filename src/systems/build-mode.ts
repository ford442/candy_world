const _normalScratch = new THREE.Vector3();
const _upVector = new THREE.Vector3(0, 1, 0);
/**
 * @file src/systems/build-mode.ts
 * @brief In-world placement editor for players.
 *
 * Player-facing version of the placement gizmo. Allows placing, removing
 * and adjusting objects to compose the world dynamically.
 */

import * as THREE from 'three';
import { editHistory } from './edit-history.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    nextSnapshotId,
    snapshotEntity,
    type EntitySnapshot,
} from './entity-snapshot-core.ts';
import { getGroundHeight, isInLakeBasin, sampleGroundNormal } from './ground-system.ts';
import { PlaceCommand, RemoveCommand } from './world-commands.ts';
import { announce } from '../ui/announcer.ts';
import { getRegisteredTypes, registerBuiltinWorldObjectTypes } from '../world/foliage-registry.ts';
import {
    SLOPE_ALIGN_TYPES,
    getEntityFootprintRadius,
    getGroundAlignedQuaternion,
    getMaxSlopeAngle,
    plantOnSurface,
    sampleGroundY,
    getFootprintSamples,
} from '../world/placement-utils.ts';
import { animatedFoliage } from '../world/state.ts';

const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['cloud', 'sky_island']);

const PRE_PLANT_Y: Readonly<Record<string, number>> = {
    floating_orb: 1.5,
    swingable_vine: 8,
    wisteria_cluster: 4,
};

const RAY_MAX = 120;
const RAY_STEP = 0.5;
const MAX_FOOTPRINT_SPREAD = 0.25;
const DIAGNOSTIC_FOOTPRINT = 0.3;
const HOVER_RADIUS = 2.5;

const STATUS_COLORS = { ok: 0x4ade80, warn: 0xfbbf24, bad: 0xf87171 } as const;
type GhostStatus = keyof typeof STATUS_COLORS;

let _isActive = false;
let _types: string[] = [];
let _currentType = '';
let _scale = 1.0;
let _rotation = 0;

let _ghost: THREE.Group | null = null;
let _ghostBody: THREE.Mesh | null = null;
let _ghostMat: THREE.MeshBasicMaterial | null = null;
let _hoverMarker: THREE.Mesh | null = null;

let _panel: HTMLElement | null = null;

const _hit = new THREE.Vector3();
let _ghostState = { hit: false, status: 'ok' as GhostStatus, msg: '' };
let _frame = 0;

export function isBuildModeActive(): boolean {
    return _isActive;
}

export function toggleBuildMode(scene: THREE.Scene): void {
    if (_isActive) {
        disableBuildMode();
    } else {
        enableBuildMode(scene);
    }
}

function enableBuildMode(scene: THREE.Scene): void {
    if (_isActive) return;
    _isActive = true;

    registerBuiltinWorldObjectTypes();
    _types = getRegisteredTypes()
        .filter((t) => !EXCLUDED_TYPES.has(t))
        .sort();
    if (!_types.includes(_currentType)) _currentType = _types[0] ?? 'mushroom';

    if (!_panel) {
        _panel = buildPanel();
        document.body.appendChild(_panel);
    }
    _panel.style.display = 'flex';

    if (!_ghost) {
        buildGhost(scene);
    }
    if (_ghost) _ghost.visible = true;

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener(
        'wheel',
        onWheel as EventListener,
        { passive: false } as EventListenerOptions
    );
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });

    announce('Build mode activated', 'polite');
}

function disableBuildMode(): void {
    if (!_isActive) return;
    _isActive = false;

    if (_panel) _panel.style.display = 'none';
    if (_ghost) _ghost.visible = false;
    if (_hoverMarker) _hoverMarker.visible = false;

    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener(
        'wheel',
        onWheel as EventListener,
        { passive: false } as EventListenerOptions
    );
    window.removeEventListener('mousedown', onMouseDown, { capture: true });
    window.removeEventListener('contextmenu', onContextMenu, { capture: true });

    announce('Build mode deactivated', 'polite');
}

function buildGhost(scene: THREE.Scene): void {
    _ghostMat = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.ok,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
    });
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    bodyGeo.translate(0, 0.5, 0);
    _ghostBody = new THREE.Mesh(bodyGeo, _ghostMat);
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, _ghostMat);
    _ghostBody.add(ring);
    _ghostBody.renderOrder = ring.renderOrder = 9999;

    _ghost = new THREE.Group();
    _ghost.add(_ghostBody);
    _ghost.visible = false;
    scene.add(_ghost);

    const hoverGeo = new THREE.RingGeometry(1.2, 1.4, 32);
    hoverGeo.rotateX(-Math.PI / 2);
    _hoverMarker = new THREE.Mesh(
        hoverGeo,
        new THREE.MeshBasicMaterial({
            color: 0xfb923c,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
        })
    );
    _hoverMarker.renderOrder = 9999;
    _hoverMarker.visible = false;
    scene.add(_hoverMarker);
}

function buildPanel(): HTMLElement {
    const p = document.createElement('div');
    p.style.cssText = `
        position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(20,20,20,0.85); color: #fff; padding: 12px;
        border-radius: 8px; font-family: monospace; font-size: 13px;
        z-index: 9999; display: flex; gap: 12px; align-items: center;
        pointer-events: auto; backdrop-filter: blur(4px);
    `;

    const select = document.createElement('select');
    select.style.cssText =
        'background: #333; color: #fff; padding: 4px; border: 1px solid #555; border-radius: 4px;';
    for (const t of _types) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === _currentType) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener('change', () => {
        _currentType = select.value;
        _scale = 1.0;
        _rotation = 0;
        announce(`Selected ${_currentType}`, 'polite');
    });

    const label = document.createElement('div');
    label.innerHTML = `<b>Build Mode</b><br><span style="color:#aaa;font-size:11px">LMB: Place | RMB: Remove | R: Rotate | Wheel: Scale</span>`;

    p.appendChild(label);
    p.appendChild(select);
    return p;
}

export function updateBuildMode(cameraPos: THREE.Vector3, cameraDir: THREE.Vector3): void {
    if (!_isActive || !_ghost) return;

    if ((_frame++ & 1) === 1) return;

    _ghostState.hit = raycastGround(cameraPos, cameraDir, _hit);
    if (_ghostState.hit) evaluateGhost(_currentType, _hit.x, _hit.z);
    else setGhostStatus('bad', `no surface within ${RAY_MAX} m`);

    updateHover();
    applyGhostVisuals();
}

function raycastGround(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): boolean {
    const pos = origin.clone();
    for (let t = 0; t < RAY_MAX; t += RAY_STEP) {
        const h = getGroundHeight(pos.x, pos.z);
        if (pos.y <= h) {
            out.set(pos.x, h, pos.z);
            return true;
        }
        pos.addScaledVector(dir, RAY_STEP);
    }
    return false;
}

function evaluateGhost(type: string, x: number, z: number): void {
    if (!_ghost) return;

    const radius = getEntityFootprintRadius(type);
    const preY = PRE_PLANT_Y[type] ?? 0;

    _ghost.position.set(x, _hit.y + preY, z);

    plantOnSurface(_ghost, x, z, {});

    let badPlacement = false;
    let warnMsg = '';

    if (SLOPE_ALIGN_TYPES.has(type)) {
        const normal = _normalScratch;
        sampleGroundNormal(x, z);
        _ghost.quaternion.copy(getGroundAlignedQuaternion(_ghost));
        const slope = normal.angleTo(_upVector);
        if (slope > getMaxSlopeAngle()) {
            badPlacement = true;
            warnMsg = 'Slope too steep';
        }
    } else {
        _ghost.quaternion.setFromAxisAngle(_upVector, _rotation);
    }

    const samplesNum = getFootprintSamples();
    const baseHeight = getGroundHeight(x, z);
    let maxDiff = 0;
    for (let i = 0; i < samplesNum; i++) {
        const sy = getGroundHeight(x, z);
        const diff = Math.abs(sy - baseHeight);
        if (diff > maxDiff) maxDiff = diff;
    }

    if (maxDiff > MAX_FOOTPRINT_SPREAD * _scale) {
        badPlacement = true;
        warnMsg = warnMsg || 'Footprint clips ground excessively';
    }

    if (badPlacement) {
        setGhostStatus('bad', warnMsg);
    } else if (isInLakeBasin(x, z) && type !== 'water_lily') {
        setGhostStatus('warn', 'In water basin');
    } else {
        setGhostStatus('ok', 'Valid placement');
    }

    _ghost.scale.setScalar(_scale);
}

function setGhostStatus(status: GhostStatus, msg: string): void {
    _ghostState.status = status;
    _ghostState.msg = msg;
}

function applyGhostVisuals(): void {
    if (!_ghost || !_ghostMat || !_ghostBody) return;
    _ghost.visible = _ghostState.hit;
    _ghostMat.color.setHex(STATUS_COLORS[_ghostState.status]);
    _ghostBody.scale.set(
        getEntityFootprintRadius(_currentType) || DIAGNOSTIC_FOOTPRINT,
        1,
        getEntityFootprintRadius(_currentType) || DIAGNOSTIC_FOOTPRINT
    );
}

function updateHover(): void {
    if (!_hoverMarker) return;
    const hover = findNearestHover();
    if (hover) {
        _hoverMarker.position.copy(hover.position);
        _hoverMarker.visible = true;
    } else {
        _hoverMarker.visible = false;
    }
}

function findNearestHover(): THREE.Object3D | null {
    if (!_ghostState.hit) return null;
    let bestDist = HOVER_RADIUS * HOVER_RADIUS;
    let best: THREE.Object3D | null = null;

    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        if (!obj || !obj.userData?.mapEntityId) continue;
        const d = obj.position.distanceToSquared(_hit);
        if (d < bestDist) {
            bestDist = d;
            best = obj;
        }
    }
    return best;
}

function onKeyDown(e: KeyboardEvent): void {
    if (!_isActive) return;

    let handled = true;
    if (e.code === 'KeyR') {
        _rotation += Math.PI / 4;
    } else if (e.code === 'KeyZ' && e.ctrlKey) {
        editHistory.undo();
        announce('Undo placement');
    } else if (e.code === 'KeyY' && e.ctrlKey) {
        editHistory.redo();
        announce('Redo placement');
    } else if (e.code === 'Escape') {
        disableBuildMode();
    } else {
        handled = false;
    }

    if (handled) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function onWheel(e: WheelEvent): void {
    if (!_isActive) return;
    if (_panel && _panel.contains(e.target as Node)) return;
    e.preventDefault();
    _scale += e.deltaY < 0 ? 0.1 : -0.1;
    _scale = Math.max(0.1, Math.min(5.0, _scale));
}

function onContextMenu(e: MouseEvent): void {
    if (!_isActive) return;
    e.preventDefault();
    e.stopPropagation();
}

function onMouseDown(e: MouseEvent): void {
    if (!_isActive || !_ghostState.hit || !_ghost) return;
    if (_panel && _panel.contains(e.target as Node)) return;

    if (e.button === 0) {
        // LMB -> Place
        if (_ghostState.status === 'bad') {
            announce('Cannot place here', 'polite');
            return;
        }

        const snap: EntitySnapshot = {
            id: nextSnapshotId(undefined),
            schemaVersion: CURRENT_SNAPSHOT_VERSION,
            entity: {
                id: 'player_placed_' + Date.now(),
                type: _currentType,
                position: [_ghost.position.x, _ghost.position.y, _ghost.position.z],
                rotation: {
                    quat: [
                        _ghost.quaternion.x,
                        _ghost.quaternion.y,
                        _ghost.quaternion.z,
                        _ghost.quaternion.w,
                    ],
                },
                scale: _scale,
                category: 'prop',
                layer: 'ground',
                placement: 'ground',
                params: { provenance: 'authored' },
            },
        };

        editHistory.execute(new PlaceCommand(snap));
        announce(`Placed ${_currentType}`, 'polite');
    } else if (e.button === 2) {
        // RMB -> Remove
        const hover = findNearestHover();
        if (hover) {
            const snap = snapshotEntity(hover);
            if (snap) {
                editHistory.execute(new RemoveCommand(snap));
                announce(`Removed ${snap.entity.type}`, 'polite');
            }
        }
    }
}

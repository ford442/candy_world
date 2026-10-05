/**
 * @file src/debug/debug-place.ts
 * @brief In-world placement editor gizmo (dev builds only).
 *
 * Enabled via URL flag:
 *   ?debugPlace=1
 *
 * The ghost is planted every other frame through the same `plantOnSurface`
 * call `processMapEntity` makes (base offset, footprint sampling, slope
 * alignment), so it shows where a commit will land, and turns red when that
 * placement would be tilt-clamped or leave the base clipping uneven ground.
 *
 * Place / move / remove are EditHistory commands and persist to the dev
 * sidecar (IndexedDB). Alt+S merges every sidecar placement into a full
 * map.json download; Alt+C copies just the new records.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { editHistory } from '../systems/edit-history.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    nextSnapshotId,
    snapshotEntity,
    type EntitySnapshot,
} from '../systems/entity-snapshot-core.ts';
import {
    deleteSnapshot,
    loadDevSnapshots,
    saveSnapshot,
} from '../systems/entity-snapshot-store.ts';
import {
    getGroundHeight,
    getRawTerrainHeight,
    isInLakeBasin,
    sampleGroundFootprint,
    sampleGroundNormal,
} from '../systems/ground-system.ts';
import { applyEntitySnapshots } from '../systems/save-system/entity-snapshot.ts';
import {
    MoveCommand,
    PlaceCommand,
    RemoveCommand,
    type PlaceCommandHooks,
} from '../systems/world-commands.ts';
import { announce } from '../ui/announcer.ts';
import { showToast } from '../utils/toast.ts';
import { getRegisteredTypes, registerBuiltinWorldObjectTypes } from '../world/foliage-registry.ts';
import { getMapSourceFromUrl, type CandyMapEntity } from '../world/map-loader.ts';
import {
    SLOPE_ALIGN_TYPES,
    getEntityFootprintRadius,
    getFootprintSamples,
    getGroundAlignedQuaternion,
    getMaxSlopeAngle,
    plantOnSurface,
    sampleGroundY,
} from '../world/placement-utils.ts';
import {
    buildDeltaEntities,
    deltaFingerprint,
    mergeDeltaIntoMap,
    serializeMap,
    validateDeltaEntities,
} from './debug-place-export.ts';

const _hasFlag = (key: string): boolean => {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
};

const DEBUG_PLACE = import.meta.env.DEV && _hasFlag('debugPlace');

// Clouds are forced to absolute placement and sky islands float at authored
// heights, so a ground-hugging ghost can't represent either.
const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['cloud', 'sky_island']);

/** processMapEntity lifts these above the sampled ground before planting (default params). */
const PRE_PLANT_Y: Readonly<Record<string, number>> = {
    floating_orb: 1.5,
    swingable_vine: 8,
    wisteria_cluster: 4,
};

const RAY_MAX = 120;
const RAY_STEP = 0.5;
/** Ground height difference under the base above which part of it floats or sinks. */
const MAX_FOOTPRINT_SPREAD = 0.25;
/** Diagnostic footprint for types the pipeline samples at a single point. */
const DIAGNOSTIC_FOOTPRINT = 0.3;
/** How close (XZ) the ghost must be to a placement for Alt+G / Alt+Backspace. */
const HOVER_RADIUS = 2.5;
const EXPORTED_KEY = 'candy.debugPlace.exportedFingerprint';

const STATUS_COLORS = { ok: 0x4ade80, warn: 0xfbbf24, bad: 0xf87171 } as const;
type GhostStatus = keyof typeof STATUS_COLORS;

const _up = new THREE.Vector3(0, 1, 0);
const _hit = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _proxy = new THREE.Object3D();

const _ghostState = {
    hit: false,
    x: 0,
    y: 0,
    z: 0,
    quat: new THREE.Quaternion(),
    footprint: DIAGNOSTIC_FOOTPRINT,
    onPlatform: false,
    status: 'bad' as GhostStatus,
    reason: 'waiting for first frame',
};

let _panel: HTMLElement | null = null;
let _ghost: THREE.Group | null = null;
let _ghostBody: THREE.Mesh | null = null;
let _ghostMat: THREE.MeshBasicMaterial | null = null;
let _hoverMarker: THREE.Mesh | null = null;

let _types: string[] = [];
let _currentType = 'mushroom';
let _currentScale = 1.0;
let _currentYaw = 0.0;
let _frame = 0;
let _lastSpawnedObject: THREE.Object3D | null = null;

/** Every `?debugPlace` placement (the dev sidecar), keyed by snapshot id. Export source of truth. */
const _placements = new Map<string, EntitySnapshot>();
let _hovered: EntitySnapshot | null = null;
/** Placement picked up by Alt+G, waiting to be dropped at the ghost. */
let _held: EntitySnapshot | null = null;

let _delta: CandyMapEntity[] = [];
let _deltaError: string | null = null;
let _exportedFingerprint = deltaFingerprint([]);
let _dirty = false;

export function isPlacementDebugEnabled(): boolean {
    return DEBUG_PLACE;
}

// ---------------------------------------------------------------------------
// Placement state, sidecar persistence and the dirty flag
// ---------------------------------------------------------------------------

// Sidecar writes are chained and read the latest state per id, so a move's
// delete + put for the same id can't land out of order.
let _persistChain: Promise<unknown> = Promise.resolve();
function persist(id: string): void {
    _persistChain = _persistChain
        .then(() => {
            const snap = _placements.get(id);
            return snap ? saveSnapshot(snap) : deleteSnapshot(id);
        })
        .catch((err) => console.warn('[DebugPlace] Sidecar write failed:', err));
}

// Dev sidecar persistence follows the edit history, so an undone placement
// doesn't come back on reload.
const _placeHooks: PlaceCommandHooks = {
    onApplied(objects, snapshot) {
        _lastSpawnedObject = objects[0] ?? null;
        _placements.set(snapshot.id, snapshot);
        persist(snapshot.id);
        onPlacementsChanged();
    },
    onReverted(snapshot) {
        if (_lastSpawnedObject?.userData?.mapEntityId === snapshot.id) _lastSpawnedObject = null;
        _placements.delete(snapshot.id);
        persist(snapshot.id);
        onPlacementsChanged();
    },
};

function readExportedFingerprint(): string {
    try {
        return localStorage.getItem(EXPORTED_KEY) ?? deltaFingerprint([]);
    } catch {
        return deltaFingerprint([]);
    }
}

function onPlacementsChanged(): void {
    _delta = buildDeltaEntities(_placements.values());
    try {
        validateDeltaEntities(_delta);
        _deltaError = null;
    } catch (err) {
        _deltaError = err instanceof Error ? err.message : String(err);
    }
    _dirty = deltaFingerprint(_delta) !== _exportedFingerprint;
    updatePanel();
}

function markExported(): void {
    _exportedFingerprint = deltaFingerprint(_delta);
    try {
        localStorage.setItem(EXPORTED_KEY, _exportedFingerprint);
    } catch {
        // Storage blocked: the flag still clears for this session.
    }
    _dirty = false;
    updatePanel();
}

/** Keys typed into the panel's form controls must not trigger edit shortcuts. */
function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function round(v: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
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
    for (const snap of snapshots) {
        if (!_placements.has(snap.id)) _placements.set(snap.id, snap);
    }
    onPlacementsChanged();
    if (snapshots.length === 0) return;
    const result = applyEntitySnapshots(snapshots);
    console.log(
        `[DebugPlace] Restored ${result.restored} dev placements ` +
            `(${result.alreadyLive} already live, ${result.skipped} skipped)`
    );
    if (result.restored > 0) showToast(`Restored ${result.restored} placements`, '🏗️', 2500);
}

// ---------------------------------------------------------------------------
// Ghost: raycast + grounded-placement pipeline
// ---------------------------------------------------------------------------

/** March the view ray against the unified ground (terrain, lake, platforms). */
function raycastGround(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): boolean {
    let prevT = 0;
    if (origin.y - getGroundHeight(origin.x, origin.z) < 0) return false;
    for (let t = RAY_STEP; t <= RAY_MAX; t += RAY_STEP) {
        const px = origin.x + dir.x * t;
        const pz = origin.z + dir.z * t;
        if (origin.y + dir.y * t - getGroundHeight(px, pz) > 0) {
            prevT = t;
            continue;
        }
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) * 0.5;
            const mx = origin.x + dir.x * mid;
            const mz = origin.z + dir.z * mid;
            if (origin.y + dir.y * mid - getGroundHeight(mx, mz) > 0) lo = mid;
            else hi = mid;
        }
        out.set(origin.x + dir.x * hi, 0, origin.z + dir.z * hi);
        return true;
    }
    return false;
}

function setGhostStatus(status: GhostStatus, reason: string): void {
    _ghostState.status = status;
    _ghostState.reason = reason;
}

/** Plant the proxy exactly as processMapEntity would, then judge the result. */
function evaluateGhost(type: string, x: number, z: number): void {
    const s = _ghostState;
    const groundY = sampleGroundY(x, z);

    _proxy.userData = {};
    _proxy.quaternion.setFromAxisAngle(_up, _currentYaw);
    s.y = plantOnSurface(_proxy, x, z, {
        groundY: groundY + (PRE_PLANT_Y[type] ?? 0),
        entityType: type,
        registerDebugMarker: false,
    });
    getGroundAlignedQuaternion(_proxy, s.quat);
    s.x = x;
    s.z = z;
    s.onPlatform = groundY - getRawTerrainHeight(x, z) > CONFIG.ground.platformElevationThreshold;

    const normalY = sampleGroundNormal(x, z).y;
    const tilt = Math.acos(Math.min(1, Math.max(-1, normalY)));
    const radius = getEntityFootprintRadius(type) || DIAGNOSTIC_FOOTPRINT;
    const fp = sampleGroundFootprint(x, z, radius, getFootprintSamples());
    const spread = fp.maxY - fp.minY;
    s.footprint = radius;

    const maxTilt = getMaxSlopeAngle();
    if (tilt > maxTilt) {
        const deg = Math.round(THREE.MathUtils.radToDeg(tilt));
        const maxDeg = Math.round(THREE.MathUtils.radToDeg(maxTilt));
        const effect = SLOPE_ALIGN_TYPES.has(type) ? 'tilt clamped' : 'stands upright';
        setGhostStatus('bad', `slope ${deg}° > ${maxDeg}°, ${effect}`);
    } else if (spread > MAX_FOOTPRINT_SPREAD) {
        setGhostStatus('bad', `uneven base: ${spread.toFixed(2)} m under footprint`);
    } else if (s.onPlatform) {
        setGhostStatus('warn', 'on platform: saved at absolute Y, may drift');
    } else if (isInLakeBasin(x, z)) {
        setGhostStatus('warn', 'lake basin: underwater');
    } else {
        setGhostStatus('ok', 'grounded');
    }
}

function updateHover(): void {
    _hovered = null;
    if (!_ghostState.hit) return;
    let best = HOVER_RADIUS * HOVER_RADIUS;
    for (const snap of _placements.values()) {
        const [px, , pz] = snap.entity.position;
        const dx = px - _ghostState.x;
        const dz = pz - _ghostState.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= best) {
            best = d2;
            _hovered = snap;
        }
    }
}

function applyGhostVisuals(): void {
    if (!_ghost || !_ghostBody || !_ghostMat || !_hoverMarker) return;
    const s = _ghostState;
    _ghost.visible = s.hit;
    _ghostMat.color.setHex(STATUS_COLORS[s.status]);
    if (s.hit) {
        _ghost.position.set(s.x, s.y, s.z);
        _ghost.quaternion.copy(s.quat);
        _ghostBody.scale.set(s.footprint, 1.5 * _currentScale, s.footprint);
    }

    const target = _held ?? _hovered;
    _hoverMarker.visible = !!target;
    if (target) {
        const [px, py, pz] = target.entity.position;
        _hoverMarker.position.set(px, py + 0.05, pz);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Snapshot of the ghost's current transform; `base` carries a moved entity's other fields. */
function buildSnapshot(id: string, base?: CandyMapEntity): EntitySnapshot {
    const s = _ghostState;
    const q = _yawQuat.setFromAxisAngle(_up, _currentYaw);
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: {
            ...(base ?? { params: {} }),
            id,
            type: base?.type ?? _currentType,
            position: [round(s.x), round(s.y), round(s.z)],
            rotation: { quat: [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)] },
            scale: round(_currentScale),
            // processMapEntity re-grounds 'ground' records at load; a platform
            // may not be registered yet then, so keep the planted Y instead.
            placement: s.onPlatform ? 'absolute' : 'ground',
        },
    };
}

/** Shared gate for place / drop: a surface is under the crosshair and the ghost isn't red. */
function canCommit(force: boolean): boolean {
    if (!_ghostState.hit) {
        showToast('No surface under the crosshair', '⚠️', 2000);
        return false;
    }
    if (_ghostState.status === 'bad' && !force) {
        showToast(`${_ghostState.reason} (Alt+Shift+P to force)`, '⛔', 2500);
        return false;
    }
    return true;
}

function commitPlacement(force: boolean): void {
    if (_held) {
        dropHeld(force);
        return;
    }
    if (!canCommit(force)) return;
    const snapshot = buildSnapshot(nextSnapshotId(_currentType));
    if (editHistory.execute(new PlaceCommand(snapshot, _placeHooks))) {
        console.log(`[DebugPlace] Placed ${snapshot.id}`, snapshot.entity);
        announce(`Placed ${_currentType}`, 'polite');
    } else {
        showToast(`Could not place ${_currentType}`, '❌', 2000);
    }
}

function yawOf(rotation: CandyMapEntity['rotation']): number {
    if (
        rotation &&
        typeof rotation === 'object' &&
        !Array.isArray(rotation) &&
        'quat' in rotation &&
        Array.isArray(rotation.quat)
    ) {
        const [x, y, z, w] = rotation.quat;
        return _euler.setFromQuaternion(_yawQuat.set(x, y, z, w), 'YXZ').y;
    }
    return typeof rotation === 'number' ? rotation : 0;
}

function grabHovered(): void {
    if (_held) {
        dropHeld(false);
        return;
    }
    if (!_hovered) {
        showToast(`Nothing to grab within ${HOVER_RADIUS} m`, '⚠️', 2000);
        return;
    }
    _held = _hovered;
    _currentType = _held.entity.type;
    _currentScale = typeof _held.entity.scale === 'number' ? _held.entity.scale : 1;
    _currentYaw = yawOf(_held.entity.rotation);
    announce(`Moving ${_held.entity.type}`, 'polite');
    updatePanel();
}

function dropHeld(force: boolean): void {
    const held = _held;
    if (!held || !canCommit(force)) return;
    const to = buildSnapshot(held.id, held.entity);
    if (editHistory.execute(new MoveCommand(held, to, _placeHooks))) {
        _held = null;
        announce(`Moved ${to.entity.type}`, 'polite');
    } else {
        showToast(`Could not move ${held.entity.type}`, '❌', 2000);
    }
    updatePanel();
}

function cancelHeld(): void {
    if (!_held) return;
    _held = null;
    updatePanel();
}

function removeHovered(): void {
    const target = _held ?? _hovered;
    if (!target) {
        showToast(`No placement within ${HOVER_RADIUS} m`, '⚠️', 2000);
        return;
    }
    if (editHistory.execute(new RemoveCommand(target, _placeHooks))) {
        if (_held === target) _held = null;
        announce(`Removed ${target.entity.type}`, 'polite');
    } else {
        showToast(`Could not remove ${target.entity.type}`, '❌', 2000);
    }
    updatePanel();
}

function undoRedo(isUndo: boolean): void {
    const hadStep = (isUndo ? editHistory.undoCount : editHistory.redoCount) > 0;
    const ok = isUndo ? editHistory.undo() : editHistory.redo();
    const verb = isUndo ? 'Undo' : 'Redo';
    if (ok) announce(`${verb} placement`, 'polite');
    // A failed step was dropped from history (see EditHistory.undo).
    else if (hadStep) showToast(`Couldn't ${verb.toLowerCase()} that placement`, '⚠️', 2000);
}

function cycleType(step: number): void {
    if (_held) {
        showToast('Drop or cancel (Esc) the moved entity first', '⚠️', 2000);
        return;
    }
    const idx = Math.max(0, _types.indexOf(_currentType));
    _currentType = _types[(idx + step + _types.length) % _types.length];
    updatePanel();
}

function nudgeScale(delta: number): void {
    _currentScale = Math.max(0.1, Math.min(10.0, round(_currentScale + delta)));
    updatePanel();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function downloadText(text: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** Merge every placement into the map this session booted from; download the result. */
async function exportFullMap(): Promise<void> {
    if (_deltaError) {
        showToast('Placements fail map validation (see panel)', '❌', 2500);
        return;
    }
    const source = getMapSourceFromUrl();
    try {
        const response = await fetch(source, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const { map, added, replaced } = mergeDeltaIntoMap(await response.json(), _delta);
        downloadText(serializeMap(map), 'map.json');
        markExported();
        console.log(
            `[DebugPlace] Exported map.json (${added} added, ${replaced} replaced, ` +
                `${map.entities.length} entities). Overwrite assets/map.json, then run ` +
                '`npm run generate:chunk-index` and Prettier on assets/map-chunks.json.'
        );
        showToast(`map.json downloaded (+${added}, ~${replaced})`, '💾', 3000);
    } catch (err) {
        console.error('[DebugPlace] Full map export failed:', err);
        showToast('Export failed (see console)', '❌', 2500);
    }
}

/** Quick path: the placement records alone, to paste into map.json by hand. */
async function copyDelta(): Promise<void> {
    const json = JSON.stringify(_delta, null, 2);
    console.log(`[DebugPlace] ${_delta.length} placement records:\n${json}`);
    try {
        await navigator.clipboard.writeText(json);
        showToast(`Copied ${_delta.length} records`, '📋', 2000);
    } catch {
        showToast('Clipboard unavailable, records logged to console', '📋', 2500);
    }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

const LEGEND: ReadonlyArray<[string, string]> = [
    ['Alt+P', 'place (Shift forces red)'],
    ['Alt+G', 'grab / drop hovered'],
    ['Alt+⌫', 'remove hovered'],
    ['Alt+R', 'rotate 22.5° (Shift: back)'],
    ['Alt+[ ]', 'prev / next type'],
    ['Alt+− =', 'scale (or Alt+wheel)'],
    ['Alt+S', 'download full map.json'],
    ['Alt+C', 'copy placement records'],
    ['Ctrl+Z/Y', 'undo / redo'],
    ['Esc', 'cancel move'],
];

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    css = '',
    text = ''
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text) node.textContent = text;
    return node;
}

const _ui: {
    select?: HTMLSelectElement;
    transform?: HTMLElement;
    status?: HTMLElement;
    target?: HTMLElement;
    saved?: HTMLElement;
    exportBtn?: HTMLButtonElement;
} = {};

function buildPanel(): HTMLElement {
    const panel = el(
        'div',
        [
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
            'gap:4px',
            'max-width:300px',
        ].join(';')
    );
    panel.id = 'debug-place-panel';
    panel.appendChild(el('div', 'font-weight:bold;color:#4ade80', '🏗️ Placement Editor'));

    const typeRow = el('div', 'display:flex;align-items:center;gap:6px', 'Type:');
    const select = el('select', 'background:#000;color:#fff;border:1px solid #555;padding:2px;');
    select.setAttribute('aria-label', 'Entity type');
    for (const type of _types) {
        const opt = el('option', '', type);
        opt.value = type;
        select.appendChild(opt);
    }
    select.addEventListener('change', () => {
        if (_held) {
            select.value = _currentType;
            return;
        }
        _currentType = select.value;
        updatePanel();
    });
    typeRow.appendChild(select);
    panel.appendChild(typeRow);

    _ui.select = select;
    _ui.transform = panel.appendChild(el('div'));
    _ui.status = panel.appendChild(el('div'));
    _ui.target = panel.appendChild(el('div', 'color:#fb923c'));
    _ui.saved = panel.appendChild(el('div'));

    const buttons = el('div', 'display:flex;gap:4px;flex-wrap:wrap');
    const btnCss =
        'color:#fff;border:1px solid #3c6;background:#1a4;padding:2px 6px;cursor:pointer;';
    const exportBtn = el('button', btnCss, 'Download map.json');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', () => void exportFullMap());
    const copyBtn = el('button', btnCss, 'Copy records');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => void copyDelta());
    const snapshotBtn = el('button', btnCss, 'Capture Snapshot');
    snapshotBtn.type = 'button';
    snapshotBtn.addEventListener('click', captureLastSpawned);
    buttons.append(exportBtn, copyBtn, snapshotBtn);
    panel.appendChild(buttons);
    _ui.exportBtn = exportBtn;

    const legend = el(
        'div',
        'opacity:0.7;font-size:10px;margin-top:4px;display:grid;grid-template-columns:auto 1fr;column-gap:8px'
    );
    for (const [keys, action] of LEGEND) {
        legend.append(el('span', 'color:#a5b4fc', keys), el('span', '', action));
    }
    panel.appendChild(legend);
    return panel;
}

let _lastStatusText = '';
function updateStatusLine(): void {
    if (!_ui.status) return;
    const s = _ghostState;
    const text = s.hit
        ? `● ${s.reason} (${s.x.toFixed(1)}, ${s.y.toFixed(2)}, ${s.z.toFixed(1)})`
        : `● ${s.reason}`;
    const color = STATUS_COLORS[s.status].toString(16).padStart(6, '0');
    const key = text + color;
    if (key === _lastStatusText) return;
    _lastStatusText = key;
    _ui.status.textContent = text;
    _ui.status.style.color = `#${color}`;
}

function updateTargetLine(): void {
    if (!_ui.target) return;
    const text = _held ? `moving: ${_held.id}` : _hovered ? `hover: ${_hovered.id}` : '';
    if (_ui.target.textContent !== text) _ui.target.textContent = text;
}

function updatePanel(): void {
    if (!_panel) return;
    if (_ui.select) {
        _ui.select.value = _currentType;
        _ui.select.disabled = !!_held;
    }
    if (_ui.transform) {
        const deg = Math.round(THREE.MathUtils.radToDeg(_currentYaw));
        _ui.transform.textContent = `Scale: ${_currentScale.toFixed(2)}   Yaw: ${deg}°`;
    }
    if (_ui.saved) {
        const n = _placements.size;
        _ui.saved.textContent = _dirty
            ? `● ${n} placements, unexported changes`
            : `✓ ${n} placements, exported`;
        _ui.saved.style.color = _dirty ? '#fbbf24' : '#9ca3af';
    }
    if (_ui.exportBtn) {
        _ui.exportBtn.style.background = _deltaError ? '#7f1d1d' : '#1a4';
        _ui.exportBtn.style.borderColor = _deltaError ? '#f87171' : '#3c6';
        _ui.exportBtn.title = _deltaError ?? 'Merge placements into the loaded map and download it';
    }
    updateTargetLine();
}

function captureLastSpawned(): void {
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
            console.log(`[DebugPlace] Entity Snapshot:\n${JSON.stringify(snap, null, 2)}`);
            // Dev-only sidecar write; never touches assets/map.json.
            _placements.set(snap.id, snap);
            persist(snap.id);
            onPlacementsChanged();
            showToast('Snapshot captured to console', '<span aria-hidden="true">✅</span>', 2000);
            announce('Snapshot captured', 'polite');
        } else {
            showToast('Failed to capture snapshot', '❌', 2000);
        }
    } catch (err) {
        console.error(err);
        showToast('Error capturing snapshot', '❌', 2000);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Capture-phase so handled combos never reach gameplay (bare Q/E/R are the
 * jukebox, dash and dance). Actions are Alt-modified to stay clear of
 * browser chrome; `code` is used because macOS Option rewrites `key`.
 */
function onKeyDown(e: KeyboardEvent): void {
    if (isTextEntryTarget(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const isUndo = key === 'z' && !e.shiftKey;
        const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
        if (isUndo || isRedo) {
            e.preventDefault();
            e.stopImmediatePropagation();
            undoRedo(isUndo);
        }
        return;
    }

    if (e.code === 'Escape') {
        cancelHeld();
        return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;

    const once = !e.repeat;
    let handled = true;
    switch (e.code) {
        case 'KeyP':
            if (once) commitPlacement(e.shiftKey);
            break;
        case 'KeyG':
            if (once) grabHovered();
            break;
        case 'Backspace':
            if (once) removeHovered();
            break;
        case 'KeyS':
            if (once) void exportFullMap();
            break;
        case 'KeyC':
            if (once) void copyDelta();
            break;
        case 'KeyR':
            _currentYaw = THREE.MathUtils.euclideanModulo(
                _currentYaw + (e.shiftKey ? -1 : 1) * (Math.PI / 8),
                Math.PI * 2
            );
            updatePanel();
            break;
        case 'BracketRight':
            cycleType(1);
            break;
        case 'BracketLeft':
            cycleType(-1);
            break;
        case 'Equal':
            nudgeScale(0.1);
            break;
        case 'Minus':
            nudgeScale(-0.1);
            break;
        default:
            handled = false;
    }
    if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}

function onWheel(e: WheelEvent): void {
    if (!e.altKey) return;
    if (_panel && _panel.contains(e.target as Node)) return;
    e.preventDefault();
    nudgeScale(e.deltaY < 0 ? 0.1 : -0.1);
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (!_dirty) return;
    e.preventDefault();
    e.returnValue = '';
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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
    // The ring shares the body's XZ scale so it traces the sampled footprint.
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

export function initPlacementDebug(scene: THREE.Scene, _camera: THREE.PerspectiveCamera): void {
    if (!DEBUG_PLACE || _panel) return;

    registerBuiltinWorldObjectTypes();
    _types = getRegisteredTypes()
        .filter((t) => !EXCLUDED_TYPES.has(t))
        .sort();
    if (!_types.includes(_currentType)) _currentType = _types[0] ?? 'mushroom';

    _exportedFingerprint = readExportedFingerprint();
    _panel = buildPanel();
    document.body.appendChild(_panel);
    buildGhost(scene);
    onPlacementsChanged();

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('beforeunload', onBeforeUnload);

    void restoreDevPlacements();

    console.log('[debug-place] Enabled — ?debugPlace=1');
}

export function updatePlacementDebug(cameraPos: THREE.Vector3, cameraDir: THREE.Vector3): void {
    if (!DEBUG_PLACE || !_ghost) return;
    // Every other frame: a ray march plus footprint sampling is cheap, but not free.
    if ((_frame++ & 1) === 1) return;

    _ghostState.hit = raycastGround(cameraPos, cameraDir, _hit);
    if (_ghostState.hit) evaluateGhost(_held?.entity.type ?? _currentType, _hit.x, _hit.z);
    else setGhostStatus('bad', `no surface within ${RAY_MAX} m`);

    updateHover();
    applyGhostVisuals();
    updateStatusLine();
    updateTargetLine();
}

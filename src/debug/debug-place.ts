/**
 * @file src/debug/debug-place.ts
 * @brief In-world placement editor gizmo (dev builds only).
 *
 * Enabled via URL flag:
 *   ?debugPlace=1
 *
 * A thin dev overlay on the build-mode placement pipeline
 * (`systems/authoring/placement-core.ts`): same raycast, same grounded ghost,
 * same snapshot shape, same EditHistory commands. What it adds is the dev
 * sidecar and the map.json export.
 *
 * Place / move / remove are EditHistory commands and persist to the dev
 * sidecar (IndexedDB). Alt+S merges every sidecar placement into a full
 * map.json download; Alt+C copies just the new records.
 */

import * as THREE from 'three';
import {
    EXCLUDED_TYPES,
    HOVER_RADIUS,
    RAY_MAX,
    STATUS_COLORS,
    buildPlacementSnapshot,
    createPlacementGhost,
    createPlacementState,
    evaluatePlacement,
    raycastGround,
    round,
    yawOf,
    type PlacementGhost,
} from '../systems/authoring/placement-core.ts';
import { editHistory } from '../systems/edit-history.ts';
import {
    nextSnapshotId,
    snapshotEntity,
    type EntitySnapshot,
} from '../systems/entity-snapshot-core.ts';
import {
    deleteSnapshot,
    loadDevSnapshots,
    saveSnapshot,
} from '../systems/entity-snapshot-store.ts';
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

const EXPORTED_KEY = 'candy.debugPlace.exportedFingerprint';

const _hit = new THREE.Vector3();
const _ghostState = createPlacementState();

let _panel: HTMLElement | null = null;
let _ghost: PlacementGhost | null = null;

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
// Ghost: hover target (the raycast + grounded pipeline is placement-core.ts)
// ---------------------------------------------------------------------------

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
    const target = _held ?? _hovered;
    _ghost?.update(_ghostState, _currentScale, target ? target.entity.position : null);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Snapshot of the ghost's current transform; `base` carries a moved entity's other fields. */
function buildSnapshot(id: string, base?: CandyMapEntity): EntitySnapshot {
    return buildPlacementSnapshot(id, _ghostState, {
        type: _currentType,
        yaw: _currentYaw,
        scale: _currentScale,
        base,
    });
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
    _ghost = createPlacementGhost(scene);
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
    if (_ghostState.hit) {
        evaluatePlacement(
            _ghostState,
            _held?.entity.type ?? _currentType,
            _hit.x,
            _hit.z,
            _currentYaw
        );
    } else {
        _ghostState.status = 'bad';
        _ghostState.reason = `no surface within ${RAY_MAX} m`;
    }

    updateHover();
    applyGhostVisuals();
    updateStatusLine();
    updateTargetLine();
}

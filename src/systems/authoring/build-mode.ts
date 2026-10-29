/**
 * @file src/systems/authoring/build-mode.ts
 * @brief In-world build mode (#1974): place, select, move, paint and remove entities.
 *
 * Lazy `authoring` chunk, loaded by `systems/build-mode-lazy.ts` on the first
 * `B`. Pointer lock stays on: the view ray through the reticle is the cursor.
 * Every edit is a WorldCommand run through the shared EditHistory, so it is an
 * undo step and lands in the open WorldDocument's command log. The ghost uses
 * the same placement pipeline as the `?debugPlace` dev overlay
 * (`placement-core.ts`).
 */

import * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';
import { cameraRef, rendererRef } from '../../core/game-loop-core.ts';
import { input } from '../../core/input/actions/index.ts';
import { registerSystem } from '../../core/scheduler/index.ts';
import { announce } from '../../ui/announcer.ts';
import { showToast } from '../../utils/toast.ts';
import { ensureActiveWorldDocument } from '../../world/document/active.ts';
import {
    getRegisteredTypes,
    getTypeMeta,
    registerBuiltinWorldObjectTypes,
} from '../../world/foliage-registry.ts';
import { MUSICAL_FLORA_TYPES } from '../../world/generation-entities.ts';
import { animatedFoliage } from '../../world/state.ts';
import {
    reportBuildCursor,
    reportBuildModeState,
    setBuildSelectionSource,
} from '../build-mode-state.ts';
import { editHistory, type WorldCommand } from '../edit-history.ts';
import { nextSnapshotId, snapshotEntity, type EntitySnapshot } from '../entity-snapshot-core.ts';
import { SYSTEM_BUDGETS } from '../performance-budget/systems-budget.ts';
import {
    BatchCommand,
    MoveCommand,
    PaintCommand,
    PlaceCommand,
    RemoveCommand,
} from '../world-commands.ts';
import { BuildModeUi, TOOLS, type BuildTool } from './build-mode-ui.ts';
import { checkMoveBudget, checkPlacementBudget, countAuthored } from './chunk-budget.ts';
import { BuildGizmo, type GizmoMode } from './gizmo.ts';
import {
    CANDY_PAINT_PALETTE,
    PALETTE_CATEGORIES,
    buildPalette,
    type PaletteEntry,
} from './palette.ts';
import {
    EXCLUDED_TYPES,
    HOVER_RADIUS,
    buildPlacementSnapshot,
    createPlacementGhost,
    createPlacementState,
    evaluatePlacement,
    raycastGround,
    round,
    yawOf,
    type PlacementGhost,
} from './placement-core.ts';

const KEY_ROTATE_STEP = Math.PI / 4;
const SCALE_STEP = 0.1;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const SNAP_GRID = 0.5;
const NUDGE_STEP = 0.5;
const MAX_SELECTION = 32;

interface Target {
    id: string;
    obj: THREE.Object3D;
}

interface Held {
    snapshots: EntitySnapshot[];
    anchorX: number;
    anchorZ: number;
    yawAtGrab: number;
}

let _scene: THREE.Scene | null = null;
let _active = false;
let _ready = false;
let _tool: BuildTool = 'place';
let _palette: PaletteEntry[] = [];
let _category: PaletteEntry['category'] = 'mushrooms';
let _type = 'mushroom';
let _scale = 1;
let _yaw = 0;
let _snap = false;
let _paintIndex = 0;
let _frame = 0;

const _state = createPlacementState();
const _hit = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _offset = { x: 0, z: 0 };
let _target: Target | null = null;
const _selection = new Map<string, EntitySnapshot>();
let _held: Held | null = null;

let _ghost: PlacementGhost | null = null;
let _ui: BuildModeUi | null = null;
let _gizmo: BuildGizmo | null = null;
const _selectionRings: THREE.Mesh[] = [];
let _ringGeo: THREE.RingGeometry | null = null;
let _ringMat: THREE.MeshBasicMaterial | null = null;
let _unregisterSystem: (() => void) | null = null;
/** The `build` context and action handlers, released on disable. */
let _unbindInput: (() => void)[] = [];
let _popGizmoContext: (() => void) | null = null;

export function isBuildModeActive(): boolean {
    return _active;
}

export function toggleBuildMode(scene: THREE.Scene): void {
    if (_active) disableBuildMode();
    else enableBuildMode(scene);
}

function report(): void {
    reportBuildModeState(_active, !!_gizmo?.isOpen);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function enableBuildMode(scene: THREE.Scene): void {
    if (_active) return;
    _active = true;
    _scene = scene;

    registerBuiltinWorldObjectTypes();
    _palette = buildPalette(
        getRegisteredTypes().filter(
            (t) =>
                !EXCLUDED_TYPES.has(t) &&
                (FEATURE_FLAGS.musicalFlora || !MUSICAL_FLORA_TYPES.has(t))
        ),
        (t) => !!getTypeMeta(t)?.supportsMusic
    );
    if (!_palette.some((e) => e.type === _type)) _type = _palette[0]?.type ?? 'mushroom';
    _category = entryFor(_type)?.category ?? 'mushrooms';

    if (!_ghost) _ghost = createPlacementGhost(scene);
    _ghost.setVisible(true);
    if (!_ui) {
        _ui = new BuildModeUi(
            {
                onTool: setTool,
                onCategory: (c) => selectCategory(c),
                onEntry: (t) => selectType(t),
                onPaint: (i) => setPaint(i),
            },
            { onMode: setGizmoMode, onDone: closeGizmo }
        );
    }
    _ui.setVisible(true);
    renderUi();
    setBuildSelectionSource(() => [..._selection.keys()]);

    if (!_unregisterSystem) {
        _unregisterSystem = registerSystem({
            id: 'authoring.buildMode',
            phase: 'render-prep',
            budgetMs: SYSTEM_BUDGETS.authoring.frameMs,
            enabled: () => _active,
            update: (ctx) => updateBuildMode(ctx.camera),
        });
    }

    _unbindInput = bindBuildActions();
    window.addEventListener('contextmenu', onContextMenu, { capture: true });

    // Edits must land in the open document: hold them until it is ready.
    _ready = false;
    _ui.setStatus('Opening your world…');
    ensureActiveWorldDocument()
        .then(() => {
            _ready = true;
        })
        .catch((err) => {
            console.warn('[BuildMode] World document unavailable; edits will not be saved:', err);
            _ready = true;
        });

    report();
    announce(
        'Build mode on. Click to place, 1 to 4 switch tools, brackets change piece, B leaves.',
        'polite'
    );
}

function disableBuildMode(): void {
    if (!_active) return;
    closeGizmo();
    _active = false;
    _held = null;
    _target = null;
    _selection.clear();
    _ghost?.setVisible(false);
    _ui?.setVisible(false);
    syncSelectionRings();
    reportBuildCursor(false, 0, 0, 0, _tool);

    for (const off of _unbindInput) off();
    _unbindInput = [];
    window.removeEventListener('contextmenu', onContextMenu, { capture: true });

    report();
    announce('Build mode off', 'polite');
}

// ---------------------------------------------------------------------------
// Palette / tool state
// ---------------------------------------------------------------------------

function entryFor(type: string): PaletteEntry | undefined {
    return _palette.find((e) => e.type === type);
}

function renderUi(): void {
    _ui?.render({
        tool: _tool,
        category: _category,
        entries: _palette,
        selectedType: _type,
        paintIndex: _paintIndex,
    });
}

function setTool(tool: BuildTool): void {
    if (_held) cancelHeld();
    _tool = tool;
    renderUi();
    announce(`${TOOLS.find((t) => t.id === tool)?.label ?? tool} tool`, 'polite');
}

function selectType(type: string): void {
    const entry = entryFor(type);
    if (!entry) return;
    _type = type;
    _category = entry.category;
    _scale = 1;
    _yaw = 0;
    if (_tool !== 'place') _tool = 'place';
    renderUi();
    announce(`${entry.label} selected`, 'polite');
}

function selectCategory(category: PaletteEntry['category']): void {
    _category = category;
    const first = _palette.find((e) => e.category === category);
    if (first) _type = first.type;
    renderUi();
    const label = PALETTE_CATEGORIES.find((c) => c.id === category)?.label ?? category;
    announce(first ? `${label}: ${first.label}` : `${label}: nothing to place yet`, 'polite');
}

function stepEntry(step: number): void {
    const inCat = _palette.filter((e) => e.category === _category);
    if (inCat.length === 0) return;
    const i = Math.max(
        0,
        inCat.findIndex((e) => e.type === _type)
    );
    selectType(inCat[(i + step + inCat.length) % inCat.length].type);
}

function stepCategory(step: number): void {
    const ids = PALETTE_CATEGORIES.map((c) => c.id);
    const i = ids.indexOf(_category);
    selectCategory(ids[(i + step + ids.length) % ids.length]);
}

function setPaint(index: number): void {
    _paintIndex = (index + CANDY_PAINT_PALETTE.length) % CANDY_PAINT_PALETTE.length;
    if (_tool !== 'paint') _tool = 'paint';
    renderUi();
    announce(`Paint: ${CANDY_PAINT_PALETTE[_paintIndex].name}`, 'polite');
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------

/** Scheduler `render-prep` system: aim the ghost and the target ring. */
export function updateBuildMode(camera: THREE.Camera): void {
    if (!_active || !_ghost) return;
    if ((_frame++ & 1) === 1) return;
    if (_gizmo?.isOpen) {
        _ghost.update({ ..._state, hit: false }, _scale, null);
        _gizmo.tick();
        return;
    }

    camera.getWorldDirection(_dir);
    _state.hit = raycastGround(camera.position, _dir, _hit);
    if (_state.hit) {
        // Arrow-key nudge, camera-relative on the ground plane.
        _forward.set(_dir.x, 0, _dir.z).normalize();
        _right.set(-_forward.z, 0, _forward.x);
        let x = _hit.x + _right.x * _offset.x + _forward.x * _offset.z;
        let z = _hit.z + _right.z * _offset.x + _forward.z * _offset.z;
        if (_snap) {
            x = Math.round(x / SNAP_GRID) * SNAP_GRID;
            z = Math.round(z / SNAP_GRID) * SNAP_GRID;
        }
        const type = _held ? _held.snapshots[0].entity.type : _type;
        evaluatePlacement(_state, type, x, z, _yaw);
    } else {
        _state.status = 'bad';
        _state.reason = 'no ground under the cursor';
    }

    _target = _held || !_state.hit ? null : findTarget(_state.x, _state.z);
    reportBuildCursor(_state.hit, _state.x, _state.y, _state.z, _tool);
    const showGhost = _tool === 'place' || !!_held;
    _ghost.update(showGhost ? _state : { ..._state, hit: false }, _scale, targetPosition());
    syncSelectionRings();
    _ui?.setStatus(statusLine());
}

function targetPosition(): readonly number[] | null {
    if (!_target) return null;
    const p = _target.obj.position;
    return [p.x, p.y, p.z];
}

/** Nearest identified entity within HOVER_RADIUS of (x, z). Allocation-free scan. */
function findTarget(x: number, z: number): Target | null {
    let best = HOVER_RADIUS * HOVER_RADIUS;
    let hit: THREE.Object3D | null = null;
    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        const id: unknown = obj?.userData?.mapEntityId;
        const type: unknown = obj?.userData?.mapEntityType;
        if (typeof id !== 'string' || (typeof type === 'string' && EXCLUDED_TYPES.has(type)))
            continue;
        const dx = obj.position.x - x;
        const dz = obj.position.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
            best = d2;
            hit = obj;
        }
    }
    return hit ? { id: hit.userData.mapEntityId as string, obj: hit } : null;
}

function statusLine(): string {
    if (!_ready) return 'Opening your world…';
    const tool = TOOLS.find((t) => t.id === _tool)?.label ?? _tool;
    const parts: string[] = [tool];
    if (_held) {
        parts.push(`moving ${_held.snapshots.length} — click or Enter to drop, Esc cancels`);
    } else if (_tool === 'place') {
        parts.push(entryFor(_type)?.label ?? _type);
        const deg = Math.round(THREE.MathUtils.radToDeg(_yaw)) % 360;
        parts.push(`${deg < 0 ? deg + 360 : deg}°`, `×${_scale.toFixed(1)}`);
    } else if (_target) {
        parts.push(`target: ${_target.obj.userData?.mapEntityType ?? 'entity'}`);
    }
    if (_tool === 'paint') parts.push(CANDY_PAINT_PALETTE[_paintIndex].name);
    if (_selection.size > 0) parts.push(`${_selection.size} selected`);
    if (_snap) parts.push('snap');
    if (_tool === 'place' || _held) parts.push(_state.reason);
    parts.push(`undo ${editHistory.undoCount} · redo ${editHistory.redoCount}`);
    return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function execute(cmd: WorldCommand, success: string, failure: string): boolean {
    if (editHistory.execute(cmd)) {
        announce(success, 'polite');
        return true;
    }
    showToast(failure, '⚠️', 2500);
    return false;
}

/** A refused action: a toast, which also announces it. */
function refuse(message: string): void {
    showToast(message, '⛔', 2500);
}

function snapshotOf(target: Target): EntitySnapshot | null {
    return snapshotEntity(target.obj, { id: target.id, includeLegacyHash: false });
}

function placeAtCursor(): void {
    if (!_state.hit) return refuse('No ground under the cursor');
    if (_state.status === 'bad') return refuse(`Can't build here: ${_state.reason}`);
    const budget = checkPlacementBudget(countAuthored(animatedFoliage), _state.x, _state.z);
    if (!budget.ok) return refuse(budget.message);
    const entry = entryFor(_type);
    const snapshot = buildPlacementSnapshot(nextSnapshotId(_type), _state, {
        type: _type,
        yaw: _yaw,
        scale: _scale,
        extra: { ...entry?.defaults, params: { ...(entry?.defaults.params ?? {}) } },
    });
    const label = entry?.label ?? _type;
    execute(new PlaceCommand(snapshot), `Placed ${label}`, `Couldn't place ${label}`);
}

/** Snapshots the action applies to: the selection if the target is in it, else the target. */
function actionSubjects(): EntitySnapshot[] {
    if (_target && _selection.has(_target.id)) return [..._selection.values()];
    if (_target) {
        const snap = snapshotOf(_target);
        return snap ? [snap] : [];
    }
    return [..._selection.values()];
}

function asOne(commands: WorldCommand[], label: string): WorldCommand {
    return commands.length === 1 ? commands[0] : new BatchCommand(commands, label);
}

function removeSubjects(): void {
    const subjects = actionSubjects();
    if (subjects.length === 0) return refuse(`Nothing to remove within ${HOVER_RADIUS} m`);
    const ok = execute(
        asOne(
            subjects.map((s) => new RemoveCommand(s)),
            'remove'
        ),
        subjects.length === 1
            ? `Removed ${subjects[0].entity.type}`
            : `Removed ${subjects.length} pieces`,
        "Couldn't remove that"
    );
    if (ok) for (const s of subjects) _selection.delete(s.id);
}

function paintSubjects(): void {
    const subjects = actionSubjects();
    if (subjects.length === 0) return refuse(`Nothing to paint within ${HOVER_RADIUS} m`);
    const hex = CANDY_PAINT_PALETTE[_paintIndex].hex;
    const paintable = subjects.filter((s) => entryFor(s.entity.type)?.paintable);
    if (paintable.length === 0) return refuse(`${subjects[0].entity.type} can't be painted yet`);
    const painted = paintable.map((from): EntitySnapshot => ({
        ...from,
        entity: { ...from.entity, params: { ...(from.entity.params ?? {}), color: hex } },
    }));
    const what = paintable.length === 1 ? paintable[0].entity.type : `${paintable.length} pieces`;
    const ok = execute(
        asOne(
            paintable.map((from, i) => new PaintCommand(from, painted[i])),
            'paint'
        ),
        `Painted ${what} ${CANDY_PAINT_PALETTE[_paintIndex].name}`,
        "Couldn't paint that"
    );
    if (ok) for (const to of painted) if (_selection.has(to.id)) _selection.set(to.id, to);
}

function toggleSelect(additive: boolean): void {
    if (!_target) {
        if (!additive && _selection.size > 0) {
            _selection.clear();
            announce('Selection cleared', 'polite');
        }
        return;
    }
    const id = _target.id;
    if (_selection.has(id)) {
        _selection.delete(id);
        announce(`Deselected; ${_selection.size} selected`, 'polite');
        return;
    }
    if (!additive) _selection.clear();
    if (_selection.size >= MAX_SELECTION) return refuse(`Up to ${MAX_SELECTION} pieces at once`);
    const snap = snapshotOf(_target);
    if (!snap) return refuse("That can't be selected");
    _selection.set(id, snap);
    announce(`Selected ${snap.entity.type}; ${_selection.size} selected`, 'polite');
}

function grabSubjects(): void {
    if (_held) return dropHeld();
    const subjects = actionSubjects();
    if (subjects.length === 0) return refuse(`Nothing to move within ${HOVER_RADIUS} m`);
    _held = {
        snapshots: subjects,
        anchorX: _state.x,
        anchorZ: _state.z,
        yawAtGrab: _yaw,
    };
    if (subjects.length === 1) {
        _yaw = yawOf(subjects[0].entity.rotation);
        _held.yawAtGrab = _yaw;
        _scale = typeof subjects[0].entity.scale === 'number' ? subjects[0].entity.scale : 1;
    }
    announce(
        `Moving ${subjects.length === 1 ? subjects[0].entity.type : `${subjects.length} pieces`}`,
        'polite'
    );
}

function cancelHeld(): void {
    if (!_held) return;
    _held = null;
    announce('Move cancelled', 'polite');
}

function dropHeld(): void {
    const held = _held;
    if (!held) return;
    if (!_state.hit) return refuse('No ground under the cursor');
    if (_state.status === 'bad' && held.snapshots.length === 1) {
        return refuse(`Can't build here: ${_state.reason}`);
    }
    const dx = _state.x - held.anchorX;
    const dz = _state.z - held.anchorZ;
    const dyaw = _yaw - held.yawAtGrab;
    const probe = createPlacementState();
    const commands: WorldCommand[] = [];
    const moved: EntitySnapshot[] = [];
    for (const from of held.snapshots) {
        const [fx, , fz] = from.entity.position;
        const single = held.snapshots.length === 1;
        const x = single ? _state.x : fx + dx;
        const z = single ? _state.z : fz + dz;
        const yaw = yawOf(from.entity.rotation) + (single ? 0 : dyaw);
        evaluatePlacement(probe, from.entity.type, x, z, single ? _yaw : yaw);
        const to = buildPlacementSnapshot(from.id, probe, {
            type: from.entity.type,
            yaw: single ? _yaw : yaw,
            scale: single ? _scale : typeof from.entity.scale === 'number' ? from.entity.scale : 1,
            base: from.entity,
        });
        commands.push(new MoveCommand(from, to));
        moved.push(to);
    }
    const budget = moveBudget(held.snapshots, moved);
    if (!budget.ok) return refuse(budget.message);
    const ok = execute(
        asOne(commands, 'move'),
        moved.length === 1 ? `Moved ${moved[0].entity.type}` : `Moved ${moved.length} pieces`,
        "Couldn't move that"
    );
    if (ok) {
        _held = null;
        for (const to of moved) if (_selection.has(to.id)) _selection.set(to.id, to);
    }
}

/** The caps, for pieces moving from `from[i]` to `to[i]` (a drop or a gizmo drag). */
function moveBudget(from: readonly EntitySnapshot[], to: readonly EntitySnapshot[]) {
    return checkMoveBudget(
        countAuthored(animatedFoliage),
        from.map((f, i) => ({
            id: f.id,
            from: [f.entity.position[0], f.entity.position[2]] as const,
            to: [to[i].entity.position[0], to[i].entity.position[2]] as const,
        }))
    );
}

function actAtCursor(button: 0 | 2, shift: boolean): void {
    if (!_ready) return refuse('Still opening your world…');
    if (button === 2) return removeSubjects();
    if (_held) return dropHeld();
    switch (_tool) {
        case 'place':
            return placeAtCursor();
        case 'select':
            return toggleSelect(shift);
        case 'paint':
            return paintSubjects();
        case 'remove':
            return removeSubjects();
    }
}

function undoRedo(isUndo: boolean): void {
    if (!_ready) return;
    const had = (isUndo ? editHistory.undoCount : editHistory.redoCount) > 0;
    const ok = isUndo ? editHistory.undo() : editHistory.redo();
    if (ok) announce(isUndo ? 'Undone' : 'Redone', 'polite');
    else if (had) refuse(`Couldn't ${isUndo ? 'undo' : 'redo'} that step`);
    else announce(isUndo ? 'Nothing to undo' : 'Nothing to redo', 'polite');
    // A reverted move or paint changes what the selection should point at.
    _selection.clear();
}

// ---------------------------------------------------------------------------
// Gizmo
// ---------------------------------------------------------------------------

function openGizmo(): void {
    const subjects = actionSubjects();
    if (subjects.length !== 1) return refuse('Target or select exactly one piece for the gizmo');
    const camera = cameraRef;
    const dom = (rendererRef as { domElement?: HTMLElement } | null)?.domElement;
    if (!_scene || !camera || !dom) return refuse('The gizmo is not available yet');
    if (!_gizmo) {
        _gizmo = new BuildGizmo(_scene, camera, dom, {
            onCommit: (from, to) => {
                const budget = moveBudget([from], [to]);
                if (!budget.ok) {
                    refuse(budget.message);
                    return null;
                }
                const ok = execute(
                    new MoveCommand(from, to),
                    `Adjusted ${to.entity.type}`,
                    "Couldn't adjust that"
                );
                return ok ? to : null;
            },
        });
    }
    _held = null;
    _gizmo.open(subjects[0]);
    _popGizmoContext ??= input.pushContext('gizmo');
    _ui?.setGizmo(true, _gizmo.mode);
    report();
    if (document.pointerLockElement) document.exitPointerLock();
    announce('Gizmo open: drag the handles, T move, Y rotate, U scale, Enter when done', 'polite');
}

function setGizmoMode(mode: GizmoMode): void {
    if (!_gizmo?.isOpen) return;
    _gizmo.setMode(mode);
    _ui?.setGizmo(true, mode);
}

function closeGizmo(): void {
    if (!_gizmo?.isOpen) return;
    _gizmo.close();
    _popGizmoContext?.();
    _popGizmoContext = null;
    _ui?.setGizmo(false, _gizmo.mode);
    report();
    // Closing is a key press or a click: a user gesture, so re-locking is allowed.
    if (_active && !document.pointerLockElement) {
        // The pause menu's Start button re-locks if this is refused.
        Promise.resolve(document.body.requestPointerLock() as unknown).catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// Selection rings
// ---------------------------------------------------------------------------

function syncSelectionRings(): void {
    if (!_scene) return;
    if (!_ringGeo) {
        _ringGeo = new THREE.RingGeometry(1.0, 1.15, 24);
        _ringGeo.rotateX(-Math.PI / 2);
        _ringMat = new THREE.MeshBasicMaterial({
            color: 0xff69b4,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
        });
    }
    let i = 0;
    for (const snap of _selection.values()) {
        let ring = _selectionRings[i];
        if (!ring) {
            ring = new THREE.Mesh(_ringGeo, _ringMat!);
            ring.renderOrder = 9999;
            _scene.add(ring);
            _selectionRings.push(ring);
        }
        const [x, y, z] = snap.entity.position;
        ring.position.set(x, y + 0.08, z);
        ring.visible = _active;
        i++;
    }
    for (; i < _selectionRings.length; i++) _selectionRings[i].visible = false;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function nudge(dx: number, dz: number): void {
    _offset.x = round(_offset.x + dx);
    _offset.z = round(_offset.z + dz);
}

function setScale(next: number): void {
    _scale = round(THREE.MathUtils.clamp(next, MIN_SCALE, MAX_SCALE), 2);
}

/**
 * Build-mode input is the `build` context (#2027): it claims mouse 0/2, the
 * wheel and its keys, so `fire`, `dance` and the rest don't reach gameplay,
 * while WASD and look still do. The open gizmo pushes `gizmo` on top.
 */
function bindBuildActions(): (() => void)[] {
    const repeat = { repeat: true };
    const ready = (fn: () => void) => () => {
        if (_ready) fn();
    };
    return [
        input.pushContext('build'),
        input.onPress('build.place', () => actAtCursor(0, false)),
        input.onPress('build.select.add', () => actAtCursor(0, true)),
        input.onPress('build.remove', () => {
            if (!_ready) return refuse('Still opening your world…');
            removeSubjects();
        }),
        input.onPress('build.tool.1', () => setTool('place')),
        input.onPress('build.tool.2', () => setTool('select')),
        input.onPress('build.tool.3', () => setTool('paint')),
        input.onPress('build.tool.4', () => setTool('remove')),
        input.onPress('build.piece', (s) => stepEntry(Math.sign(s.value)), repeat),
        input.onPress('build.category', (s) => stepCategory(Math.sign(s.value)), repeat),
        // A key press is ±1 (45°), a wheel notch ±1/3 (15°): see bindings.ts.
        input.onPress('build.rotate', (s) => (_yaw += s.value * KEY_ROTATE_STEP), repeat),
        input.onPress(
            'build.scale',
            (s) => setScale(_scale + Math.sign(s.value) * SCALE_STEP),
            repeat
        ),
        input.onPress('build.snap', () => {
            _snap = !_snap;
            announce(_snap ? 'Grid snap on' : 'Grid snap off', 'polite');
        }),
        input.onPress('build.paint', (s) => setPaint(_paintIndex + Math.sign(s.value)), repeat),
        input.onPress(
            'build.nudge',
            ({ axis }) => nudge(Math.sign(axis.x) * NUDGE_STEP, Math.sign(axis.y) * NUDGE_STEP),
            repeat
        ),
        input.onPress('build.recenter', () => {
            _offset.x = 0;
            _offset.z = 0;
            announce('Cursor back at the reticle', 'polite');
        }),
        input.onPress('build.grab', ready(grabSubjects)),
        input.onPress('build.gizmo', ready(openGizmo)),
        // Esc also releases pointer lock (the browser's): the pause menu opens
        // as usual, and the move in progress is dropped.
        input.onPress('build.cancel', cancelHeld),
        input.onPress('undo', () => undoRedo(true), repeat),
        input.onPress('redo', () => undoRedo(false), repeat),
        input.onPress('gizmo.translate', () => setGizmoMode('translate')),
        input.onPress('gizmo.rotate', () => setGizmoMode('rotate')),
        input.onPress('gizmo.scale', () => setGizmoMode('scale')),
        input.onPress('gizmo.done', closeGizmo),
    ];
}

function onContextMenu(e: MouseEvent): void {
    if (!_active || _ui?.contains(e.target)) return;
    e.preventDefault();
}

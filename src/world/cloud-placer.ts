/**
 * @file src/world/cloud-placer.ts
 * @brief Dev-friendly placement for walkable candy cloud platforms (#1266).
 *
 * Console API (always available in browser):
 *   spawnCloud(x, y, z, size?)
 *   exportCloudPlacements()
 *   clearDevCloudPlacements()
 *
 * Interactive placer (?cloudPlacer=1 or import.meta.env.DEV):
 *   ` (backtick) — toggle placement mode
 *   Shift + left-click — spawn at raycast hit (ground or air)
 *   1 / 2 / 3 — size preset (small / medium / large)
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { createCloud } from '../foliage/clouds.ts';
import { safeAddFoliage } from './generation-core.ts';
import { getGroundHeight } from '../systems/ground-system.ts';
import { addCollisionObject } from '../utils/wasm-loader.ts';
import type { WeatherSystem } from '../systems/weather.ts';

const STORAGE_KEY = 'candy_dev_cloud_placements';

export type CloudSizePreset = 'small' | 'medium' | 'large';

export interface CloudPlacementRecord {
    id: string;
    x: number;
    y: number;
    z: number;
    size: number;
    rotation: number;
}

export interface CloudPlacerInitOptions {
    scene: THREE.Scene;
    camera: THREE.Camera;
    weatherSystem?: WeatherSystem | null;
}

let _scene: THREE.Scene | null = null;
let _camera: THREE.Camera | null = null;
let _weatherSystem: WeatherSystem | null = null;
let _placerActive = false;
let _sizePreset: CloudSizePreset = 'medium';
let _placementCount = 0;
let _records: CloudPlacementRecord[] = [];
let _hudEl: HTMLElement | null = null;

const _raycaster = new THREE.Raycaster();
const _lookDir = new THREE.Vector3();
const _scratch = new THREE.Vector3();

function isPlacerFlagEnabled(): boolean {
    try {
        if (import.meta.env.DEV) return true;
        return (
            new URLSearchParams(window.location.search).get('cloudPlacer') === '1' ||
            localStorage.getItem('candy_cloudPlacer') === '1'
        );
    } catch {
        return false;
    }
}

function snapCoord(value: number): number {
    const grid = CONFIG.cloud.gridSnap;
    if (!grid || grid <= 0) return value;
    return Math.round(value / grid) * grid;
}

function resolveSize(size?: number | CloudSizePreset): number {
    if (typeof size === 'number' && Number.isFinite(size)) return size;
    const preset = typeof size === 'string' ? size : _sizePreset;
    return CONFIG.cloud.sizePresets[preset] ?? CONFIG.cloud.defaultSize;
}

function nextPlacementId(): string {
    _placementCount += 1;
    return `dev:cloud:${Date.now().toString(36)}:${_placementCount}`;
}

function registerCloudPhysics(cloud: THREE.Object3D): void {
    if (!cloud.userData.isWalkable) return;
    addCollisionObject(
        2,
        cloud.position.x,
        cloud.position.y,
        cloud.position.z,
        cloud.scale.x || 1,
        cloud.scale.y || 1,
        0,
        0,
        0
    );
}

function persistRecords(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_records));
    } catch (err) {
        console.warn('[CloudPlacer] Failed to persist placements:', err);
    }
}

function loadPersistedRecords(): CloudPlacementRecord[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function updateHud(): void {
    if (!_hudEl) return;
    const status = _placerActive ? 'ON' : 'OFF';
    const size = resolveSize(_sizePreset).toFixed(1);
    _hudEl.textContent = `☁ Cloud placer ${status} | size ${size} | \` toggle | Shift+click place | 1/2/3 size`;
}

function ensureHud(): void {
    if (_hudEl || typeof document === 'undefined') return;
    let el = document.getElementById('cloud-placer-hud');
    if (!el) {
        el = document.createElement('div');
        el.id = 'cloud-placer-hud';
        el.style.cssText = [
            'position:fixed', 'top:8px', 'right:8px', 'z-index:10000',
            'font:12px/1.4 monospace', 'color:#fff', 'background:rgba(40,20,60,0.72)',
            'padding:6px 10px', 'border-radius:6px', 'pointer-events:none',
            'display:none', 'border:1px solid rgba(255,182,193,0.45)',
        ].join(';');
        document.body.appendChild(el);
    }
    _hudEl = el;
}

function setPlacerActive(active: boolean): void {
    _placerActive = active;
    if (_hudEl) _hudEl.style.display = active ? 'block' : 'none';
    updateHud();
    console.log(`[CloudPlacer] Placement mode ${active ? 'enabled' : 'disabled'}`);
}

/** Place a walkable cloud block at world coordinates. */
export function placeCloudBlock(
    x: number,
    y: number,
    z: number,
    options: {
        size?: number | CloudSizePreset;
        rotation?: number;
        id?: string;
        persist?: boolean;
    } = {}
): THREE.Object3D | null {
    if (!_scene || !_camera) {
        console.warn('[CloudPlacer] Not initialized — call initCloudPlacer first');
        return null;
    }

    const size = resolveSize(options.size);
    const id = options.id ?? nextPlacementId();
    const rotation = options.rotation ?? Math.random() * Math.PI * 2;

    const cloud = createCloud({ scale: size, tier: CONFIG.cloud.walkableTier });
    cloud.userData.tier = CONFIG.cloud.walkableTier;
    cloud.userData.isWalkable = CONFIG.cloud.walkableTier === 1;
    cloud.userData.persistentId = id;
    cloud.userData.devPlaced = true;
    cloud.userData.mapEntityType = 'cloud';

    cloud.position.set(x, y, z);
    cloud.rotation.y = rotation;

    const placed = safeAddFoliage(cloud, false, size * 0.8, _weatherSystem);
    if (!placed) {
        console.warn('[CloudPlacer] Failed to add cloud (CPU/batcher limit?)');
        return null;
    }

    registerCloudPhysics(cloud);

    const record: CloudPlacementRecord = { id, x, y, z, size, rotation };
    if (options.persist !== false) {
        _records.push(record);
        persistRecords();
    }

    console.log(`[CloudPlacer] Placed cloud ${id} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) size=${size}`);
    return cloud;
}

/** Console helper: spawnCloud(x, y, z, size?) */
export function spawnCloud(x: number, y: number, z: number, size?: number): THREE.Object3D | null {
    return placeCloudBlock(x, y, z, { size, persist: true });
}

/** Raycast from camera and place a cloud at the hit point or look distance. */
export function placeCloudAtLook(size?: number | CloudSizePreset): THREE.Object3D | null {
    if (!_camera || !_scene) return null;

    _camera.getWorldDirection(_lookDir);
    const origin = _camera.position;
    const maxDist = CONFIG.cloud.placementRayDistance;

    _raycaster.set(origin, _lookDir);
    _raycaster.far = maxDist;

    const hits = _raycaster.intersectObjects(_scene.children, true);
    let targetX: number;
    let targetY: number;
    let targetZ: number;

    const validHit = hits.find(h => {
        const obj = h.object;
        return obj.type !== 'Line' && obj.type !== 'LineSegments' && !obj.userData?.isDebugHelper;
    });

    if (validHit) {
        targetX = validHit.point.x;
        targetY = validHit.point.y + CONFIG.cloud.surfaceYOffset;
        targetZ = validHit.point.z;
    } else {
        _scratch.copy(_lookDir).multiplyScalar(maxDist).add(origin);
        targetX = _scratch.x;
        targetZ = _scratch.z;
        const terrainY = getGroundHeight(targetX, targetZ);
        targetY = Math.max(origin.y - 2, terrainY + CONFIG.cloud.defaultFloatHeight);
    }

    targetX = snapCoord(targetX);
    targetZ = snapCoord(targetZ);
    if (CONFIG.cloud.snapY) targetY = snapCoord(targetY);

    return placeCloudBlock(targetX, targetY, targetZ, { size });
}

/** Export dev-placed clouds as map.json entity entries. */
export function exportCloudPlacements(): { entities: Array<Record<string, unknown>> } {
    const entities = _records.map(r => ({
        type: 'cloud',
        placement: 'absolute',
        tier: CONFIG.cloud.walkableTier,
        position: [r.x, r.y, r.z],
        scale: r.size,
        rotation: r.rotation,
        params: { provenance: 'dev-placer', sourceId: r.id },
    }));
    console.log(`[CloudPlacer] ${entities.length} dev cloud(s) ready for map.json`);
    return { entities };
}

export function clearDevCloudPlacements(): void {
    _records = [];
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    console.log('[CloudPlacer] Cleared persisted dev placements — reload to remove from scene');
}

function restorePersistedPlacements(): void {
    const saved = loadPersistedRecords();
    if (saved.length === 0) return;

    console.log(`[CloudPlacer] Restoring ${saved.length} dev cloud(s) from localStorage`);
    for (const record of saved) {
        placeCloudBlock(record.x, record.y, record.z, {
            size: record.size,
            rotation: record.rotation,
            id: record.id,
            persist: false,
        });
    }
    _records = saved.slice();
}

function onKeyDown(event: KeyboardEvent): void {
    if (!isPlacerFlagEnabled()) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;

    switch (event.code) {
        case 'Backquote':
            event.preventDefault();
            setPlacerActive(!_placerActive);
            break;
        case 'Digit1':
            if (!_placerActive) return;
            _sizePreset = 'small';
            updateHud();
            break;
        case 'Digit2':
            if (!_placerActive) return;
            _sizePreset = 'medium';
            updateHud();
            break;
        case 'Digit3':
            if (!_placerActive) return;
            _sizePreset = 'large';
            updateHud();
            break;
        default:
            break;
    }
}

function onPointerDown(event: PointerEvent): void {
    if (!_placerActive || !event.shiftKey || event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest(
        'button, input, select, textarea, a, [role="dialog"], #ability-hud, #playlist-overlay'
    )) return;

    event.preventDefault();
    event.stopPropagation();
    placeCloudAtLook();
}

function installInteractivePlacer(): void {
    if (!isPlacerFlagEnabled()) return;
    ensureHud();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    console.log('[CloudPlacer] Interactive mode — press ` to toggle, Shift+click to place');
}

/** Initialize placer APIs and restore persisted dev clouds after world load. */
export function initCloudPlacer(options: CloudPlacerInitOptions): void {
    if (typeof window === 'undefined') return;

    _scene = options.scene;
    _camera = options.camera;
    _weatherSystem = options.weatherSystem ?? null;

    (window as any).spawnCloud = spawnCloud;
    (window as any).placeCloudAtLook = placeCloudAtLook;
    (window as any).exportCloudPlacements = exportCloudPlacements;
    (window as any).clearDevCloudPlacements = clearDevCloudPlacements;

    restorePersistedPlacements();
    installInteractivePlacer();
}

export function isCloudPlacerActive(): boolean {
    return _placerActive;
}

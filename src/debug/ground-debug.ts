/**
 * @file src/debug/ground-debug.ts
 * @brief Optional visualizer for issue #1265 ground-height / eye-height tuning.
 *
 * Enabled via URL flags:
 *   ?debugHeights=1  — draw ground-height sample grid around the player
 *   ?debugPlayer=1   — draw player eye/ground markers and the current target eye height
 *
 * The helpers are intentionally cheap (one LineSegments + a few meshes) and are
 * only created when a flag is present, so release builds pay zero cost.
 */

import * as THREE from 'three';
import { getGroundHeight, getEyeTargetY } from '../systems/ground-system.ts';
import { CONFIG } from '../core/config.ts';

const _hasFlag = (key: string): boolean => {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
};

const DEBUG_HEIGHTS = _hasFlag('debugHeights');
const DEBUG_PLAYER = _hasFlag('debugPlayer');
const DEBUG_CLOUDS = _hasFlag('debugClouds') || DEBUG_HEIGHTS;

let _enabled = DEBUG_HEIGHTS || DEBUG_PLAYER || DEBUG_CLOUDS;

let _scene: THREE.Scene | null = null;
let _playerMesh: THREE.Mesh | null = null;
let _groundMesh: THREE.Mesh | null = null;
let _eyeLine: THREE.Line | null = null;
let _gridLines: THREE.LineSegments | null = null;
let _gridBoxes: THREE.InstancedMesh | null = null;
let _plantedRings: THREE.InstancedMesh | null = null;
let _nearestBaseRing: THREE.Mesh | null = null;
let _nearestFootprintRing: THREE.Mesh | null = null;
let _nearestNormalArrow: THREE.Line | null = null;

// Cloud platform debug state (#1266)
interface CloudPlatformEntry {
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    topY: number;
    color: THREE.Color;
}

const _cloudPlatforms: CloudPlatformEntry[] = [];
let _cloudSurfaces: THREE.InstancedMesh | null = null;
let _cloudOutlines: THREE.LineSegments | null = null;

interface PlantedInstance {
    x: number;
    y: number;
    z: number;
    type?: string;
    footprintRadius?: number;
    normal?: THREE.Vector3;
}

const _plantedInstances: PlantedInstance[] = [];

const _white = new THREE.Color(0xffffff);
const _green = new THREE.Color(0x00ff00);
const _red = new THREE.Color(0xff0000);
const _yellow = new THREE.Color(0xffff00);
const _cyan = new THREE.Color(0x00ffff);
const _magenta = new THREE.Color(0xff00ff);

let _metricsEl: HTMLElement | null = null;
let _lastMetricsLog = 0;

/** Initialize the debug overlay. Call once after the scene is available. */
export function initGroundDebug(scene: THREE.Scene): void {
    if (!_enabled) return;
    _scene = scene;

    (window as any).__groundMetrics = null;
    (window as any).logGroundMetrics = () => {
        const m = (window as any).__groundMetrics;
        if (m) console.table(m);
        else console.log('[ground-debug] No metrics yet — enable ?debugPlayer=1');
        return m;
    };

    if (DEBUG_PLAYER) {
        const sphereGeo = new THREE.SphereGeometry(0.08, 8, 8);
        _playerMesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: _yellow, depthTest: false }));
        _playerMesh.renderOrder = 9999;
        scene.add(_playerMesh);

        _groundMesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: _green, depthTest: false }));
        _groundMesh.renderOrder = 9999;
        scene.add(_groundMesh);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        _eyeLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: _white, depthTest: false }));
        _eyeLine.renderOrder = 9999;
        _eyeLine.frustumCulled = false;
        scene.add(_eyeLine);

        let el = document.getElementById('ground-debug-metrics');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ground-debug-metrics';
            el.style.cssText = [
                'position:fixed', 'left:8px', 'bottom:8px', 'z-index:10000',
                'font:12px/1.4 monospace', 'color:#fff', 'background:rgba(0,0,0,0.55)',
                'padding:6px 8px', 'border-radius:4px', 'pointer-events:none',
            ].join(';');
            document.body.appendChild(el);
        }
        _metricsEl = el;
    }

    if (DEBUG_CLOUDS) {
        // Cloud platforms may have been registered during world generation before
        // the scene was available; rebuild once now that we have a scene.
        rebuildCloudDebugMeshes();
    }

    if (DEBUG_HEIGHTS) {
        // Small 9×9 grid of vertical posts showing the authoritative ground height.
        const half = 4;
        const step = 1.0;
        const count = (half * 2 + 1) ** 2;
        const positions: number[] = [];
        const colors: number[] = [];
        const color = new THREE.Color();

        for (let ix = -half; ix <= half; ix++) {
            for (let iz = -half; iz <= half; iz++) {
                const x = ix * step;
                const z = iz * step;
                positions.push(x, 0, z, x, 1, z);
                const isCenter = ix === 0 && iz === 0;
                color.set(isCenter ? _yellow : _white);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        _gridLines = new THREE.LineSegments(
            geo,
            new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })
        );
        _gridLines.renderOrder = 9999;
        _gridLines.frustumCulled = false;
        scene.add(_gridLines);

        // Ground-height boxes: one instanced mesh updated each frame.
        const boxGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        const boxMat = new THREE.MeshBasicMaterial({ color: _white, depthTest: false });
        _gridBoxes = new THREE.InstancedMesh(boxGeo, boxMat, count);
        _gridBoxes.renderOrder = 9999;
        _gridBoxes.frustumCulled = false;
        _gridBoxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(_gridBoxes);

        // Base-contact rings for every planted instance captured during world gen.
        const ringCount = Math.min(_plantedInstances.length, 4096);
        if (ringCount > 0) {
            const ringGeo = new THREE.RingGeometry(0.12, 0.16, 16);
            ringGeo.rotateX(-Math.PI / 2);
            const ringMat = new THREE.MeshBasicMaterial({
                color: _green,
                transparent: true,
                opacity: 0.6,
                depthTest: false,
                side: THREE.DoubleSide,
            });
            _plantedRings = new THREE.InstancedMesh(ringGeo, ringMat, ringCount);
            _plantedRings.renderOrder = 9999;
            _plantedRings.frustumCulled = false;

            const dummy = new THREE.Object3D();
            for (let i = 0; i < ringCount; i++) {
                const p = _plantedInstances[i];
                dummy.position.set(p.x, p.y + 0.02, p.z);
                dummy.updateMatrix();
                _plantedRings.setMatrixAt(i, dummy.matrix);
            }
            _plantedRings.instanceMatrix.needsUpdate = true;
            scene.add(_plantedRings);
        }

        // Nearest-wide-prop overlay: larger base ring, footprint ring, normal arrow.
        const baseRingGeo = new THREE.RingGeometry(0.25, 0.30, 24);
        baseRingGeo.rotateX(-Math.PI / 2);
        _nearestBaseRing = new THREE.Mesh(
            baseRingGeo,
            new THREE.MeshBasicMaterial({ color: _magenta, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide })
        );
        _nearestBaseRing.renderOrder = 9999;
        _nearestBaseRing.visible = false;
        scene.add(_nearestBaseRing);

        _nearestFootprintRing = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 0.95, 32),
            new THREE.MeshBasicMaterial({ color: _cyan, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide })
        );
        _nearestFootprintRing.geometry.rotateX(-Math.PI / 2);
        _nearestFootprintRing.renderOrder = 9999;
        _nearestFootprintRing.visible = false;
        scene.add(_nearestFootprintRing);

        const arrowGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
        _nearestNormalArrow = new THREE.Line(
            arrowGeo,
            new THREE.LineBasicMaterial({ color: _yellow, depthTest: false })
        );
        _nearestNormalArrow.renderOrder = 9999;
        _nearestNormalArrow.frustumCulled = false;
        _nearestNormalArrow.visible = false;
        scene.add(_nearestNormalArrow);
    }
}

/**
 * Register a planted instance so `?debugHeights=1` can draw its base-contact ring.
 * Called from `plantOnSurface`; no-op when the debug flag is absent.
 */
export function registerPlantedInstance(
    x: number,
    y: number,
    z: number,
    type?: string,
    footprintRadius?: number,
    normal?: THREE.Vector3
): void {
    if (!DEBUG_HEIGHTS) return;
    _plantedInstances.push({ x, y, z, type, footprintRadius, normal: normal?.clone() });
}

// ---------------------------------------------------------------------------
// Cloud platform visualization (#1266)
// ---------------------------------------------------------------------------

function getCloudPlatformId(cloud: THREE.Object3D): string {
    return typeof cloud.userData.persistentId === 'string'
        ? `cloud:${cloud.userData.persistentId}`
        : typeof cloud.userData.mapEntityId === 'string'
            ? `cloud:${cloud.userData.mapEntityId}`
            : `cloud:${cloud.position.x.toFixed(1)}_${cloud.position.z.toFixed(1)}_${cloud.position.y.toFixed(1)}`;
}

function computeCloudPlatformBounds(cloud: THREE.Object3D): Pick<CloudPlatformEntry, 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'topY'> {
    const scale = cloud.scale;
    const sizeMul = typeof cloud.userData.cloudScale === 'number' ? cloud.userData.cloudScale : 1.0;
    const halfX = 3.5 * scale.x * sizeMul * 0.5;
    const halfZ = 3.5 * scale.z * sizeMul * 0.5;
    const topY = cloud.position.y + scale.y * sizeMul * 0.35;
    return {
        minX: cloud.position.x - halfX,
        maxX: cloud.position.x + halfX,
        minZ: cloud.position.z - halfZ,
        maxZ: cloud.position.z + halfZ,
        topY,
    };
}

function rebuildCloudDebugMeshes(): void {
    if (!_scene) return;

    if (_cloudSurfaces) {
        _scene.remove(_cloudSurfaces);
        _cloudSurfaces.dispose();
        _cloudSurfaces = null;
    }
    if (_cloudOutlines) {
        _scene.remove(_cloudOutlines);
        _cloudOutlines.geometry.dispose();
        (_cloudOutlines.material as THREE.Material).dispose();
        _cloudOutlines = null;
    }

    const count = _cloudPlatforms.length;
    if (count === 0) return;

    const surfaceGeo = new THREE.BoxGeometry(1, 0.04, 1);
    const surfaceMat = new THREE.MeshBasicMaterial({
        color: _cyan,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    _cloudSurfaces = new THREE.InstancedMesh(surfaceGeo, surfaceMat, count);
    _cloudSurfaces.renderOrder = 9998;
    _cloudSurfaces.frustumCulled = false;

    const outlinePositions: number[] = [];
    const outlineColors: number[] = [];
    const color = new THREE.Color();

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        const p = _cloudPlatforms[i];
        const width = p.maxX - p.minX;
        const depth = p.maxZ - p.minZ;

        dummy.position.set((p.minX + p.maxX) * 0.5, p.topY, (p.minZ + p.maxZ) * 0.5);
        dummy.scale.set(width, 1, depth);
        dummy.updateMatrix();
        _cloudSurfaces.setMatrixAt(i, dummy.matrix);
        _cloudSurfaces.setColorAt(i, p.color);

        // Wireframe rectangle at the walkable surface.
        const y = p.topY;
        const corners = [
            [p.minX, y, p.minZ],
            [p.maxX, y, p.minZ],
            [p.maxX, y, p.maxZ],
            [p.minX, y, p.maxZ],
            [p.minX, y, p.minZ],
        ];
        color.copy(p.color);
        for (let c = 0; c < corners.length - 1; c++) {
            outlinePositions.push(corners[c][0], corners[c][1], corners[c][2]);
            outlinePositions.push(corners[c + 1][0], corners[c + 1][1], corners[c + 1][2]);
            outlineColors.push(color.r, color.g, color.b);
            outlineColors.push(color.r, color.g, color.b);
        }
    }

    _cloudSurfaces.instanceMatrix.needsUpdate = true;
    if (_cloudSurfaces.instanceColor) _cloudSurfaces.instanceColor.needsUpdate = true;
    _scene.add(_cloudSurfaces);

    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
    outlineGeo.setAttribute('color', new THREE.Float32BufferAttribute(outlineColors, 3));
    _cloudOutlines = new THREE.LineSegments(
        outlineGeo,
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })
    );
    _cloudOutlines.renderOrder = 9999;
    _cloudOutlines.frustumCulled = false;
    _scene.add(_cloudOutlines);
}

/**
 * Register a walkable cloud platform for debug visualization.
 * Mirrors the bounds math in `src/systems/ground-system.ts` so the drawn box
 * exactly matches the authoritative walkable surface.
 */
export function registerCloudPlatform(cloud: THREE.Object3D): void {
    if (!DEBUG_CLOUDS) return;
    if (!cloud.userData.isWalkable) return;

    const id = getCloudPlatformId(cloud);
    const existing = _cloudPlatforms.findIndex(p => p.id === id);
    const color = cloud.userData.devPlaced ? _magenta : _cyan;
    const entry: CloudPlatformEntry = { id, color, ...computeCloudPlatformBounds(cloud) };

    if (existing >= 0) {
        _cloudPlatforms[existing] = entry;
    } else {
        _cloudPlatforms.push(entry);
    }

    rebuildCloudDebugMeshes();
}

/** Remove a cloud platform from the debug overlay. */
export function unregisterCloudPlatform(cloud: THREE.Object3D): void {
    if (!DEBUG_CLOUDS) return;
    const id = getCloudPlatformId(cloud);
    const idx = _cloudPlatforms.findIndex(p => p.id === id);
    if (idx >= 0) {
        _cloudPlatforms.splice(idx, 1);
        rebuildCloudDebugMeshes();
    }
}

const _dummy = new THREE.Object3D();

/**
 * Update debug visuals. Should be called once per frame from the game loop.
 * @param playerPos — authoritative player position (eye height)
 * @param cameraPos — actual camera position (may lag due to ground-follow lerp)
 */
export function updateGroundDebug(playerPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    if (!_enabled || !_scene) return;

    if (DEBUG_PLAYER && _playerMesh && _groundMesh && _eyeLine) {
        const groundY = getGroundHeight(playerPos.x, playerPos.z);
        const eyeY = getEyeTargetY(playerPos.x, playerPos.z);
        const deltaEye = playerPos.y - eyeY;
        const deltaCam = cameraPos.y - eyeY;

        const metrics = {
            groundY: Number(groundY.toFixed(3)),
            eyeTargetY: Number(eyeY.toFixed(3)),
            playerY: Number(playerPos.y.toFixed(3)),
            cameraY: Number(cameraPos.y.toFixed(3)),
            playerAboveEye: Number(deltaEye.toFixed(3)),
            cameraAboveEye: Number(deltaCam.toFixed(3)),
            eyeHeight: CONFIG.player.eyeHeight,
        };
        (window as any).__groundMetrics = metrics;

        if (_metricsEl) {
            _metricsEl.textContent = [
                `ground ${metrics.groundY}`,
                `eye→${metrics.eyeTargetY}`,
                `player ${metrics.playerY} (Δ${metrics.playerAboveEye})`,
                `camera ${metrics.cameraY} (Δ${metrics.cameraAboveEye})`,
            ].join(' | ');
        }

        const now = performance.now();
        if (now - _lastMetricsLog > 2000) {
            _lastMetricsLog = now;
        }

        _playerMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
        _groundMesh.position.set(playerPos.x, groundY, playerPos.z);

        const positions = (_eyeLine.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        positions[0] = playerPos.x;
        positions[1] = eyeY;
        positions[2] = playerPos.z;
        positions[3] = playerPos.x;
        positions[4] = cameraPos.y;
        positions[5] = playerPos.z;
        _eyeLine.geometry.attributes.position.needsUpdate = true;
    }

    if (DEBUG_HEIGHTS && _gridBoxes && _gridLines) {
        const half = 4;
        const step = 1.0;
        let idx = 0;
        const positions = (_gridLines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

        for (let ix = -half; ix <= half; ix++) {
            for (let iz = -half; iz <= half; iz++) {
                const x = playerPos.x + ix * step;
                const z = playerPos.z + iz * step;
                const groundY = getGroundHeight(x, z);

                // Update vertical post endpoints.
                const base = idx * 6;
                positions[base] = x;
                positions[base + 1] = groundY;
                positions[base + 2] = z;
                positions[base + 3] = x;
                positions[base + 4] = groundY + 0.5;
                positions[base + 5] = z;

                // Update box at the ground surface.
                _dummy.position.set(x, groundY, z);
                _dummy.updateMatrix();
                _gridBoxes.setMatrixAt(idx, _dummy.matrix);
                idx++;
            }
        }

        _gridLines.geometry.attributes.position.needsUpdate = true;
        _gridBoxes.instanceMatrix.needsUpdate = true;

        // Update nearest-wide-prop debug overlay.
        if (_nearestBaseRing && _nearestFootprintRing && _nearestNormalArrow) {
            let nearest: PlantedInstance | null = null;
            let nearestDist = Number.POSITIVE_INFINITY;
            for (const p of _plantedInstances) {
                if (!p.footprintRadius) continue;
                const dx = p.x - playerPos.x;
                const dz = p.z - playerPos.z;
                const d = dx * dx + dz * dz;
                if (d < nearestDist) {
                    nearestDist = d;
                    nearest = p;
                }
            }

            if (nearest && nearest.normal) {
                _nearestBaseRing.visible = true;
                _nearestFootprintRing.visible = true;
                _nearestNormalArrow.visible = true;

                _nearestBaseRing.position.set(nearest.x, nearest.y + 0.03, nearest.z);
                _nearestFootprintRing.position.set(nearest.x, nearest.y + 0.01, nearest.z);
                _nearestFootprintRing.scale.setScalar(nearest.footprintRadius!);

                const arrowLen = 1.2;
                const positions = (_nearestNormalArrow.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
                positions[0] = nearest.x;
                positions[1] = nearest.y + 0.05;
                positions[2] = nearest.z;
                positions[3] = nearest.x + nearest.normal.x * arrowLen;
                positions[4] = nearest.y + 0.05 + nearest.normal.y * arrowLen;
                positions[5] = nearest.z + nearest.normal.z * arrowLen;
                _nearestNormalArrow.geometry.attributes.position.needsUpdate = true;
            } else {
                _nearestBaseRing.visible = false;
                _nearestFootprintRing.visible = false;
                _nearestNormalArrow.visible = false;
            }
        }
    }
}

/** Whether any ground-debug overlay is active this session. */
export function isGroundDebugEnabled(): boolean {
    return _enabled;
}

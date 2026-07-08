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
import { sampleGroundNormal } from '../world/placement-utils.ts';
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

let _enabled = DEBUG_HEIGHTS || DEBUG_PLAYER;

let _scene: THREE.Scene | null = null;
let _playerMesh: THREE.Mesh | null = null;
let _groundMesh: THREE.Mesh | null = null;
let _eyeLine: THREE.Line | null = null;
let _gridLines: THREE.LineSegments | null = null;
let _gridBoxes: THREE.InstancedMesh | null = null;
let _footprintRings: THREE.InstancedMesh | null = null;

const _white = new THREE.Color(0xffffff);
const _green = new THREE.Color(0x00ff00);
const _red = new THREE.Color(0xff0000);
const _yellow = new THREE.Color(0xffff00);

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

        const ringGeo = new THREE.RingGeometry(0.5, 0.55, 16);
        ringGeo.rotateX(-Math.PI / 2); // face upwards
        const ringMat = new THREE.MeshBasicMaterial({ color: _red, depthTest: false, side: THREE.DoubleSide });
        _footprintRings = new THREE.InstancedMesh(ringGeo, ringMat, count);
        _footprintRings.renderOrder = 9999;
        _footprintRings.frustumCulled = false;
        _footprintRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(_footprintRings);
    }
}

const _dummy = new THREE.Object3D();
const _upVector = new THREE.Vector3(0, 1, 0);

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
                const normal = sampleGroundNormal(x, z);

                // Update vertical post endpoints (draw normal arrows)
                const base = idx * 6;
                positions[base] = x;
                positions[base + 1] = groundY;
                positions[base + 2] = z;
                positions[base + 3] = x + normal.x * 0.5;
                positions[base + 4] = groundY + normal.y * 0.5;
                positions[base + 5] = z + normal.z * 0.5;

                // Update box at the ground surface.
                _dummy.position.set(x, groundY, z);
                _dummy.quaternion.identity();
                _dummy.updateMatrix();
                _gridBoxes.setMatrixAt(idx, _dummy.matrix);

                // Update footprint rings
                if (_footprintRings) {
                    _dummy.position.set(x, groundY + 0.02, z);
                    _dummy.quaternion.setFromUnitVectors(_upVector, normal);
                    _dummy.updateMatrix();
                    _footprintRings.setMatrixAt(idx, _dummy.matrix);
                }

                idx++;
            }
        }

        _gridLines.geometry.attributes.position.needsUpdate = true;
        _gridBoxes.instanceMatrix.needsUpdate = true;
        if (_footprintRings) _footprintRings.instanceMatrix.needsUpdate = true;
    }
}

/** Whether any ground-debug overlay is active this session. */
export function isGroundDebugEnabled(): boolean {
    return _enabled;
}

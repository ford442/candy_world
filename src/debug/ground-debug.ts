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
import { getGroundHeight } from '../systems/ground-system.ts';
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

const _white = new THREE.Color(0xffffff);
const _green = new THREE.Color(0x00ff00);
const _red = new THREE.Color(0xff0000);
const _yellow = new THREE.Color(0xffff00);

/** Initialize the debug overlay. Call once after the scene is available. */
export function initGroundDebug(scene: THREE.Scene): void {
    if (!_enabled) return;
    _scene = scene;

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
        const eyeY = groundY + CONFIG.player.eyeHeight;

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
    }
}

/** Whether any ground-debug overlay is active this session. */
export function isGroundDebugEnabled(): boolean {
    return _enabled;
}

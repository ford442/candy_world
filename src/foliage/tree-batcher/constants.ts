import * as THREE from 'three';
import { getCIAdjustedCount } from '../../core/config.ts';

export const _scratchTreeMatrix = new THREE.Matrix4();
export const _scratchTreeOriginalQuaternion = new THREE.Quaternion();
export const _scratchTreeFinalQuaternion = new THREE.Quaternion();

export const _defaultColorWhite = new THREE.Color(0xffffff);
export const _defaultColorOrange = new THREE.Color(0xff4500);
export const _defaultColorGreen = new THREE.Color(0x00fa9a);

/**
 * Slots per tree mesh. The meshes used to start at 100 and double up to this
 * cap; they are now allocated at it once (#2166), so a spawn past it is
 * dropped by add() returning null, as it was by the old cap.
 */
export const MAX_INSTANCES = getCIAdjustedCount(500, 0.1, 50);

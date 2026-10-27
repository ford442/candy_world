/**
 * @file src/systems/authoring/placement-core.ts
 * @brief The one placement pipeline: view ray → grounded transform → snapshot.
 *
 * Build mode and the `?debugPlace` dev overlay both plant their ghost through
 * this module, which calls the same `plantOnSurface` that `processMapEntity`
 * runs (base offset, footprint sampling, slope alignment). So the ghost shows
 * where a commit lands, and turns red when that placement would be
 * tilt-clamped or leave its base clipping uneven ground.
 */

import * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import type { CandyMapEntity } from '../../world/map-loader.ts';
import {
    SLOPE_ALIGN_TYPES,
    getEntityFootprintRadius,
    getFootprintSamples,
    getGroundAlignedQuaternion,
    getMaxSlopeAngle,
    plantOnSurface,
    sampleGroundY,
} from '../../world/placement-utils.ts';
import { CURRENT_SNAPSHOT_VERSION, type EntitySnapshot } from '../entity-snapshot-core.ts';
import {
    getGroundHeight,
    getRawTerrainHeight,
    isInLakeBasin,
    sampleGroundFootprint,
    sampleGroundNormal,
} from '../ground-system.ts';

// Clouds are forced to absolute placement and sky islands float at authored
// heights, so a ground-hugging ghost can't represent either.
export const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['cloud', 'sky_island']);

/** processMapEntity lifts these above the sampled ground before planting (default params). */
export const PRE_PLANT_Y: Readonly<Record<string, number>> = {
    floating_orb: 1.5,
    swingable_vine: 8,
    wisteria_cluster: 4,
};

export const RAY_MAX = 120;
const RAY_STEP = 0.5;
/** Ground height difference under the base above which part of it floats or sinks. */
export const MAX_FOOTPRINT_SPREAD = 0.25;
/** Diagnostic footprint for types the pipeline samples at a single point. */
export const DIAGNOSTIC_FOOTPRINT = 0.3;
/** How close (XZ) the cursor must be to an entity to target it. */
export const HOVER_RADIUS = 2.5;

export const STATUS_COLORS = { ok: 0x4ade80, warn: 0xfbbf24, bad: 0xf87171 } as const;
export type PlacementStatus = keyof typeof STATUS_COLORS;

export interface PlacementState {
    hit: boolean;
    x: number;
    y: number;
    z: number;
    quat: THREE.Quaternion;
    footprint: number;
    onPlatform: boolean;
    status: PlacementStatus;
    reason: string;
}

export function createPlacementState(): PlacementState {
    return {
        hit: false,
        x: 0,
        y: 0,
        z: 0,
        quat: new THREE.Quaternion(),
        footprint: DIAGNOSTIC_FOOTPRINT,
        onPlatform: false,
        status: 'bad',
        reason: 'waiting for first frame',
    };
}

const _up = new THREE.Vector3(0, 1, 0);
const _yawQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _proxy = new THREE.Object3D();

export function round(v: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

/**
 * March the view ray against the unified ground (terrain, lake, platforms),
 * then bisect the crossing. Writes the hit's X/Z into `out`.
 */
export function raycastGround(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    out: THREE.Vector3
): boolean {
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

function setStatus(s: PlacementState, status: PlacementStatus, reason: string): void {
    s.status = status;
    s.reason = reason;
}

/** Plant a proxy exactly as processMapEntity would at (x, z), then judge the result. */
export function evaluatePlacement(
    s: PlacementState,
    type: string,
    x: number,
    z: number,
    yaw: number
): void {
    const groundY = sampleGroundY(x, z);

    _proxy.userData = {};
    _proxy.quaternion.setFromAxisAngle(_up, yaw);
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
        setStatus(s, 'bad', `slope ${deg}° > ${maxDeg}°, ${effect}`);
    } else if (spread > MAX_FOOTPRINT_SPREAD) {
        setStatus(s, 'bad', `uneven base: ${spread.toFixed(2)} m under footprint`);
    } else if (s.onPlatform) {
        setStatus(s, 'warn', 'on platform: saved at absolute Y, may drift');
    } else if (isInLakeBasin(x, z)) {
        setStatus(s, 'warn', 'lake basin: underwater');
    } else {
        setStatus(s, 'ok', 'grounded');
    }
}

export interface SnapshotSpec {
    type: string;
    yaw: number;
    scale: number;
    /** A moved entity's record: its other fields (variant, music, params) carry over. */
    base?: CandyMapEntity;
    /** Extra map-record fields for a new entity (palette defaults). */
    extra?: Partial<CandyMapEntity>;
}

/** Snapshot of the planted transform in `s`. */
export function buildPlacementSnapshot(
    id: string,
    s: PlacementState,
    spec: SnapshotSpec
): EntitySnapshot {
    const q = _yawQuat.setFromAxisAngle(_up, spec.yaw);
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: {
            ...(spec.base ?? { params: {}, ...spec.extra }),
            id,
            type: spec.base?.type ?? spec.type,
            position: [round(s.x), round(s.y), round(s.z)],
            rotation: { quat: [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)] },
            scale: round(spec.scale),
            // processMapEntity re-grounds 'ground' records at load; a platform
            // may not be registered yet then, so keep the planted Y instead.
            placement: s.onPlatform ? 'absolute' : 'ground',
        },
    };
}

/** Yaw (radians) of a map record's rotation. */
export function yawOf(rotation: CandyMapEntity['rotation']): number {
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

// ---------------------------------------------------------------------------
// Ghost visuals
// ---------------------------------------------------------------------------

export interface PlacementGhost {
    readonly group: THREE.Group;
    readonly hoverMarker: THREE.Mesh;
    update(s: PlacementState, scale: number, target: readonly number[] | null): void;
    setVisible(visible: boolean): void;
    dispose(): void;
}

/** Wireframe footprint cylinder + a ring marking the targeted entity. */
export function createPlacementGhost(scene: THREE.Scene): PlacementGhost {
    const mat = new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.ok,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
    });
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    bodyGeo.translate(0, 0.5, 0);
    const body = new THREE.Mesh(bodyGeo, mat);
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, mat);
    body.add(ring);
    body.renderOrder = ring.renderOrder = 9999;

    const group = new THREE.Group();
    group.name = 'placement-ghost';
    group.add(body);
    group.visible = false;
    scene.add(group);

    const hoverGeo = new THREE.RingGeometry(1.2, 1.4, 32);
    hoverGeo.rotateX(-Math.PI / 2);
    const hoverMat = new THREE.MeshBasicMaterial({
        color: 0xfb923c,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
    });
    const hoverMarker = new THREE.Mesh(hoverGeo, hoverMat);
    hoverMarker.name = 'placement-target';
    hoverMarker.renderOrder = 9999;
    hoverMarker.visible = false;
    scene.add(hoverMarker);

    let shown = true;
    return {
        group,
        hoverMarker,
        update(s, scale, target) {
            group.visible = shown && s.hit;
            mat.color.setHex(STATUS_COLORS[s.status]);
            if (s.hit) {
                group.position.set(s.x, s.y, s.z);
                group.quaternion.copy(s.quat);
                body.scale.set(s.footprint, 1.5 * scale, s.footprint);
            }
            hoverMarker.visible = shown && !!target;
            if (target) hoverMarker.position.set(target[0], target[1] + 0.05, target[2]);
        },
        setVisible(visible) {
            shown = visible;
            if (!visible) {
                group.visible = false;
                hoverMarker.visible = false;
            }
        },
        dispose() {
            scene.remove(group);
            scene.remove(hoverMarker);
            bodyGeo.dispose();
            ringGeo.dispose();
            hoverGeo.dispose();
            mat.dispose();
            hoverMat.dispose();
        },
    };
}

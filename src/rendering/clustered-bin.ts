/**
 * CPU cluster binning for Forward+ local lights (v1).
 *
 * Compute-pass binning is deferred: the 16×8×16 grid is cheap enough to fill
 * on the CPU for ≤128 lights, and a GPU bin would be another compute dispatch
 * on the shared device. See docs/CLUSTERED_LIGHTS.md.
 */
import * as THREE from 'three';

export const CLUSTER_GRID_X = 16;
export const CLUSTER_GRID_Y = 8;
export const CLUSTER_GRID_Z = 16;
/** pos.xyz + radius, color.rgb + intensity, dir.xyz + coneCos */
export const LIGHT_FLOATS = 12;

const _p = new THREE.Vector3();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

export function clusterStride(maxLightsPerCluster: number): number {
    return 1 + Math.max(1, maxLightsPerCluster);
}

export function clusterCount(
    gridX = CLUSTER_GRID_X,
    gridY = CLUSTER_GRID_Y,
    gridZ = CLUSTER_GRID_Z
): number {
    return gridX * gridY * gridZ;
}

export function packLight(
    data: Float32Array,
    index: number,
    pos: THREE.Vector3,
    radius: number,
    colorHex: number,
    intensity: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    coneCos: number
): void {
    const offset = index * LIGHT_FLOATS;
    data[offset + 0] = pos.x;
    data[offset + 1] = pos.y;
    data[offset + 2] = pos.z;
    data[offset + 3] = radius;
    data[offset + 4] = ((colorHex >> 16) & 255) / 255;
    data[offset + 5] = ((colorHex >> 8) & 255) / 255;
    data[offset + 6] = (colorHex & 255) / 255;
    data[offset + 7] = intensity;
    data[offset + 8] = dirX;
    data[offset + 9] = dirY;
    data[offset + 10] = dirZ;
    data[offset + 11] = coneCos;
}

export function resetClusterCounts(
    clusterData: Uint32Array,
    numClusters: number,
    stride: number
): void {
    for (let i = 0; i < numClusters; i++) {
        clusterData[i * stride] = 0;
    }
}

/**
 * Conservatively bin a view-space bounding sphere into the 3D cluster grid.
 * Returns how many clusters received the light (0 if outside the camera far/near).
 */
export function binLightViewSphere(
    clusterData: Uint32Array,
    lightIndex: number,
    viewPos: THREE.Vector3,
    radius: number,
    near: number,
    far: number,
    projectionMatrix: THREE.Matrix4,
    gridX: number,
    gridY: number,
    gridZ: number,
    maxLightsPerCluster: number
): number {
    const stride = clusterStride(maxLightsPerCluster);
    const scaleZ = gridZ / Math.log(far / near);

    const minZ = -(viewPos.z + radius);
    const maxZ = -(viewPos.z - radius);
    if (maxZ < near || minZ > far) return 0;

    const sliceMin = Math.max(
        0,
        Math.min(gridZ - 1, Math.floor(Math.log(Math.max(near, minZ) / near) * scaleZ))
    );
    const sliceMax = Math.max(
        0,
        Math.min(gridZ - 1, Math.floor(Math.log(Math.max(near, maxZ) / near) * scaleZ))
    );

    let minX = 1;
    let minY = 1;
    let maxX = -1;
    let maxY = -1;

    _corners[0].set(viewPos.x - radius, viewPos.y - radius, viewPos.z + radius);
    _corners[1].set(viewPos.x + radius, viewPos.y - radius, viewPos.z + radius);
    _corners[2].set(viewPos.x - radius, viewPos.y + radius, viewPos.z + radius);
    _corners[3].set(viewPos.x + radius, viewPos.y + radius, viewPos.z + radius);
    _corners[4].set(viewPos.x - radius, viewPos.y - radius, viewPos.z - radius);
    _corners[5].set(viewPos.x + radius, viewPos.y - radius, viewPos.z - radius);
    _corners[6].set(viewPos.x - radius, viewPos.y + radius, viewPos.z - radius);
    _corners[7].set(viewPos.x + radius, viewPos.y + radius, viewPos.z - radius);

    for (let c = 0; c < 8; c++) {
        const corner = _corners[c];
        if (corner.z > 0) corner.z = -0.001;
        _p.copy(corner).applyMatrix4(projectionMatrix);
        minX = Math.min(minX, _p.x);
        minY = Math.min(minY, _p.y);
        maxX = Math.max(maxX, _p.x);
        maxY = Math.max(maxY, _p.y);
    }

    const tMinX = Math.max(0, Math.min(gridX - 1, Math.floor((minX * 0.5 + 0.5) * gridX)));
    const tMinY = Math.max(0, Math.min(gridY - 1, Math.floor((minY * 0.5 + 0.5) * gridY)));
    const tMaxX = Math.max(0, Math.min(gridX - 1, Math.floor((maxX * 0.5 + 0.5) * gridX)));
    const tMaxY = Math.max(0, Math.min(gridY - 1, Math.floor((maxY * 0.5 + 0.5) * gridY)));

    let written = 0;
    for (let z = sliceMin; z <= sliceMax; z++) {
        for (let y = tMinY; y <= tMaxY; y++) {
            for (let x = tMinX; x <= tMaxX; x++) {
                const clusterIdx = z * (gridX * gridY) + y * gridX + x;
                const cOffset = clusterIdx * stride;
                const count = clusterData[cOffset];
                if (count < maxLightsPerCluster) {
                    clusterData[cOffset + 1 + count] = lightIndex;
                    clusterData[cOffset] = count + 1;
                    written += 1;
                }
            }
        }
    }
    return written;
}

/** CPU bin budget for the profiler mark `ClusteredLighting` (ms). */
export const CLUSTER_BIN_BUDGET_MS_32 = 2.0;
export const CLUSTER_BIN_BUDGET_MS_128 = 6.0;

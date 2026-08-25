/**
 * CPU clustered-light packing / binning (no GPU).
 * Run: npm run test:clustered
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/core/config/defaults.ts';
import {
    CLUSTER_BIN_BUDGET_MS_32,
    CLUSTER_BIN_BUDGET_MS_128,
    CLUSTER_GRID_X,
    CLUSTER_GRID_Y,
    CLUSTER_GRID_Z,
    LIGHT_FLOATS,
    binLightViewSphere,
    clusterCount,
    clusterStride,
    packLight,
    resetClusterCounts,
} from '../src/rendering/clustered-bin.ts';
import {
    createPointLight,
    muteAnalyticLocalLights,
    registerDecorativeFill,
    __bindLocalLightsForTests,
    __resetLocalLightsForTests,
} from '../src/rendering/lights.ts';

{
    assert.equal(CONFIG.lighting.maxClusterLights, 128);
    assert.equal(CONFIG.lighting.maxLightsPerCluster, 32);
    assert.equal(CLUSTER_BIN_BUDGET_MS_32, 2);
    assert.equal(CLUSTER_BIN_BUDGET_MS_128, 6);
    assert.equal(LIGHT_FLOATS, 12);
}

{
    const data = new Float32Array(LIGHT_FLOATS);
    const pos = new THREE.Vector3(1, 2, 3);
    packLight(data, 0, pos, 12, 0xff69b4, 4.5, 0, 1, 0, -1);
    assert.equal(data[0], 1);
    assert.equal(data[1], 2);
    assert.equal(data[2], 3);
    assert.equal(data[3], 12);
    assert.ok(Math.abs(data[4] - 1) < 1e-6);
    assert.ok(Math.abs(data[5] - 0x69 / 255) < 1e-6);
    assert.ok(Math.abs(data[6] - 0xb4 / 255) < 1e-6);
    assert.equal(data[7], 4.5);
    assert.equal(data[8], 0);
    assert.equal(data[9], 1);
    assert.equal(data[10], 0);
    assert.equal(data[11], -1);
}

function makeProj() {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.5, 100);
    cam.updateProjectionMatrix();
    return cam.projectionMatrix;
}

{
    const maxPer = 8;
    const stride = clusterStride(maxPer);
    const data = new Uint32Array(clusterCount() * stride);
    resetClusterCounts(data, clusterCount(), stride);
    const viewPos = new THREE.Vector3(0, 0, -8);
    const written = binLightViewSphere(
        data,
        0,
        viewPos,
        3,
        0.5,
        100,
        makeProj(),
        CLUSTER_GRID_X,
        CLUSTER_GRID_Y,
        CLUSTER_GRID_Z,
        maxPer
    );
    assert.ok(written > 0, 'in-frustum sphere bins at least one cluster');
    let counted = 0;
    for (let i = 0; i < clusterCount(); i++) counted += data[i * stride];
    assert.equal(counted, written);
}

{
    const maxPer = 8;
    const stride = clusterStride(maxPer);
    const data = new Uint32Array(clusterCount() * stride);
    resetClusterCounts(data, clusterCount(), stride);
    const behind = new THREE.Vector3(0, 0, 12);
    const written = binLightViewSphere(
        data,
        0,
        behind,
        1,
        0.5,
        100,
        makeProj(),
        CLUSTER_GRID_X,
        CLUSTER_GRID_Y,
        CLUSTER_GRID_Z,
        maxPer
    );
    assert.equal(written, 0, 'behind-camera sphere is skipped');
}

{
    const maxPer = 2;
    const stride = clusterStride(maxPer);
    const data = new Uint32Array(clusterCount() * stride);
    resetClusterCounts(data, clusterCount(), stride);
    const viewPos = new THREE.Vector3(0, 0, -8);
    const proj = makeProj();
    for (let i = 0; i < 6; i++) {
        binLightViewSphere(
            data,
            i,
            viewPos,
            4,
            0.5,
            100,
            proj,
            CLUSTER_GRID_X,
            CLUSTER_GRID_Y,
            CLUSTER_GRID_Z,
            maxPer
        );
    }
    for (let i = 0; i < clusterCount(); i++) {
        assert.ok(data[i * stride] <= maxPer, 'maxLightsPerCluster cap');
    }
}

{
    __resetLocalLightsForTests();
    const scene = new THREE.Scene();
    __bindLocalLightsForTests(scene, false, false);
    const h = createPointLight({ parent: scene, intensity: 7 });
    assert.ok(h && h.light);
    assert.equal(h.light.intensity, 7);
    muteAnalyticLocalLights(true);
    assert.equal(h.light.intensity, 0, 'muted analytic contribution');
    muteAnalyticLocalLights(false);
    assert.equal(h.light.intensity, 7, 'restore authored intensity');
    const d = registerDecorativeFill({ parent: scene, intensity: 2, distance: 4 });
    assert.ok(d && !d.gpu);
    __resetLocalLightsForTests();
}

{
    const maxPer = CONFIG.lighting.maxLightsPerCluster;
    const stride = clusterStride(maxPer);
    const clusterData = new Uint32Array(clusterCount() * stride);
    const lightData = new Float32Array(32 * LIGHT_FLOATS);
    const proj = makeProj();
    const t0 = performance.now();
    resetClusterCounts(clusterData, clusterCount(), stride);
    for (let i = 0; i < 32; i++) {
        const pos = new THREE.Vector3((i % 8) - 4, 0, -6 - (i % 5));
        packLight(lightData, i, pos, 8, 0xff69b4, 2, 0, -1, 0, -1);
        binLightViewSphere(
            clusterData,
            i,
            pos,
            8,
            0.5,
            100,
            proj,
            CLUSTER_GRID_X,
            CLUSTER_GRID_Y,
            CLUSTER_GRID_Z,
            maxPer
        );
    }
    const ms = performance.now() - t0;
    assert.ok(
        ms < 50,
        `32-light CPU pack+bin should stay well under desktop 2ms budget; got ${ms.toFixed(2)}ms (CI ceiling 50ms)`
    );
    console.log(`32-light pack+bin: ${ms.toFixed(3)}ms (desktop budget ${CLUSTER_BIN_BUDGET_MS_32}ms)`);
}

console.log('clustered-lights tests passed');

/**
 * Visual terrain mesh sized to the active boot path.
 * Play starts at ~180×180; Explore keeps the full 400×400 mesh. Play expands
 * to Explore size in the background before the player reaches the Play edge.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { getStartupCapabilities } from '../core/startup/capabilities.ts';
import { createTerrainMaterial } from '../foliage/index.ts';
import { yieldControl } from './generation-utils.ts';
import { generateGroundHeightmap } from './ground-heightmap.ts';
import { sampleGroundY } from './placement-utils.ts';
import {
    EXPLORE_WORLD_SIZE,
    PLAY_WORLD_HALF,
    TERRAIN_EXPAND_MARGIN_M,
    worldExtentForPath,
} from './world-extent.ts';

let activeGround: THREE.Mesh | null = null;
let activeTerrainSize = 0;
let expandInFlight = false;
let expandedToExplore = false;

export function getActiveTerrainSize(): number {
    return activeTerrainSize;
}

export function getActiveTerrainHalf(): number {
    return activeTerrainSize > 0 ? activeTerrainSize / 2 : PLAY_WORLD_HALF;
}

export function isTerrainExpandedToExplore(): boolean {
    return expandedToExplore;
}

export async function createPathTerrain(): Promise<THREE.Mesh> {
    const extent = getStartupCapabilities().world;
    const mesh = await buildTerrainMesh(extent.size, extent.heightmapResolution);
    activeGround = mesh;
    activeTerrainSize = extent.size;
    expandedToExplore = extent.size >= EXPLORE_WORLD_SIZE;
    publishTerrainFlag();
    return mesh;
}

async function buildTerrainMesh(size: number, resolution: number): Promise<THREE.Mesh> {
    const urlParams =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const forceGpuTerrain = urlParams?.has('gpuTerrain') ?? false;
    const useGpu = CONFIG.terrain?.useGpuHeightmap || forceGpuTerrain;

    let groundGeo: THREE.PlaneGeometry;
    let groundMat: THREE.Material;

    if (useGpu) {
        console.warn(`[World] GPU heightmap ${size}×${size} @ ${resolution}`);
        groundGeo = new THREE.PlaneGeometry(size, size, resolution, resolution);
        const startParams = performance.now();
        const { heightTexture, normalTexture } = await generateGroundHeightmap(size, resolution);
        console.warn(
            `[World] Generated heightmap in ${(performance.now() - startParams).toFixed(2)}ms`
        );
        groundMat = createTerrainMaterial(
            CONFIG.colors.ground,
            { roughness: 0.9, bumpStrength: 0.15, noiseScale: 20.0 },
            heightTexture,
            normalTexture
        );
    } else {
        console.warn(`[World] CPU vertex displacement ${size}×${size} @ ${resolution}`);
        groundGeo = new THREE.PlaneGeometry(size, size, resolution, resolution);
        const posAttribute = groundGeo.attributes.position;
        const vertexCount = posAttribute.count;
        const cpuYieldEvery = 2000;
        for (let i = 0; i < vertexCount; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const zWorld = -y;
            posAttribute.setZ(i, sampleGroundY(x, zWorld));
            if (i % cpuYieldEvery === cpuYieldEvery - 1) {
                await yieldControl();
            }
        }
        groundGeo.computeVertexNormals();
        groundMat = createTerrainMaterial(CONFIG.colors.ground, {
            roughness: 0.9,
            bumpStrength: 0.15,
            noiseScale: 20.0,
        });
    }

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.worldTerrainSize = size;
    return ground;
}

/**
 * If the player is approaching the Play mesh edge, start generating the
 * Explore-sized terrain. Safe to call every frame (no-ops unless needed).
 */
export function maybeExpandTerrain(playerX: number, playerZ: number, scene: THREE.Scene): void {
    if (expandedToExplore || expandInFlight || !activeGround) return;
    const path = getStartupCapabilities().path;
    if (path !== 'play') return;

    const half = getActiveTerrainHalf();
    const distToEdge = half - Math.max(Math.abs(playerX), Math.abs(playerZ));
    if (distToEdge > TERRAIN_EXPAND_MARGIN_M) return;

    expandInFlight = true;
    const explore = worldExtentForPath('explore');
    console.warn(
        `[World] Expanding terrain ${activeTerrainSize} → ${explore.size} (player ${playerX.toFixed(1)}, ${playerZ.toFixed(1)})`
    );
    void (async () => {
        try {
            const next = await buildTerrainMesh(explore.size, explore.heightmapResolution);
            next.position.copy(activeGround!.position);
            scene.add(next);
            scene.remove(activeGround!);
            disposeTerrainMesh(activeGround!);
            activeGround = next;
            activeTerrainSize = explore.size;
            expandedToExplore = true;
            publishTerrainFlag();
            console.warn('[World] Terrain expanded to Explore footprint');
        } catch (err) {
            console.warn('[World] Terrain expand failed:', err);
        } finally {
            expandInFlight = false;
        }
    })();
}

function disposeTerrainMesh(mesh: THREE.Mesh): void {
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
    } else if (mat) {
        mat.dispose();
    }
}

function publishTerrainFlag(): void {
    try {
        const prev = window.__streamingTelemetry ?? {
            spawnedCount: 0,
            spawnReadyCount: 0,
            worldSize: 0,
            loadRingChunks: 0,
            evictRingChunks: 0,
            lastStreamSpawnMs: 0,
            maxStreamSpawnMs: 0,
            hitchCount: 0,
            popEvents: 0,
            terrainExpanded: false,
        };
        window.__streamingTelemetry = {
            ...prev,
            terrainExpanded: expandedToExplore,
            worldSize: activeTerrainSize,
        };
    } catch {
        /* non-browser */
    }
}

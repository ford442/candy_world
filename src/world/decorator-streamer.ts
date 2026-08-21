/**
 * Procedural setpiece streaming — load biome sections when the player is
 * within a 50 m-class prefetch of their center, instead of dumping every
 * decorator on Enter. Explore still queues everything immediately.
 */
import { getStartupCapabilities } from '../core/startup/capabilities.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import type { WeatherSystem } from './generation-utils.ts';
import {
    CLOUD_ARCHIPELAGO,
    GEM_CANOPY,
    MYCELIUM_GROVE,
    SKY_ISLANDS,
    SUGAR_CAVES,
} from './generation-utils.ts';
import { STREAM_CELL_SIZE_M } from './world-extent.ts';

type DecoratorId =
    | 'procedural_extras'
    | 'gem_canopy'
    | 'mycelium_grove'
    | 'cloud_archipelago'
    | 'sky_islands'
    | 'sugar_caves';

interface DecoratorSection {
    id: DecoratorId;
    x: number;
    z: number;
    /** Start loading when the player is within this distance (metres). */
    prefetchM: number;
    /** Play path: spawn-adjacent sections load right after the spawn ring. */
    playImmediate?: boolean;
}

const SECTIONS: readonly DecoratorSection[] = [
    {
        id: 'sugar_caves',
        x: (SUGAR_CAVES.startX + SUGAR_CAVES.endX) / 2,
        z: (SUGAR_CAVES.startZ + SUGAR_CAVES.endZ) / 2,
        prefetchM: STREAM_CELL_SIZE_M * 2,
        playImmediate: true,
    },
    {
        id: 'mycelium_grove',
        x: MYCELIUM_GROVE.centerX,
        z: MYCELIUM_GROVE.centerZ,
        prefetchM: STREAM_CELL_SIZE_M * 2,
    },
    {
        id: 'gem_canopy',
        x: (GEM_CANOPY.startX + GEM_CANOPY.endX) / 2,
        z: (GEM_CANOPY.startZ + GEM_CANOPY.endZ) / 2,
        prefetchM: STREAM_CELL_SIZE_M * 2,
    },
    {
        id: 'sky_islands',
        x: SKY_ISLANDS.centerX,
        z: SKY_ISLANDS.centerZ,
        prefetchM: STREAM_CELL_SIZE_M * 2,
    },
    {
        id: 'cloud_archipelago',
        x: CLOUD_ARCHIPELAGO.startX,
        z: CLOUD_ARCHIPELAGO.startZ,
        prefetchM: STREAM_CELL_SIZE_M * 2,
    },
    {
        id: 'procedural_extras',
        x: 0,
        z: 0,
        prefetchM: STREAM_CELL_SIZE_M * 3,
        playImmediate: true,
    },
];

const queued = new Set<DecoratorId>();
let weatherRef: WeatherSystem | null = null;
let tokenRef = 0;
let chunkSizeRef = 100;
let extrasRange = 180;

export function resetDecoratorStreamer(): void {
    queued.clear();
    weatherRef = null;
}

export function initDecoratorStreamer(
    weatherSystem: WeatherSystem,
    generationToken: number,
    chunkSize: number,
    options?: { extrasRange?: number; eagerAll?: boolean }
): void {
    weatherRef = weatherSystem;
    tokenRef = generationToken;
    chunkSizeRef = chunkSize;
    extrasRange = options?.extrasRange ?? 180;
    queued.clear();

    if (options?.eagerAll) {
        for (const section of SECTIONS) enqueueSection(section);
        return;
    }

    for (const section of SECTIONS) {
        if (section.playImmediate) enqueueSection(section);
    }
}

export function updateDecoratorStreamer(playerX: number, playerZ: number): void {
    if (!weatherRef) return;
    if (getStartupCapabilities().path !== 'play') return;
    for (const section of SECTIONS) {
        if (queued.has(section.id)) continue;
        const dx = playerX - section.x;
        const dz = playerZ - section.z;
        if (dx * dx + dz * dz <= section.prefetchM * section.prefetchM) {
            enqueueSection(section);
        }
    }
}

function enqueueSection(section: DecoratorSection): void {
    if (queued.has(section.id) || !weatherRef) return;
    queued.add(section.id);
    const weatherSystem = weatherRef;
    const generationToken = tokenRef;
    const chunkSize = chunkSizeRef;
    const range = extrasRange;
    const priority = section.playImmediate ? 8 : 4;
    globalBackgroundProcessor.enqueue({
        id: `world_decorator_${section.id}`,
        priority,
        execute: async () => {
            const currentToken = window.__currentWorldGenerationToken ?? 0;
            if (
                generationToken !== -1 &&
                generationToken !== currentToken &&
                !window.__IS_FULL_BOOT_TEST
            ) {
                return;
            }
            const {
                populateProceduralExtras,
                populateGemCanopyCorridor,
                populateMyceliumGrove,
                populateCloudArchipelago,
                populateSkyIslands,
                populateSugarCaves,
            } = await import('./generation-decorators.ts');
            switch (section.id) {
                case 'procedural_extras':
                    await populateProceduralExtras(
                        weatherSystem,
                        generationToken,
                        chunkSize,
                        range
                    );
                    break;
                case 'gem_canopy':
                    await populateGemCanopyCorridor(weatherSystem);
                    break;
                case 'mycelium_grove':
                    await populateMyceliumGrove(weatherSystem);
                    break;
                case 'cloud_archipelago':
                    await populateCloudArchipelago(weatherSystem);
                    break;
                case 'sky_islands':
                    await populateSkyIslands(weatherSystem);
                    break;
                case 'sugar_caves':
                    await populateSugarCaves(weatherSystem);
                    {
                        const { installSugarCavesTraversal } =
                            await import('./sugar-caves-traversal.ts');
                        installSugarCavesTraversal();
                    }
                    break;
            }
        },
    });
}

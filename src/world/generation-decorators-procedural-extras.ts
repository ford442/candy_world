import * as THREE from 'three';
import { FEATURE_FLAGS } from '../core/config.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { sampleEntityScale, sampleEntityHeight } from './entity-scale.ts';
import { create } from './foliage-registry.ts';
import { worldGenerationToken } from './generation-core.ts';
import { safeAddFoliage } from './generation-entities.ts';
import {
    getProceduralEntityCount,
    DEFAULT_PROCEDURAL_CHUNK_SIZE,
    getEntityBudgetMs,
    WeatherSystem,
    yieldControl,
    isPositionValid,
    normalizeMapEntityType,
} from './generation-utils.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';

export async function populateProceduralExtras(
    weatherSystem: WeatherSystem,
    taskToken: number = -1,
    chunkSize: number = DEFAULT_PROCEDURAL_CHUNK_SIZE,
    scatterRange: number = 150
): Promise<void> {
    if (!FEATURE_FLAGS.proceduralExtras) {
        console.log('[World] Procedural extras skipped (no_procedural flag)');
        return;
    }
    console.log('[World] Populating procedural extras (Critical + Deferred)...');
    const extrasCount = getProceduralEntityCount();
    const range = scatterRange;

    // We no longer block the main thread for non-critical procedural objects.
    // Instead, we immediately calculate their positions and types.
    // If they are critical, we spawn them now.
    // If deferred, we collect them for near-first sorting before queuing.

    let criticalCount = 0;
    // Track elapsed time so we can yield after each critical spawn that hits the budget.
    let chunkStart = performance.now();

    // Collect deferred items with their squared distance from origin so we can
    // sort them nearest-first before handing them to the background processor.
    const deferredItems: Array<{ distSq: number; id: string; execute: () => void }> = [];

    for (let i = 0; i < extrasCount; i++) {
        let x = 0,
            z = 0;
        const y = 0;
        let attempts = 0;
        let validPosition = false;

        while (attempts < 10) {
            x = (Math.random() - 0.5) * range;
            z = (Math.random() - 0.5) * range;
            if (isPositionValid(x, z, 1.5)) {
                validPosition = true;
                break;
            }
            attempts++;
        }

        if (!validPosition) continue;
        const groundY = sampleGroundY(x, z);

        // Determine object type and criticality
        const rand = Math.random();

        // Define a closure to spawn this specific extra
        const spawnExtra = () => {
            let obj: THREE.Object3D | null = null;
            let isObstacle = false;
            let radius = 0.5;
            let currentY = groundY;
            let exportType: string | null = null;
            let exportVariant: string | undefined;
            let exportHasFace: boolean | undefined;
            const exportParams: Record<string, unknown> = {};

            try {
                if (rand < 0.3) {
                    if (Math.random() < 0.5) {
                        obj = create('flower');
                        exportType = 'flower';
                        exportVariant = 'simple';
                    } else {
                        obj = create('flower', { variant: 'glowing' });
                        exportType = 'flower';
                        exportVariant = 'glowing';
                    }
                    if (obj)
                        plantOnSurface(obj, x, z, {
                            groundY: currentY,
                            entityType: exportType ?? undefined,
                        });
                } else if (rand < 0.45) {
                    obj = create('mushroom', {
                        size: 'regular',
                        scale: sampleEntityScale('mushroom'),
                        hasFace: true,
                        isBouncy: true,
                    });
                    exportType = 'mushroom';
                    exportVariant = 'regular';
                    exportHasFace = true;
                    if (obj)
                        plantOnSurface(obj, x, z, {
                            groundY: currentY,
                            entityType: exportType ?? undefined,
                        });
                    isObstacle = true;
                } else if (rand < 0.55) {
                    const treeType = Math.random();
                    if (treeType < 0.33) {
                        obj = create('bubble_willow');
                        exportType = 'bubble_willow';
                    } else if (treeType < 0.66) {
                        obj = create('balloon_bush');
                        exportType = 'balloon_bush';
                    } else {
                        obj = create('helix_plant');
                        exportType = 'helix_plant';
                    }

                    if (obj)
                        plantOnSurface(obj, x, z, {
                            groundY: currentY,
                            entityType: exportType ?? undefined,
                        });
                    isObstacle = true;
                    radius = 1.5;
                } else if (rand < 0.75) {
                    if (FEATURE_FLAGS.musicalFlora) {
                        const type = Math.random();
                        if (type < 0.15) {
                            obj = create('arpeggio_fern', {
                                scale: sampleEntityScale('arpeggio_fern'),
                            });
                            exportType = 'arpeggio_fern';
                        } else if (type < 0.28) {
                            obj = create('kick_drum_geyser', {
                                maxHeight: sampleEntityHeight('kick_drum_geyser'),
                            });
                            exportType = 'kick_drum_geyser';
                            radius = 1.0;
                        } else if (type < 0.4) {
                            obj = create('snare_trap', { scale: sampleEntityScale('snare_trap') });
                            exportType = 'snare_trap';
                            isObstacle = true;
                            radius = 0.8;
                        } else if (type < 0.5) {
                            obj = create('retrigger_mushroom', {
                                scale: sampleEntityScale('retrigger_mushroom'),
                                retriggerSpeed: 2 + Math.floor(Math.random() * 6),
                            });
                            exportType = 'retrigger_mushroom';
                        } else if (type < 0.6) {
                            obj = create('portamento_pine', {
                                height: sampleEntityHeight('portamento_pine'),
                            });
                            exportType = 'portamento_pine';
                            isObstacle = true;
                            radius = 0.5;
                        } else if (type < 0.75) {
                            obj = create('tremolo_tulip', {
                                size: sampleEntityScale('tremolo_tulip'),
                            });
                            exportType = 'tremolo_tulip';
                        } else if (type < 0.85) {
                            obj = create('cymbal_dandelion', {
                                scale: sampleEntityScale('cymbal_dandelion'),
                            });
                            exportType = 'cymbal_dandelion';
                        } else {
                            const panBias = x < 0 ? -1 : 1;
                            const padRadius = 1.2 + Math.random();
                            obj = create('panning_pad', { radius: padRadius, panBias });
                            exportType = 'panning_pad';
                            exportParams.radius = padRadius;
                            currentY = groundY + 0.5;
                            if (obj) obj.position.y = currentY;
                        }
                        if (obj) {
                            if (exportType === 'panning_pad') {
                                obj.position.set(x, currentY, z);
                            } else {
                                plantOnSurface(obj, x, z, {
                                    groundY: currentY,
                                    entityType: exportType ?? undefined,
                                });
                            }
                        }
                    }
                } else if (rand < 0.9) {
                    // Vertical Ecosystem: Tiered Clouds
                    const tierRoll = Math.random();
                    if (tierRoll < 0.35) {
                        currentY = 35 + Math.random() * 20;
                        const cloudSize = sampleEntityScale('cloud_tier1');
                        obj = create('cloud', { size: cloudSize });
                        exportType = 'cloud';
                        exportParams.size = cloudSize;
                        exportParams.tier = 1;
                        if (obj) {
                            obj.userData.tier = 1;
                            obj.userData.isWalkable = true;
                        }
                        if (Math.random() < 0.3) {
                            const ladderLength = currentY - groundY;
                            if (ladderLength > 5) {
                                const ladder = create('vine_ladder', { length: ladderLength });
                                if (ladder) {
                                    ladder.userData.mapEntityType = 'vine_ladder';
                                    ladder.userData.mapExport = {
                                        type: 'vine_ladder',
                                        provenance: 'procedural-extra',
                                        placement: 'absolute',
                                        params: { length: ladderLength },
                                    };
                                    ladder.position.set(x, currentY, z);
                                    const placed = safeAddFoliage(ladder, false, 0, weatherSystem);
                                    if (!placed) {
                                        recordSpawnAttempt(
                                            'procedural_extra',
                                            false,
                                            new Error('CPU animation limit reached; object dropped')
                                        );
                                    } else {
                                        recordSpawnAttempt('procedural_extra', true);
                                    }
                                }
                            }
                        }
                    } else {
                        currentY = 12 + Math.random() * 16;
                        const cloudSize = sampleEntityScale('cloud_tier2');
                        obj = create('cloud', { size: cloudSize });
                        exportType = 'cloud';
                        exportParams.size = cloudSize;
                        exportParams.tier = 2;
                        if (obj) {
                            obj.userData.tier = 2;
                            obj.userData.isWalkable = false;
                        }
                    }
                    if (obj) obj.position.set(x, currentY, z);
                } else if (rand < 0.95) {
                    obj = create('silence_spirit');
                    exportType = 'silence_spirit';
                    if (obj)
                        plantOnSurface(obj, x, z, {
                            groundY: currentY,
                            entityType: exportType ?? undefined,
                        });
                } else if (rand < 0.97) {
                    obj = create('melody_mirror', { scale: 2.0 });
                    exportType = 'melody_mirror';
                    if (obj) obj.position.set(x, groundY + 15 + Math.random() * 10, z);
                } else {
                    const id = Math.floor(Math.random() * 16);
                    obj = create('instrument_shrine', { instrumentID: id });
                    exportType = 'instrument_shrine';
                    exportVariant = String(id);
                    exportParams.instrumentID = id;
                    if (obj)
                        plantOnSurface(obj, x, z, { groundY: currentY, entityType: exportType });
                    isObstacle = true;
                }

                if (obj) {
                    obj.rotation.y = Math.random() * Math.PI * 2;
                    const normalizedExportType = normalizeMapEntityType(
                        exportType ?? obj.userData?.type ?? ''
                    );
                    obj.userData.mapEntityType = normalizedExportType;
                    let hasParams = false;
                    for (const _ in exportParams) {
                        hasParams = true;
                        break;
                    }

                    obj.userData.mapExport = {
                        type: normalizedExportType,
                        provenance: 'procedural-extra',
                        variant: exportVariant,
                        hasFace: exportHasFace,
                        placement: normalizedExportType === 'cloud' ? 'absolute' : 'ground',
                        params: hasParams ? exportParams : undefined,
                    };
                    const placed = safeAddFoliage(obj, isObstacle, radius, weatherSystem);
                    if (!placed) {
                        recordSpawnAttempt(
                            'procedural_extra',
                            false,
                            new Error('CPU animation limit reached; object dropped')
                        );
                    } else {
                        recordSpawnAttempt('procedural_extra', true);
                    }
                }
            } catch (e) {
                console.warn(`[World] Failed to spawn procedural extra at ${x},${z}`, e);
                recordSpawnAttempt('procedural_extra', false, e);
            }
        };

        // Narrowed criticality: only physics-relevant objects need to block the loading phase.
        // 0.00 - 0.30: Flowers               → Deferred (no collision)
        // 0.30 - 0.45: Mushrooms              → Critical (bouncy, obstacle)
        // 0.45 - 0.55: Trees                  → Critical (obstacle)
        // 0.55 - 0.75: Musical interactables  → Deferred (no physics impact on player movement)
        // 0.75 - 0.90: Clouds                 → Deferred (walkable tier-1 clouds are uncommon;
        //                                         accepting them being added a frame late is fine)
        // > 0.90: Spirits, Mirrors, Shrines   → Deferred (purely decorative / audio-reactive)
        //
        // Result: only ~25 % of procedural extras are critical (down from 70 %),
        // cutting synchronous spawn time by ~65 %.
        const isCritical = rand >= 0.3 && rand < 0.55;

        if (isCritical) {
            // Yield BEFORE a potentially heavy spawn if we have already burned the budget
            // in a previous spawn.  This prevents a single heavy tree (10–30 ms) from
            // stacking on top of an already-overrun chunk and compounding the stall.
            if (performance.now() - chunkStart >= getEntityBudgetMs()) {
                await yieldControl();
                chunkStart = performance.now();
            }
            spawnExtra();
            criticalCount++;
            // Also yield immediately AFTER a heavy spawn so the browser can breathe.
            if (performance.now() - chunkStart >= getEntityBudgetMs()) {
                await yieldControl();
                chunkStart = performance.now();
            }
        } else {
            deferredItems.push({
                distSq: x * x + z * z,
                id: `procedural_deferred_${i}`,
                execute: spawnExtra,
            });
        }
    }

    // Sort deferred extras nearest-first so the background processor populates the
    // area around the player before filling in the far horizon.
    deferredItems.sort((a, b) => a.distSq - b.distSq);
    const proceduralTaskToken = worldGenerationToken;
    for (const item of deferredItems) {
        // ⚡ OPTIMIZATION: Bypassed Math.sqrt() in hot procedural sorting loop using distance decay estimation
        const priority = Math.max(1, 60 - Math.floor(item.distSq / 16));
        globalBackgroundProcessor.enqueue({
            id: item.id,
            execute: () => {
                const currentToken =
                    (window as any).__currentWorldGenerationToken ?? worldGenerationToken;
                if (
                    taskToken !== -1 &&
                    taskToken !== currentToken &&
                    !(window as any).__IS_FULL_BOOT_TEST
                ) {
                    console.warn(
                        `[Generation] Procedural task obsoleted (token ${taskToken} !== ${currentToken})`
                    );
                    return;
                }
                item.execute();
            },
            priority,
        });
    }

    console.log(
        `[World] Procedural Extras: ${criticalCount} critical spawned, ${deferredItems.length} deferred (sorted near-first).`
    );
}

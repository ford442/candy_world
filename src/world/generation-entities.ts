import * as THREE from 'three';
import { VineSwing, addGrassInstance } from '../foliage/index.ts';
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import {
    animatedFoliage, cpuAnimatedFoliage, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, foliagePanningPads, foliageGeysers,
    foliageTraps, foliagePortamentoPines, vineSwings, foliageVineLadders
} from './state.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';
import { WeatherSystem, normalizeMapEntityType, MapEntity, obstaclesData } from './generation-utils.ts';
import { registerPhysicsCave } from '../systems/physics/index.js';
import { create, getTypeMeta, registerBuiltinWorldObjectTypes, registerWorldObject } from './foliage-registry.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';

registerBuiltinWorldObjectTypes();

const CPU_ANIMATION_LIMIT = 3000;
let _cpuLimitWarnedAt = 0;

// Returns true if the object was successfully added to the scene.
export function safeAddFoliage(
    obj: THREE.Object3D,
    isObstacle: boolean = false,
    radius: number = 1.0,
    weatherSystem: WeatherSystem | null = null
): boolean {
    const isBatched =
        obj.userData.isBatched ||
        obj.userData.type === 'mushroom' ||
        obj.userData.type === 'lanternFlower' ||
        obj.userData.type === 'arpeggio_fern' ||
        obj.userData.type === 'portamento_pine' ||
        obj.userData.type === 'gem_canopy_tree' ||
        obj.userData.type === 'glass_mushroom' ||
        obj.userData.type === 'prismRoseBush' ||
        obj.userData.isFlower;

    // CPU-animated objects are capped to keep the game-loop affordable.
    // Batcher-managed objects bypass this gate — their geometry lives in InstancedMesh,
    // not in per-frame CPU traversal, so they don't contribute to frame cost here.
    const cpuFull = !isBatched && cpuAnimatedFoliage.length >= CPU_ANIMATION_LIMIT;
    if (cpuFull) {
        if (cpuAnimatedFoliage.length > _cpuLimitWarnedAt + 100) {
            console.warn(`[World] CPU animation limit (${CPU_ANIMATION_LIMIT}) reached; non-batched objects will be skipped.`);
            _cpuLimitWarnedAt = cpuAnimatedFoliage.length;
        }
        return false;
    }

    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (!isBatched) cpuAnimatedFoliage.push(obj);

    if (isObstacle) {
        obstaclesData.push({ x: obj.position.x, y: obj.position.y, z: obj.position.z, radius });
    }

    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);
    if (obj.userData.type === 'panningPad') foliagePanningPads.push(obj);
    if (obj.userData.type === 'geyser') foliageGeysers.push(obj);
    if (obj.userData.type === 'trap') {
        foliageTraps.push(obj);
        console.log('[World] Registered Snare Trap. Total:', foliageTraps.length);
    }
    if (obj.userData.type === 'tree' && obj.userData.animationType === 'batchedPortamento') {
        foliagePortamentoPines.push(obj);
    }
    if (obj.userData.type === 'vine_ladder') foliageVineLadders.push(obj);

    // Batcher registration — must not throw silently.
    if (obj.userData.onPlacement) {
        try {
            obj.userData.onPlacement();
        } catch (err) {
            const t = obj.userData.type ?? obj.userData.mapEntityType ?? 'unknown';
            console.error(`[World] onPlacement() failed for "${t}":`, err);
            recordSpawnAttempt(`${t}_batcher`, false, err);
        }
    }
    if (typeof obj.userData.mapEntityType === 'string') {
        registerWorldObject(obj, obj.userData.mapEntityType);
    } else if (typeof obj.userData.type === 'string') {
        registerWorldObject(obj, normalizeMapEntityType(obj.userData.type));
    }

    if (weatherSystem) {
        if (obj.userData.type === 'tree') {
            weatherSystem.registerTree(obj);
        } else if (obj.userData.type === 'shrub') {
            weatherSystem.registerShrub(obj);
        } else if (obj.userData.type === 'mushroom') {
            weatherSystem.registerMushroom(obj);
        } else if (obj.userData.type === 'cave') {
            weatherSystem.registerCave(obj);
            registerPhysicsCave(obj);
        }
    }
    return true;
}

export interface ProcessEntityOptions {
    streamed?: boolean;
}

export function applyDreamyPopIn(obj: THREE.Object3D): void {
    const animatedMaterials: Array<{ mat: THREE.Material & { opacity: number; transparent: boolean }; targetOpacity: number }> = [];
    obj.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
            if (!(material as any).isMaterial || !('opacity' in material)) continue;
            const typed = material as THREE.Material & { opacity: number; transparent: boolean };
            if (typed.opacity >= 0.99) {
                typed.transparent = true;
                typed.opacity = 0;
                animatedMaterials.push({ mat: typed, targetOpacity: 1 });
            }
        }
    });

    if (animatedMaterials.length === 0) return;
    const start = performance.now();
    const duration = 380;
    const tick = () => {
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 2);
        for (const entry of animatedMaterials) {
            entry.mat.opacity = entry.targetOpacity * eased;
            if (t >= 1) entry.mat.transparent = false;
        }
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

export /**
 * Process a single map entity (extracted from forEach loop for chunking)
 */
const MUSICAL_FLORA_TYPES = new Set([
    'arpeggio_fern', 'vibrato_violet', 'tremolo_tulip', 'cymbal_dandelion',
    'snare_trap', 'retrigger_mushroom', 'portamento_pine', 'kick_drum_geyser',
    'panning_pad', 'subwoofer_lotus', 'silence_spirit', 'instrument_shrine',
    'melody_mirror', 'wisteria_cluster', 'accordion_palm', 'fiber_optic_willow',
    'prism_rose_bush', 'starflower',
]);

export function processMapEntity(item: MapEntity, weatherSystem: WeatherSystem, options?: ProcessEntityOptions): void {
    const [x, yInput, z] = item.position;
    const entityType = normalizeMapEntityType(item.type);

    // Feature flag gates — skip entire entity without counting as a failure.
    if (!FEATURE_FLAGS.musicalFlora && MUSICAL_FLORA_TYPES.has(entityType)) return;
    if (!FEATURE_FLAGS.luminousPlants && entityType === 'luminous_plant') return;

    const params = item.params ?? {};
    const placement = item.placement ?? (entityType === 'cloud' ? 'absolute' : 'ground');
    // USE UNIFIED HEIGHT for placement
    const groundY = sampleGroundY(x, z);
    let y = groundY;
    if (placement === 'absolute' || entityType === 'cloud') y = yInput;
    if (placement === 'offset') y = groundY + yInput;

    const uniformScale = typeof item.scale === 'number' ? item.scale : undefined;
    const vectorScale = Array.isArray(item.scale) ? item.scale : undefined;
    const itemRotation = item.rotation;
    const getParamNumber = (key: string, fallback: number): number => {
        const value = params[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    const getParamBoolean = (key: string, fallback: boolean): boolean => {
        const value = params[key];
        return typeof value === 'boolean' ? value : fallback;
    };
    const mapPersistentId = typeof item.persistentId === 'string'
        ? item.persistentId
        : (typeof params.persistentId === 'string'
            ? params.persistentId
            : (typeof item.id === 'string' ? item.id : undefined));

    const annotateMapExport = (obj: THREE.Object3D, resolvedType: string) => {
        const resolvedBiome = item.music?.biomeOverride ?? item.music?.biome ?? item.music?.biomeTag ?? item.biome;
        obj.userData.mapEntityType = resolvedType;
        obj.userData.mapEntityId = item.id;
        obj.userData.biome = resolvedBiome;
        if (mapPersistentId) {
            obj.userData.persistentId = mapPersistentId;
        }
        if (typeof item.music?.trackerChannel === 'number') {
            obj.userData.trackerChannel = item.music.trackerChannel;
        }
        if (typeof item.music?.reactivityProfile === 'string') {
            obj.userData.reactivityProfile = item.music.reactivityProfile;
        }
        if (typeof item.music?.intensityScale === 'number') {
            obj.userData.reactivityIntensityScale = item.music.intensityScale;
        }
        obj.userData.mapExport = {
            type: resolvedType,
            sourceId: item.id,
            provenance: 'map',
            variant: item.variant,
            note: item.note,
            noteIndex: item.noteIndex,
            hasFace: item.hasFace,
            category: item.category,
            layer: item.layer,
            biome: resolvedBiome,
            music: item.music,
            placement,
            params
        };
    };

    try {
        let obj: THREE.Object3D | null = null;
        const meta = getTypeMeta(entityType);
        let isObstacle = meta?.defaultIsObstacle ?? false;
        let radius = meta?.defaultRadius ?? 0.5;
        let caveLookAtOrigin = false;
        let caveNeedsWaterfallProxy = false;
        const createParams: Record<string, unknown> = { ...params };
        if (item.variant !== undefined) createParams.variant = item.variant;
        if (mapPersistentId) createParams.persistentId = mapPersistentId;
        if (item.note !== undefined) createParams.note = item.note;
        if (item.noteIndex !== undefined) createParams.noteIndex = item.noteIndex;
        let cloudTier = 1;

        if (entityType === 'grass') {
            if (FEATURE_FLAGS.grass) addGrassInstance(x, y, z);
            return;
        }
        switch (entityType) {
            case 'mushroom': {
                const isGiant = item.variant === 'giant';
                const hasFace = item.hasFace !== undefined ? item.hasFace : (isGiant || Math.random() < 0.1);
                createParams.size = isGiant ? 'giant' : 'regular';
                createParams.scale = uniformScale ?? 1.0;
                createParams.hasFace = hasFace;
                createParams.isBouncy = isGiant || hasFace;
                if (typeof item.note === 'string') createParams.note = item.note;
                if (Number.isInteger(item.noteIndex)) createParams.noteIndex = item.noteIndex;
                isObstacle = true;
                radius = isGiant ? 2.0 : 0.5;
                break;
            }
            case 'flower':
                createParams.variant = item.variant === 'glowing' ? 'glowing' : 'simple';
                break;
            case 'cloud':
                cloudTier = (item as any).tier || 1;
                createParams.size = typeof item.size === 'number' ? item.size : getParamNumber('size', 1.5);
                break;
            case 'subwoofer_lotus':
            case 'silence_spirit':
            case 'melody_mirror':
                createParams.scale = uniformScale ?? 1.0;
                break;
            case 'floating_orb':
                createParams.size = getParamNumber('size', 0.5);
                y += getParamNumber('hoverOffset', 1.5);
                break;
            case 'swingable_vine': {
                const vineLength = getParamNumber('length', 8);
                createParams.length = vineLength;
                y += vineLength;
                break;
            }
            case 'arpeggio_fern':
                createParams.scale = uniformScale ?? 1.0;
                break;
            case 'portamento_pine':
                createParams.height = getParamNumber('height', 4.0);
                break;
            case 'kick_drum_geyser':
                createParams.maxHeight = getParamNumber('maxHeight', 5.0);
                break;
            case 'cymbal_dandelion':
            case 'snare_trap':
                createParams.scale = uniformScale ?? getParamNumber('scale', 1.0);
                break;
            case 'retrigger_mushroom':
                createParams.scale = uniformScale ?? 1.0;
                createParams.retriggerSpeed = getParamNumber('retriggerSpeed', 4);
                break;
            case 'tremolo_tulip':
                createParams.size = getParamNumber('size', uniformScale ?? 1.0);
                break;
            case 'panning_pad':
                createParams.panBias = x < 0 ? -1 : 1;
                createParams.radius = getParamNumber('radius', uniformScale ?? 1.0);
                if (y < 2) y = 1.0;
                break;
            case 'instrument_shrine': {
                const variantId = parseInt(item.variant || '0', 10);
                createParams.instrumentID = Number.isFinite(variantId) ? variantId : getParamNumber('instrumentID', 0);
                createParams.scale = uniformScale ?? 1.0;
                break;
            }
            case 'wisteria_cluster':
                y += getParamNumber('heightOffset', 4);
                break;
            case 'cave':
                createParams.scale = getParamNumber('scale', uniformScale ?? 2.0);
                isObstacle = getParamBoolean('isObstacle', false);
                radius = getParamNumber('radius', 0);
                caveLookAtOrigin = getParamBoolean('lookAtOrigin', true);
                break;
            default:
                break;
        }

        obj = create(entityType, createParams);
        if (!obj) {
            recordSpawnAttempt(entityType, false, new Error(`Factory returned null for type "${entityType}"`));
            return;
        }

        if (entityType === 'cloud') {
            obj.userData.tier = cloudTier;
            obj.userData.isWalkable = cloudTier === 1;
        } else if (entityType === 'swingable_vine') {
            const vineLength = typeof createParams.length === 'number' ? createParams.length : 8;
            if (vineSwings) vineSwings.push(new VineSwing(obj, vineLength));
        } else if (entityType === 'melody_mirror') {
            if (Number.isInteger(item.noteIndex)) obj.userData.noteIndex = item.noteIndex;
            if (typeof item.note === 'string') obj.userData.note = item.note;
        }
        if (entityType === 'cave') caveNeedsWaterfallProxy = !!obj.userData.gatePosition;

        // --- Spawning ---
        if (obj) {
            annotateMapExport(obj, entityType);
            if (placement === 'ground' && entityType !== 'cloud') {
                plantOnSurface(obj, x, z, { groundY: y });
            } else {
                obj.position.set(x, y, z);
            }
            if (itemRotation && typeof itemRotation === 'object' && !Array.isArray(itemRotation) && 'quat' in itemRotation && Array.isArray(itemRotation.quat)) {
                const [qx, qy, qz, qw] = itemRotation.quat;
                obj.quaternion.set(qx, qy, qz, qw);
            } else if (itemRotation && typeof itemRotation === 'object' && !Array.isArray(itemRotation) && 'euler' in itemRotation && Array.isArray(itemRotation.euler)) {
                const [rx, ry, rz] = itemRotation.euler;
                const order = itemRotation.order;
                const safeOrder = order === 'XYZ' || order === 'YZX' || order === 'ZXY' || order === 'XZY' || order === 'YXZ' || order === 'ZYX'
                    ? order
                    : 'YXZ';
                obj.rotation.set(rx, ry, rz, safeOrder);
            } else if (Array.isArray(itemRotation) && itemRotation.length === 4) {
                const [qx, qy, qz, qw] = itemRotation;
                obj.quaternion.set(qx, qy, qz, qw);
            } else if (Array.isArray(itemRotation) && itemRotation.length === 3) {
                obj.rotation.set(itemRotation[0], itemRotation[1], itemRotation[2], 'YXZ');
            } else if (typeof itemRotation === 'number') {
                obj.rotation.y = itemRotation;
            } else {
                obj.rotation.y = Math.random() * Math.PI * 2;
            }
            if (entityType === 'cave' && caveLookAtOrigin) {
                obj.lookAt(0, y, 0);
            }
            if (vectorScale && entityType !== 'mushroom' && entityType !== 'flower') {
                obj.scale.set(vectorScale[0], vectorScale[1], vectorScale[2]);
            } else if (uniformScale !== undefined && entityType !== 'mushroom' && entityType !== 'flower') {
                obj.scale.setScalar(uniformScale);
            }
            if (options?.streamed && !obj.userData.isBatched) {
                applyDreamyPopIn(obj);
            }
            const placed = safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            if (!placed) {
                recordSpawnAttempt(entityType, false, new Error('CPU animation limit reached; object dropped'));
                return;
            }
            if (entityType === 'cave' && caveNeedsWaterfallProxy && obj.userData.gatePosition) {
                const waterfallProxy = new THREE.Object3D();
                // ⚡ OPTIMIZATION: Bypassed THREE.Object3D proxy by doing pure math composition
                obj.updateMatrix();
                waterfallProxy.position.copy(obj.userData.gatePosition).applyMatrix4(obj.matrix);
                waterfallProxy.userData.type = 'waterfall';
                animatedFoliage.push(waterfallProxy as any);
            }
        }

        recordSpawnAttempt(entityType, true);
    } catch (e) {
        console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
        recordSpawnAttempt(item.type || 'unknown', false, e);
    }
}

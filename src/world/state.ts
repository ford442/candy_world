import * as THREE from 'three';
import { EntityRegistry } from '../core/entities/registry.ts';
import type { FoliageObject } from '../foliage/types.ts';
import type { VineSwing } from '../foliage/vine-swing.ts';

/** What a despawn caller hands every kind's onDespawn hook. */
export interface DespawnContext {
    weatherSystem?: { unregisterCave?(obj: THREE.Object3D): void } | null;
}

/**
 * The one record of live world entities (#1973). Kinds and their hooks are
 * registered where the kind is owned; the arrays below are read-only views
 * over it. Add or remove an entity with `entities.spawn` / `entities.despawn`
 * (teardown of a whole entity: `despawnEntity` in entity-despawn.ts).
 */
export const entities = new EntityRegistry<DespawnContext>({
    keyOf: (obj) =>
        typeof obj.userData?.mapEntityId === 'string' ? obj.userData.mapEntityId : undefined,
});

// Read-only, referentially stable views: hold them from module load and read
// them every frame. Only the registry mutates them. Taking a view declares the
// kind; these kinds have no hooks, so they need no registerKind.
export const animatedFoliage: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('animatedFoliage');
export const cpuAnimatedFoliage: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('cpuAnimatedFoliage');
export const obstacles: ReadonlyArray<THREE.Object3D> = entities.view<THREE.Object3D>('obstacle');

// Optimization: Categorized views for faster collision/logic
export const foliageMushrooms: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageMushroom');
export const foliageTrampolines: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageTrampoline');
export const foliagePanningPads: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliagePanningPad');
export const foliageClouds: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageCloud');
export const foliageGeysers: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageGeyser'); // Added for physics interaction
export const foliageTraps: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageTrap'); // Added for snare trap interaction
export const foliagePortamentoPines: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliagePortamentoPine'); // Added for slingshot interaction
/** Swing-physics managers; spawned as `entities.spawn('vineSwing', vine, manager)`. */
export const vineSwings: ReadonlyArray<VineSwing> = entities.view<VineSwing>('vineSwing');
export const foliageVineLadders: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('foliageVineLadder'); // Static climbable vines

// ⚡ OPTIMIZATION: Pre-filtered views to eliminate O(N) scans in hot loops
// Objects that have WebGPU compute nodes (waterfall, pollen, etc.)
export const computeFoliageObjects: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('computeFoliageObject');
// Objects that have interaction callbacks/text (gaze, proximity, interact)
export const interactiveObjects: ReadonlyArray<FoliageObject> = entities.view<FoliageObject>('interactiveObject');

// Groups
export const worldGroup = new THREE.Group();
export const foliageGroup = new THREE.Group();
// ⚡ OPTIMIZATION: Removed worldGroup.add(foliageGroup) to flatten scene hierarchy and avoid O(N) updateMatrixWorld traversal overhead on thousands of static batchers.

export let activeVineSwing: VineSwing | null = null; // Current vine player is attached to
export let lastVineDetachTime: number = 0; // Debounce re-attach

export function setActiveVineSwing(vine: VineSwing | null) {
    activeVineSwing = vine;
}

export function setLastVineDetachTime(time: number) {
    lastVineDetachTime = time;
}

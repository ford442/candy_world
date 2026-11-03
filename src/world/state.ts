import * as THREE from 'three';
import type { FoliageObject } from '../foliage/types.ts';
import type { VineSwing } from '../foliage/vine-swing.ts';

import { EntityRegistry } from '../core/entities/registry.ts';

export const entities = new EntityRegistry();

export const animatedFoliage: FoliageObject[] = [];
export const cpuAnimatedFoliage: FoliageObject[] = [];
export const obstacles: THREE.Object3D[] = [];

// Optimization: Categorized arrays for faster collision/logic
export const foliageMushrooms: FoliageObject[] = [];
export const foliageTrampolines: FoliageObject[] = [];
export const foliagePanningPads: FoliageObject[] = [];
export const foliageClouds: FoliageObject[] = [];
export const foliageGeysers: FoliageObject[] = []; // Added for physics interaction
export const foliageTraps: FoliageObject[] = []; // Added for snare trap interaction
export const foliagePortamentoPines: FoliageObject[] = []; // Added for slingshot interaction
export const vineSwings: VineSwing[] = []; // Managers for swing physics
export const foliageVineLadders: FoliageObject[] = []; // Static climbable vines

// ⚡ OPTIMIZATION: Pre-filtered arrays to eliminate O(N) scans in hot loops
// Objects that have WebGPU compute nodes (waterfall, pollen, etc.)
export const computeFoliageObjects: FoliageObject[] = [];
// Objects that have interaction callbacks/text (gaze, proximity, interact)
export const interactiveObjects: FoliageObject[] = [];

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


// Registry Hook setup

function arrayPush(arr: any[], obj: any) {
    arr.push(obj);
}

function arrayRemove(arr: any[], obj: any) {
    const idx = arr.indexOf(obj);
    if (idx !== -1) {
        // Swap-remove for O(1) removal
        const last = arr[arr.length - 1];
        arr[idx] = last;
        arr.pop();
    }
}

entities.registerKind('animatedFoliage', {
    onSpawn: (_, obj) => arrayPush(animatedFoliage, obj),
    onDespawn: (_, obj) => arrayRemove(animatedFoliage, obj)
});

entities.registerKind('cpuAnimatedFoliage', {
    onSpawn: (_, obj) => arrayPush(cpuAnimatedFoliage, obj),
    onDespawn: (_, obj) => arrayRemove(cpuAnimatedFoliage, obj)
});

entities.registerKind('obstacle', {
    onSpawn: (_, obj) => arrayPush(obstacles, obj),
    onDespawn: (_, obj) => arrayRemove(obstacles, obj)
});

entities.registerKind('foliageMushroom', {
    onSpawn: (_, obj) => arrayPush(foliageMushrooms, obj),
    onDespawn: (_, obj) => arrayRemove(foliageMushrooms, obj)
});

entities.registerKind('foliageTrampoline', {
    onSpawn: (_, obj) => arrayPush(foliageTrampolines, obj),
    onDespawn: (_, obj) => arrayRemove(foliageTrampolines, obj)
});

entities.registerKind('foliagePanningPad', {
    onSpawn: (_, obj) => arrayPush(foliagePanningPads, obj),
    onDespawn: (_, obj) => arrayRemove(foliagePanningPads, obj)
});

entities.registerKind('foliageCloud', {
    onSpawn: (_, obj) => arrayPush(foliageClouds, obj),
    onDespawn: (_, obj) => arrayRemove(foliageClouds, obj)
});

entities.registerKind('foliageGeyser', {
    onSpawn: (_, obj) => arrayPush(foliageGeysers, obj),
    onDespawn: (_, obj) => arrayRemove(foliageGeysers, obj)
});

entities.registerKind('foliageTrap', {
    onSpawn: (_, obj) => arrayPush(foliageTraps, obj),
    onDespawn: (_, obj) => arrayRemove(foliageTraps, obj)
});

entities.registerKind('foliagePortamentoPine', {
    onSpawn: (_, obj) => arrayPush(foliagePortamentoPines, obj),
    onDespawn: (_, obj) => arrayRemove(foliagePortamentoPines, obj)
});

entities.registerKind('vineSwing', {
    onSpawn: (_, obj) => arrayPush(vineSwings, obj),
    onDespawn: (_, obj) => arrayRemove(vineSwings, obj)
});

entities.registerKind('foliageVineLadder', {
    onSpawn: (_, obj) => arrayPush(foliageVineLadders, obj),
    onDespawn: (_, obj) => arrayRemove(foliageVineLadders, obj)
});

entities.registerKind('computeFoliageObject', {
    onSpawn: (_, obj) => arrayPush(computeFoliageObjects, obj),
    onDespawn: (_, obj) => arrayRemove(computeFoliageObjects, obj)
});

entities.registerKind('interactiveObject', {
    onSpawn: (_, obj) => arrayPush(interactiveObjects, obj),
    onDespawn: (_, obj) => arrayRemove(interactiveObjects, obj)
});

import * as THREE from 'three';
import { VineSwing } from '../foliage/trees.ts';
import { FoliageObject } from '../foliage/types.ts';

export const animatedFoliage: FoliageObject[] = [];
export const obstacles: THREE.Object3D[] = [];

// Optimization: Categorized arrays for faster collision/logic
export const foliageMushrooms: FoliageObject[] = [];
export const foliageTrampolines: FoliageObject[] = [];
export const foliagePanningPads: FoliageObject[] = [];
export const foliageClouds: FoliageObject[] = [];
export const vineSwings: VineSwing[] = []; // Managers for swing physics

// Groups
export const worldGroup = new THREE.Group();
export const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);

export let activeVineSwing: VineSwing | null = null; // Current vine player is attached to
export let lastVineDetachTime: number = 0; // Debounce re-attach

export function setActiveVineSwing(vine: VineSwing | null) {
    activeVineSwing = vine;
}

export function setLastVineDetachTime(time: number) {
    lastVineDetachTime = time;
}

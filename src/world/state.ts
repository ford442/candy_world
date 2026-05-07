import * as THREE from 'three';
import { VineSwing } from '../foliage/trees.ts';
import { FoliageObject } from '../foliage/types.ts';

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
worldGroup.add(foliageGroup);

export let activeVineSwing: VineSwing | null = null; // Current vine player is attached to
export let lastVineDetachTime: number = 0; // Debounce re-attach

export function setActiveVineSwing(vine: VineSwing | null) {
    activeVineSwing = vine;
}

export function setLastVineDetachTime(time: number) {
    lastVineDetachTime = time;
}

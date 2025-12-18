// src/world/state.js

import * as THREE from 'three';

export const animatedFoliage = [];
export const obstacles = [];

// Optimization: Categorized arrays for faster collision/logic
export const foliageMushrooms = [];
export const foliageTrampolines = [];
export const foliageClouds = [];
export const vineSwings = []; // Managers for swing physics

// Groups
export const worldGroup = new THREE.Group();
export const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);

export let activeVineSwing = null; // Current vine player is attached to
export let lastVineDetachTime = 0; // Debounce re-attach

export function setActiveVineSwing(vine) {
    activeVineSwing = vine;
}

export function setLastVineDetachTime(time) {
    lastVineDetachTime = time;
}

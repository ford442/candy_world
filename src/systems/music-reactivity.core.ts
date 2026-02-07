// src/systems/music-reactivity.core.ts
// Core music reactivity calculation functions (Phase 1: JS -> TS Migration)
// Following PERFORMANCE_MIGRATION_STRATEGY.md - Extract only hot functions (~15%)

import * as THREE from 'three';
import type { FoliageObject } from '../foliage/types.ts';

// --- Type Definitions ---

export interface ReactivityConfig {
    maxAnimationDistance: number;
    maxFoliageUpdates: number;
    maxFoliageUpdateTime: number;
    budgetCheckInterval: number;
}

export interface LightLevelCheck {
    lightFactor: number;
    shouldReact: boolean;
}

export interface ChannelMapping {
    targetChannelIndex: number;
    splitIndex: number;
}

// --- Constants ---

const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Caches to prevent repeated lookups
const _noteNameCache: Record<string, string> = {};
const _speciesMapCache: Record<string, any> = {};
const _scratchSphere = new THREE.Sphere(); // Reusable for culling checks

// --- Core Calculation Functions ---

/**
 * Calculate light factor for photosensitive reactivity
 * Hot path - called for every animated object
 */
export function calculateLightFactor(
    foliageObject: FoliageObject,
    globalLight: number
): LightLevelCheck {
    const min = foliageObject.userData.minLight !== undefined 
        ? foliageObject.userData.minLight 
        : 0.0;
    const max = foliageObject.userData.maxLight !== undefined 
        ? foliageObject.userData.maxLight 
        : 1.0;
    const feather = 0.1;
    
    const lowerEdge = (globalLight - min) / feather; 
    const upperEdge = (max - globalLight) / feather; 
    const lightFactor = Math.min(
        Math.max(lowerEdge, 0), 
        Math.max(upperEdge, 0), 
        1.0
    );

    return {
        lightFactor,
        shouldReact: lightFactor > 0
    };
}

/**
 * Calculate target channel index for an object
 * Hot path - uses caching to avoid recalculation
 */
export function calculateChannelIndex(
    foliageObject: FoliageObject,
    totalChannels: number,
    splitIndex: number
): number {
    // Check cache first
    let targetChannelIndex = foliageObject.userData._cacheIdx;

    // Recompute if cache is missing or channel configuration changed
    if (targetChannelIndex === undefined || 
        foliageObject.userData._cacheTotal !== totalChannels) {
        
        const type = foliageObject.userData.reactivityType || 'flora';
        const id = foliageObject.userData.reactivityId || 0;

        if (type === 'sky') {
            // Upper half (Drums/Percussion)
            const skyCount = totalChannels - splitIndex;
            targetChannelIndex = (skyCount > 0)
                ? splitIndex + (id % skyCount)
                : totalChannels - 1;
        } else {
            // Lower half (Melody/Bass)
            const floraCount = splitIndex;
            targetChannelIndex = (floraCount > 0)
                ? id % floraCount
                : 0;
        }

        // Store in cache
        foliageObject.userData._cacheIdx = targetChannelIndex;
        foliageObject.userData._cacheTotal = totalChannels;
    }

    return targetChannelIndex;
}

/**
 * Check if object is within frustum and distance
 * Hot path - inlined distance check before frustum check for performance
 */
export function isObjectVisible(
    object: FoliageObject,
    cameraPosition: THREE.Vector3,
    maxDistanceSq: number,
    frustum: THREE.Frustum
): boolean {
    // Distance culling first (cheaper than frustum)
    const dx = object.position.x - cameraPosition.x;
    const dy = object.position.y - cameraPosition.y;
    const dz = object.position.z - cameraPosition.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > maxDistanceSq) {
        return false;
    }

    // Frustum culling
    // Handle Groups or objects without geometry using a bounding sphere (reuse scratch sphere)
    if (object.geometry && object.geometry.boundingSphere) {
        return frustum.intersectsObject(object);
    } else {
        _scratchSphere.center.copy(object.position);
        _scratchSphere.radius = object.userData.radius || 5.0;
        return frustum.intersectsSphere(_scratchSphere);
    }
}

/**
 * Resolve note name from various input formats
 * Cached to prevent repeated string operations
 */
export function resolveNoteName(note: number | string): string {
    if (typeof note === 'number') {
        const index = note % 12;
        return CHROMATIC_SCALE[index];
    } else if (typeof note === 'string') {
        // Check cache first
        if (_noteNameCache[note]) {
            return _noteNameCache[note];
        }
        
        // Handle "C4", "F#3" etc.
        const noteName = note.replace(/[0-9-]/g, '');
        
        // Limit cache size to prevent memory leak
        if (Object.keys(_noteNameCache).length < 200) {
            _noteNameCache[note] = noteName;
        }
        
        return noteName;
    }
    
    return '';
}

/**
 * Get color for a note based on species
 * Uses caching for species palette lookups
 */
export function getNoteColorTyped(
    note: number | string,
    species: string,
    noteColorMap: Record<string, Record<string, number>>
): number {
    const noteName = resolveNoteName(note);

    // Lookup species palette
    let map = noteColorMap[species];

    if (!map) {
        // Check cache
        if (_speciesMapCache[species]) {
            map = _speciesMapCache[species];
        } else {
            // Heuristic mapping to known palettes
            const s = (species || '').toLowerCase();
            if (s.includes('flower') || s.includes('tulip') || 
                s.includes('violet') || s.includes('rose') || 
                s.includes('bloom') || s.includes('lotus') || 
                s.includes('puff')) {
                map = noteColorMap['flower'];
            } else if (s.includes('mushroom') || s.includes('mush')) {
                map = noteColorMap['mushroom'];
            } else if (s.includes('tree') || s.includes('willow') || 
                       s.includes('palm') || s.includes('bush')) {
                map = noteColorMap['tree'];
            } else if (s.includes('cloud') || s.includes('orb') || 
                       s.includes('geyser') || s.includes('moon')) {
                map = noteColorMap['cloud'] || noteColorMap['global'];
            } else {
                map = noteColorMap['global'];
            }
            _speciesMapCache[species] = map;
        }
    }

    // Return color or fallback to White
    return map[noteName] || 0xFFFFFF;
}

/**
 * Calculate split index for channel mapping
 * Divides channels between sky/flora
 */
export function calculateSplitIndex(totalChannels: number): number {
    return Math.ceil(totalChannels / 2);
}

/**
 * Check if time budget has been exceeded
 * Throttled check to avoid expensive performance.now() calls
 */
export function shouldCheckTimeBudget(
    processedCount: number,
    budgetCheckInterval: number
): boolean {
    return (processedCount % budgetCheckInterval === 0);
}

/**
 * Calculate next staggered update index
 * Round-robin processing with minimum progress guarantee
 */
export function calculateNextStartIndex(
    currentIndex: number,
    processedCount: number,
    totalObjects: number
): number {
    const minIncrement = Math.min(10, totalObjects);
    const actualIncrement = Math.max(processedCount, minIncrement);
    return (currentIndex + actualIncrement) % totalObjects;
}

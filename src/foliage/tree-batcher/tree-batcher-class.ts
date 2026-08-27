// src/foliage/tree-batcher/tree-batcher-class.ts
// Lazy dynamic buffer growth: Starts with INITIAL_INSTANCES=100, doubles capacity as needed.

import * as THREE from 'three';
import { getGroundAlignedQuaternion } from '../../world/placement-utils.ts';
import { ANIMATION_TYPES } from '../animation-nodes.ts';
import { INITIAL_INSTANCES, MAX_INSTANCES, _scratchTreeOriginalQuaternion, _scratchTreeFinalQuaternion } from './constants.ts';
import type { PendingInstance } from './constants.ts';
import { initializeTreeBatcherMeshes } from './materials-init.ts';
import {
    flushRegistrations,
    registerAccordionPalm,
    registerBalloonBush,
    registerBubbleWillow,
    registerFloweringTree,
    registerHelixPlant,
} from './ops.ts';
import type { TreeBatcherState } from './types.ts';

export class TreeBatcher implements TreeBatcherState {
    private static instance: TreeBatcher;
    initialized = false;

    // Batches
    trunks!: THREE.InstancedMesh;
    spheres!: THREE.InstancedMesh;
    capsules!: THREE.InstancedMesh;
    helices!: THREE.InstancedMesh;
    roses!: THREE.InstancedMesh;

    // Instance counts
    trunkCount = 0;
    sphereCount = 0;
    capsuleCount = 0;
    helixCount = 0;
    roseCount = 0;

    // Capacity tracking (dynamic growth)
    trunkCapacity = INITIAL_INSTANCES;
    sphereCapacity = INITIAL_INSTANCES;
    capsuleCapacity = INITIAL_INSTANCES;
    helixCapacity = INITIAL_INSTANCES;
    roseCapacity = INITIAL_INSTANCES;
    accordionLeafCount = 0;
    accordionLeafCapacity = INITIAL_INSTANCES;
    accordionLeaves!: THREE.InstancedMesh;

    // Batch queue for WASM matrix composition
    _pendingInstances: PendingInstance[] = [];

    private constructor() {
        // Deferred initialization
    }

    /**
     * Pre-allocate a larger initial capacity before init() to avoid runtime growth spikes.
     */
    setInitialCapacity(target: number): void {
        if (this.initialized) return;
        if (!Number.isFinite(target)) return;
        const clamped = Math.min(MAX_INSTANCES, Math.max(INITIAL_INSTANCES, Math.floor(target)));
        this.trunkCapacity = clamped;
        this.sphereCapacity = clamped;
        this.capsuleCapacity = clamped;
        this.helixCapacity = clamped;
        this.roseCapacity = clamped;
        this.accordionLeafCapacity = clamped;
    }

    static getInstance(): TreeBatcher {
        if (!TreeBatcher.instance) {
            TreeBatcher.instance = new TreeBatcher();
        }
        return TreeBatcher.instance;
    }

    init(): void {
        initializeTreeBatcherMeshes(this, () => this.getLODMeshes());
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        if (!this.initialized) return [];
        return [this.trunks, this.spheres, this.capsules, this.helices, this.roses];
    }

    register(group: THREE.Group, type: string): void {
        if (!this.initialized) this.init();

        const slopeQ = group.userData.groundSlopeQuaternion as THREE.Quaternion | undefined;
        // ⚡ OPTIMIZATION: Bypassed expensive group.updateWorldMatrix() recursion.
        // We know these groups are spawned at the root level or have an up-to-date parent matrix,
        // so we can compose their matrixWorld directly to save CPU in the hot spawn path.
        if (slopeQ) {
            _scratchTreeOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchTreeFinalQuaternion));
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
            group.quaternion.copy(_scratchTreeOriginalQuaternion);
        } else {
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
        }

        let animTypeEnum = ANIMATION_TYPES.STATIC;
        const typeStr = group.userData.animationType;
        if (typeStr === 'gentleSway') animTypeEnum = ANIMATION_TYPES.GENTLE_SWAY;
        else if (typeStr === 'bounce' || (Array.isArray(typeStr) && typeStr.indexOf('bounce') !== -1))
            animTypeEnum = ANIMATION_TYPES.BOUNCE;
        else if (typeStr === 'shiver' || (Array.isArray(typeStr) && typeStr.indexOf('shiver') !== -1))
            animTypeEnum = ANIMATION_TYPES.SHIVER;
        else if (typeStr === 'spring' || (Array.isArray(typeStr) && typeStr.indexOf('spring') !== -1))
            animTypeEnum = ANIMATION_TYPES.SPRING;
        else if (typeStr === 'vineSway' || (Array.isArray(typeStr) && typeStr.indexOf('vineSway') !== -1))
            animTypeEnum = ANIMATION_TYPES.VINE_SWAY;
        else if (typeStr === 'hop' || (Array.isArray(typeStr) && typeStr.indexOf('hop') !== -1))
            animTypeEnum = ANIMATION_TYPES.HOP;
        else if (typeStr === 'wobble' || (Array.isArray(typeStr) && typeStr.indexOf('wobble') !== -1))
            animTypeEnum = ANIMATION_TYPES.WOBBLE;
        else if (typeStr === 'accordion' || (Array.isArray(typeStr) && typeStr.indexOf('accordion') !== -1))
            animTypeEnum = ANIMATION_TYPES.ACCORDION;
        else if (typeStr === 'accordionStretch') animTypeEnum = ANIMATION_TYPES.ACCORDION_STRETCH;
        else if (typeStr === 'spiralWave' || (Array.isArray(typeStr) && typeStr.indexOf('spiralWave') !== -1))
            animTypeEnum = ANIMATION_TYPES.SPIRAL_WAVE;
        else if (typeStr === 'fiberWhip') animTypeEnum = ANIMATION_TYPES.FIBER_WHIP;

        group.userData._animTypeEnum = animTypeEnum;
        group.userData._animOffset = group.userData.animationOffset || 0;

        if (type === 'bubbleWillow' || type === 'willow') {
            registerBubbleWillow(this, group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'balloonBush' || type === 'shrub') {
            registerBalloonBush(this, group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'helixPlant' || type === 'helix') {
            registerHelixPlant(this, group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'accordion_palm' || type === 'accordionPalm') {
            registerAccordionPalm(this, group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'tree' || type === 'floweringTree' || type === 'prismRoseBush') {
            registerFloweringTree(this, group, group.userData._animTypeEnum, group.userData._animOffset);
        }

        flushRegistrations(this);
    }

    getStats() {
        return {
            trunks: { count: this.trunkCount, capacity: this.trunkCapacity },
            spheres: { count: this.sphereCount, capacity: this.sphereCapacity },
            capsules: { count: this.capsuleCount, capacity: this.capsuleCapacity },
            helices: { count: this.helixCount, capacity: this.helixCapacity },
            roses: { count: this.roseCount, capacity: this.roseCapacity },
        };
    }
}

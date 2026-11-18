// src/foliage/tree-batcher/tree-batcher-class.ts
// Trees, shrubs, willows (vine sway), helix plants, palms and rose bushes.
// Each part mesh is a TreePartBatcher (InstancedBatcher, #2166); a tree owns
// one handle per sub-mesh, so removal is the base swap-remove on each.

import type * as THREE from 'three';
import { getGroundAlignedQuaternion } from '../../world/placement-utils.ts';
import { ANIMATION_TYPES } from '../animation-nodes.ts';
import {
    MAX_INSTANCES,
    _scratchTreeOriginalQuaternion,
    _scratchTreeFinalQuaternion,
} from './constants.ts';
import { initializeTreeBatcherMeshes } from './materials-init.ts';
import {
    registerAccordionPalm,
    registerBalloonBush,
    registerBubbleWillow,
    registerFloweringTree,
    registerHelixPlant,
    type TreePartSink,
} from './ops.ts';
import { TreePartBatcher } from './tree-part-batcher.ts';
import { TREE_PARTS, type TreeBatcherState, type TreePart } from './types.ts';

export class TreeBatcher implements TreePartSink {
    private static instance: TreeBatcher;
    initialized = false;

    readonly capacity: number;
    readonly parts: Record<TreePart, TreePartBatcher>;
    /** Tree group id → the part handles it owns. */
    private handles = new Map<number, { part: TreePart; handle: number }[]>();
    /** Sub-meshes dropped because their part was full (add() returned null). */
    dropped = 0;

    private meshState: TreeBatcherState;

    constructor(capacity: number = MAX_INSTANCES) {
        this.capacity = capacity;
        this.meshState = {
            initialized: false,
            trunkCapacity: capacity,
            sphereCapacity: capacity,
            capsuleCapacity: capacity,
            helixCapacity: capacity,
            roseCapacity: capacity,
            accordionLeafCapacity: capacity,
        } as TreeBatcherState;
        const parts = {} as Record<TreePart, TreePartBatcher>;
        for (const part of TREE_PARTS) {
            parts[part] = new TreePartBatcher(`tree-${part}`, capacity, () => this.meshState[part]);
        }
        this.parts = parts;
    }

    static getInstance(): TreeBatcher {
        if (!TreeBatcher.instance) {
            TreeBatcher.instance = new TreeBatcher();
        }
        return TreeBatcher.instance;
    }

    get trunks(): THREE.InstancedMesh {
        return this.meshState.trunks;
    }
    get spheres(): THREE.InstancedMesh {
        return this.meshState.spheres;
    }
    get capsules(): THREE.InstancedMesh {
        return this.meshState.capsules;
    }
    get helices(): THREE.InstancedMesh {
        return this.meshState.helices;
    }
    get roses(): THREE.InstancedMesh {
        return this.meshState.roses;
    }
    get accordionLeaves(): THREE.InstancedMesh {
        return this.meshState.accordionLeaves;
    }

    init(): void {
        if (this.initialized) return;
        this.meshState.initialized = false;
        initializeTreeBatcherMeshes(this.meshState, () => this.getLODMeshes());
        for (const part of TREE_PARTS) this.parts[part].attach();
        this.initialized = true;
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        if (!this.initialized) return [];
        return [this.trunks, this.spheres, this.capsules, this.helices, this.roses];
    }

    addPart(
        logicId: number,
        part: TreePart,
        matrix: THREE.Matrix4,
        color: THREE.Color,
        animType: number,
        animOffset: number
    ): void {
        const handle = this.parts[part].add({
            matrix: Float32Array.from(matrix.elements),
            r: color.r,
            g: color.g,
            b: color.b,
            animType,
            animOffset,
        });
        if (handle === null) {
            if (this.dropped++ === 0) {
                console.warn(
                    `[TreeBatcher] ${part} is full (${this.capacity}); dropping tree parts`
                );
            }
            return;
        }
        let owned = this.handles.get(logicId);
        if (!owned) {
            owned = [];
            this.handles.set(logicId, owned);
        }
        owned.push({ part, handle });
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
        else if (
            typeStr === 'bounce' ||
            (Array.isArray(typeStr) && typeStr.indexOf('bounce') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.BOUNCE;
        else if (
            typeStr === 'shiver' ||
            (Array.isArray(typeStr) && typeStr.indexOf('shiver') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.SHIVER;
        else if (
            typeStr === 'spring' ||
            (Array.isArray(typeStr) && typeStr.indexOf('spring') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.SPRING;
        else if (
            typeStr === 'vineSway' ||
            (Array.isArray(typeStr) && typeStr.indexOf('vineSway') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.VINE_SWAY;
        else if (typeStr === 'hop' || (Array.isArray(typeStr) && typeStr.indexOf('hop') !== -1))
            animTypeEnum = ANIMATION_TYPES.HOP;
        else if (
            typeStr === 'wobble' ||
            (Array.isArray(typeStr) && typeStr.indexOf('wobble') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.WOBBLE;
        else if (
            typeStr === 'accordion' ||
            (Array.isArray(typeStr) && typeStr.indexOf('accordion') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.ACCORDION;
        else if (typeStr === 'accordionStretch') animTypeEnum = ANIMATION_TYPES.ACCORDION_STRETCH;
        else if (
            typeStr === 'spiralWave' ||
            (Array.isArray(typeStr) && typeStr.indexOf('spiralWave') !== -1)
        )
            animTypeEnum = ANIMATION_TYPES.SPIRAL_WAVE;
        else if (typeStr === 'fiberWhip') animTypeEnum = ANIMATION_TYPES.FIBER_WHIP;

        const offset = group.userData.animationOffset || 0;
        group.userData._animTypeEnum = animTypeEnum;
        group.userData._animOffset = offset;

        if (type === 'bubbleWillow' || type === 'willow') {
            registerBubbleWillow(this, group, animTypeEnum, offset);
        } else if (type === 'balloonBush' || type === 'shrub') {
            registerBalloonBush(this, group, animTypeEnum, offset);
        } else if (type === 'helixPlant' || type === 'helix') {
            registerHelixPlant(this, group, animTypeEnum, offset);
        } else if (type === 'accordion_palm' || type === 'accordionPalm') {
            registerAccordionPalm(this, group, animTypeEnum, offset);
        } else if (type === 'tree' || type === 'floweringTree' || type === 'prismRoseBush') {
            registerFloweringTree(this, group, animTypeEnum, offset);
        }

        // Trees are registered during generation, before the frame loop runs.
        for (const part of TREE_PARTS) this.parts[part].flush();
    }

    /** Free every part the tree owns (ChunkStreamer eviction, entity despawn). */
    removeInstance(logicObject: THREE.Object3D): void {
        if (!this.initialized || !logicObject) return;
        const owned = this.handles.get(logicObject.id);
        if (!owned) return;
        for (const { part, handle } of owned) this.parts[part].remove(handle);
        this.handles.delete(logicObject.id);
    }

    has(logicObject: THREE.Object3D): boolean {
        return this.handles.has(logicObject.id);
    }

    getStats(): Record<TreePart, { count: number; capacity: number }> {
        const stats = {} as Record<TreePart, { count: number; capacity: number }>;
        for (const part of TREE_PARTS) {
            stats[part] = { count: this.parts[part].instanceCount, capacity: this.capacity };
        }
        return stats;
    }

    dispose(): void {
        if (!this.initialized) return;
        for (const part of TREE_PARTS) this.parts[part].dispose();
        this.handles.clear();
        this.dropped = 0;
        this.initialized = false;
    }
}

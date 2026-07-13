import * as THREE from 'three';
import { treeBatcher } from './tree-batcher.ts';
import { gemFruitBatcher } from './gem-fruit-batcher.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { awakenedPersistence } from '../systems/awakened-persistence.ts';
import type { FoliageObject } from './types.ts';

export interface GemCanopyTreeOptions {
    height?: number;
    /** Skip gem fruits (e.g. for map preview proxies) */
    gems?: boolean;
    persistentId?: string;
}

/**
 * Signature Gem Canopy tree — bubble-willow silhouette with hanging jewel fruits.
 */
export function createGemCanopyTree(options: GemCanopyTreeOptions = {}): FoliageObject {
    const { height = 4.5, gems = true, persistentId } = options;
    const group = new THREE.Group();

    const hitGeo = new THREE.CylinderGeometry(0.45, 0.55, height, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = height * 0.5;
    group.add(hitMesh);

    group.scale.setScalar(height / 4.5);
    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'gem_canopy_tree';
    group.userData.biome = 'gem_canopy';
    group.userData.interactionText = 'Jewel Canopy';
    group.userData.canopyHeight = height;
    if (persistentId) {
        group.userData.persistentId = persistentId;
    }

    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'bubbleWillow');
        const refs = gems
            ? gemFruitBatcher.attachToTree(group, {
                height,
                gemCount: 6 + Math.floor(Math.random() * 3),
            }).refs
            : [];
        const entityId = awakenedPersistence.resolvePersistentId(group);
        awakenedPersistence.registerPlacedEntity(
            entityId,
            'gem_canopy_tree',
            'gem_canopy',
            group.position,
            refs
        );
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };

    return makeInteractive(group) as FoliageObject;
}

import * as THREE from 'three';
import { glassMushroomBatcher } from './glass-mushroom-batcher.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import type { FoliageObject } from './types.ts';
import { discoverySystem } from '../systems/discovery.ts';
import { spawnImpact } from './impacts.ts';

export interface GlassMushroomOptions {
    scale?: number;
}

/**
 * Glass Mycelium Mushroom — glossy candy-glass fungus with a bioluminescent vein
 * network. Visuals are provided by the instanced {@link glassMushroomBatcher};
 * this archetype is the lightweight logical/interaction proxy that registers into it.
 */
export function createGlassMushroom(options: GlassMushroomOptions = {}): FoliageObject {
    const { scale = 1.0 } = options;

    const group = new THREE.Group();
    group.scale.setScalar(scale);

    group.userData.type = 'glass_mushroom';
    group.userData.biome = 'luminous_plants'; // companion biome — shares the luminous tracker channel
    group.userData.interactionText = 'Glass Mycelium';
    group.userData.radius = 0.6 * scale; // physics hitbox estimate

    group.userData.onPlacement = () => {
        const id = glassMushroomBatcher.register(group);
        group.userData.batchIndex = id;
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };

    group.userData.onInteract = () => {
        // Discovery & Particle Impact
        discoverySystem.discover('glass_mushroom', 'Glass Mycelium', '🍄');
        spawnImpact(group.position, 'spore', 0x4DE2FF);

        // Tactile Game Feel Scale Bounce
        if (group.userData.batchIndex !== undefined && group.userData.batchIndex !== -1) {
            group.scale.setScalar(scale * 1.2);
            group.updateMatrixWorld(true);
            glassMushroomBatcher.updateInstance(group.userData.batchIndex, group.matrixWorld);

            setTimeout(() => {
                group.scale.setScalar(scale);
                group.updateMatrixWorld(true);
                glassMushroomBatcher.updateInstance(group.userData.batchIndex, group.matrixWorld);
            }, 150);
        }
    };

    return makeInteractive(group) as FoliageObject;
}

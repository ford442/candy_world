import * as THREE from 'three';
import { LuminousPlantBatcher } from './luminous-plant-batcher.ts';
import { attachReactivity } from './index.ts';
import { awakenedPersistence } from '../systems/awakened-persistence.ts';

export interface LuminousPlantOptions {
    scale?: number;
    persistentId?: string;
}

export function createLuminousPlant(options: LuminousPlantOptions = {}): THREE.Group {
    const { scale = 1.0, persistentId } = options;

    const group = new THREE.Group();
    group.scale.setScalar(scale);

    group.userData.type = 'luminous_plant';
    group.userData.biome = 'luminous_plants';
    group.userData.radius = 2.0 * scale;
    if (persistentId) {
        group.userData.persistentId = persistentId;
    }

    group.userData.onPlacement = () => {
        const instanceIndex = LuminousPlantBatcher.getInstance().register(group);
        if (instanceIndex >= 0) {
            const entityId = awakenedPersistence.resolvePersistentId(group);
            awakenedPersistence.registerPlacedEntity(
                entityId,
                'luminous_plant',
                'luminous_plants',
                group.position,
                [{ batcher: 'luminous', instanceIndex }]
            );
        }
        group.userData.onPlacement = null;
    };

    return attachReactivity(group);
}

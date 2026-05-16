import * as THREE from 'three';
import { LuminousPlantBatcher } from './luminous-plant-batcher.ts';
import { attachReactivity } from './index.ts';

export interface LuminousPlantOptions {
    scale?: number;
}

export function createLuminousPlant(options: LuminousPlantOptions = {}): THREE.Group {
    const { scale = 1.0 } = options;

    const group = new THREE.Group();
    group.scale.setScalar(scale);

    group.userData.type = 'luminous_plant';
    group.userData.radius = 2.0 * scale; // Hitbox estimation for physics

    // Register with batcher for rendering
    group.userData.onPlacement = () => {
        LuminousPlantBatcher.getInstance().register(group);
        group.userData.onPlacement = null;
    };

    // Make it musically reactive just in case it needs collision or logic updates later
    return attachReactivity(group);
}

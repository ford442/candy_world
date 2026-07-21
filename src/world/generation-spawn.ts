import * as THREE from 'three';
import { animatedFoliage, cpuAnimatedFoliage } from './state.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';
import { safeAddFoliage } from './generation-entities.ts';
import {
    WeatherSystem, FoliageGrowthOptions, isPositionValid,
} from './generation-utils.ts';
import { create } from './foliage-registry.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';

/**
 * Weather-ecosystem growth spawn — kept out of generation-decorators so the
 * world-content chunk can stay dynamically loaded (#1361).
 */
export function spawnNearbyFoliage(
    origin: THREE.Vector3,
    type: string,
    options: FoliageGrowthOptions,
    weatherSystem: WeatherSystem | null = null
): void {
    if (animatedFoliage.length > 3000) return; // Hard cap

    const maxAttempts = 5;
    for (let i = 0; i < options.maxOffspring; i++) {
        if (Math.random() > options.spawnChanceBase) continue;

        let valid = false;
        let nx = 0, nz = 0;

        for (let a = 0; a < maxAttempts; a++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = (Math.random() * 0.5 + 0.5) * options.spawnRadius;
            nx = origin.x + Math.cos(angle) * dist;
            nz = origin.z + Math.sin(angle) * dist;

            if (isPositionValid(nx, nz, 1.0)) {
                let localCount = 0;
                for (const plant of cpuAnimatedFoliage) {
                    if (!plant || !plant.position) continue;
                    const dx = plant.position.x - nx;
                    const dz = plant.position.z - nz;
                    if (dx * dx + dz * dz < options.spawnRadius * options.spawnRadius) {
                        localCount++;
                    }
                }

                if (localCount < options.densityLimit) {
                    valid = true;
                    break;
                }
            }
        }

        if (valid) {
            const groundY = sampleGroundY(nx, nz);
            const obj = type === 'mushroom'
                ? create('mushroom', { size: 'regular', scale: 0.8 })
                : create(type);

            if (obj) {
                plantOnSurface(obj, nx, nz, { groundY, entityType: type });
                obj.userData.age = 0;
                obj.userData.lastSpawnTime = Date.now();
                const placed = safeAddFoliage(obj, false, 0.5, weatherSystem);
                if (!placed) {
                    recordSpawnAttempt('procedural_extra', false, new Error('CPU animation limit reached; object dropped'));
                } else {
                    recordSpawnAttempt('procedural_extra', true);
                }
            }
        }
    }
}

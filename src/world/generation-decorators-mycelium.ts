import * as THREE from 'three';
import { FEATURE_FLAGS } from '../core/config.ts';
import {
    createIntegratedSpores,
    registerIntegratedSystem,
} from '../particles/compute-integration.ts';
import { sampleEntityScale, biomeNormalizedDistance } from './entity-scale.ts';
import { create } from './foliage-registry.ts';
import { safeAddFoliage } from './generation-entities.ts';
import {
    MYCELIUM_GROVE,
    WeatherSystem,
    isPositionValid,
    yieldControl,
} from './generation-utils.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';

/**
 * Luminous Mycelium Realm — a grove of glass mushrooms wrapped in an ambient,
 * audio-reactive spore field. Companion biome to the Luminous Plants near Melody Lake.
 * Feature-flagged via FEATURE_FLAGS.myceliumRealm for safe boot.
 */
export async function populateMyceliumGrove(weatherSystem: WeatherSystem): Promise<void> {
    if (!FEATURE_FLAGS.myceliumRealm || !MYCELIUM_GROVE.enabled) {
        console.log('[World] Mycelium grove skipped (flag/disabled)');
        return;
    }

    console.log('[World] Populating Luminous Mycelium Realm...');
    const { centerX, centerZ, radius, mushroomCount, sporeCount } = MYCELIUM_GROVE;

    let placed = 0;
    for (let i = 0; i < mushroomCount; i++) {
        // Bias toward the centre (sqrt for area-uniform, squared to cluster inward).
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 1.6) * radius;
        const x = centerX + Math.cos(angle) * dist;
        const z = centerZ + Math.sin(angle) * dist;

        if (!isPositionValid(x, z, 1.0)) {
            recordSpawnAttempt('glass_mushroom', false, new Error('placement invalid'));
            continue;
        }
        const y = sampleGroundY(x, z);
        const normDist = biomeNormalizedDistance(centerX, centerZ, radius, x, z);
        const mushroom = create('glass_mushroom', {
            scale: sampleEntityScale('glass_mushroom', {
                biome: 'mycelium_grove',
                normalizedDistance: normDist,
            }),
        });
        if (!mushroom) {
            recordSpawnAttempt('glass_mushroom', false, new Error('factory returned null'));
            continue;
        }
        plantOnSurface(mushroom, x, z, { groundY: y, entityType: 'glass_mushroom' });
        mushroom.rotation.y = Math.random() * Math.PI * 2;
        const ok = safeAddFoliage(mushroom, true, 0.6, weatherSystem);
        recordSpawnAttempt('glass_mushroom', ok, ok ? undefined : new Error('placement failed'));
        if (ok) placed++;

        if (i % 8 === 7) await yieldControl();
    }

    // Ambient spore field — cyan/purple drift, audio-reactive blink. Registered for
    // per-frame compute updates so bass/melody drive intensity (zero-alloc hot path).
    const groundY = sampleGroundY(centerX, centerZ);
    const spores = createIntegratedSpores({
        count: sporeCount,
        areaSize: radius * 1.4,
        center: new THREE.Vector3(centerX, groundY + 2.5, centerZ),
        useCompute: true,
    });
    safeAddFoliage(spores, false, 0, weatherSystem);
    const sporeSystem = (spores as any).userData?.computeParticleSystem;
    if (sporeSystem) {
        registerIntegratedSystem('mycelium_spores', spores, sporeSystem);
    }

    console.log(
        `[World] Mycelium Realm populated (${placed}/${mushroomCount} glass mushrooms, ~${sporeCount} spores)`
    );
}

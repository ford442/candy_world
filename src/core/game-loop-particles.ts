import * as THREE from 'three';
import { updateCandyDebris } from '../foliage/candy-debris-batcher.ts';
import { updateMelodyRibbons } from '../foliage/ribbons.ts';
import { updateAllIntegratedSystems } from '../particles/compute-integration.ts';
import { updateEmitters } from '../particles/emitter-api.ts';
import { getParticles } from '../particles/lazy.ts';
import { fluidSystem } from '../systems/fluid_system.ts';
import { musicReactivitySystem } from '../systems/music-reactivity.ts';
import { player } from '../systems/physics/index.ts';
import { WeatherState } from '../systems/weather-types.ts';
import { profiler } from '../utils/profiler.ts';
import { cpuAnimatedFoliage } from '../world/state.ts';
import { getMelodyRibbon, getFluidFog } from './deferred-init.ts';
import {
    _scratchParticleAudioData,
    rendererRef,
    weatherSystemRef,
    cameraRef,
    safeSystemUpdate,
} from './game-loop-core.ts';

export function updateParticlesPhase(
    delta: number,
    t: number,
    audioState: any,
    isNightNow: boolean,
    isDeepNight: boolean
) {
    const melodyRibbon = getMelodyRibbon();
    const fluidFog = getFluidFog();

    profiler.measure('MusicReact', () => {
        safeSystemUpdate(
            () =>
                musicReactivitySystem.update(
                    t,
                    delta,
                    audioState,
                    weatherSystemRef!,
                    cpuAnimatedFoliage,
                    cameraRef!,
                    isNightNow,
                    isDeepNight
                ),
            'musicReactivitySystem'
        );
        if (melodyRibbon) updateMelodyRibbons(melodyRibbon, delta, audioState);
        profiler.measure('Particles', () => {
            _scratchParticleAudioData.low = audioState?.kickTrigger || 0;
            _scratchParticleAudioData.mid = 0.3;
            _scratchParticleAudioData.high = audioState?.energy || 0;
            _scratchParticleAudioData.beat = (audioState?.beatPhase || 0) < 0.1;
            _scratchParticleAudioData.groove = audioState?.grooveAmount || 0;
            _scratchParticleAudioData.windX = weatherSystemRef
                ? weatherSystemRef.windDirection.x
                : 0;
            _scratchParticleAudioData.windZ = weatherSystemRef
                ? weatherSystemRef.windDirection.z
                : 0;
            _scratchParticleAudioData.windSpeed =
                weatherSystemRef?.state === WeatherState.STORM ? 0.8 : 0.2;

            safeSystemUpdate(
                () =>
                    updateAllIntegratedSystems(
                        rendererRef,
                        delta,
                        player.position,
                        _scratchParticleAudioData
                    ),
                'updateAllIntegratedSystems'
            );

            // Emitter-API pools (gameplay bursts, debris, ability FX) are registered
            // separately so they are never dispatched twice.
            safeSystemUpdate(
                () =>
                    updateEmitters(rendererRef, delta, player.position, _scratchParticleAudioData),
                'updateEmitters'
            );

            // Opaque candy shards from ability impacts — CPU-integrated, one
            // InstancedMesh, so they light and shadow like world geometry.
            safeSystemUpdate(() => updateCandyDebris(delta), 'updateCandyDebris');
        });

        if (fluidFog && audioState) {
            fluidSystem.update(delta, audioState);

            const gridX = ((player.position.x + 100) / 200) * 128;
            const gridY = ((player.position.z + 100) / 200) * 128;

            if (gridX >= 0 && gridX < 128 && gridY >= 0 && gridY < 128) {
                const speed = player.velocity.lengthSq();
                if (speed > 1.0) {
                    fluidSystem.addDensity(gridX, gridY, speed * 0.2 * delta);
                    fluidSystem.addVelocity(
                        gridX,
                        gridY,
                        player.velocity.x * delta,
                        player.velocity.z * delta
                    );
                }
            }
        }
    });
}

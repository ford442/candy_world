import * as THREE from 'three';
import { StageLoader } from '../../debug/index.ts';
import {
    initExploreCamera,
    getExploreCamera,
    setExploreOrbitFlag,
} from '../camera-modes.ts';
import { CONFIG, CYCLE_DURATION } from '../config.ts';
import {
    uBloomStrength,
    uColorSaturation,
    uColorContrast,
    uVignetteStrength,
    uDofFocus,
    uDofMix,
    uShaftScatterBoost,
} from '../../foliage/post-processing.ts';
import { ensureGameplay } from '../../gameplay/lazy.ts';
import { getGroundHeight } from '../../systems/ground-system.ts';
import { InteractionSystem } from '../../systems/interaction.ts';
import { registerPhotoModeInit } from '../../systems/photo-mode/lazy.ts';
import { player } from '../../systems/physics/index.ts';
import { announcePolite } from '../../ui/announcer.ts';
import { profiler } from '../../utils/profiler.ts';
import { toggleOverlay } from '../../utils/startup-profiler.ts';
import { getWorldSeed } from '../../world/world-seed.ts';
import {
    initDeferredVisualsDependencies,
} from '../deferred-init.ts';
import { animate, initGameLoopDependencies, getGameTime } from '../game-loop.ts';
import { toggleDayNight, setInputSystem } from '../hud.ts';
import { initInput } from '../input/index.ts';
import type { MainContext } from './context.ts';
import { camera, renderer, scene } from './exports.ts';

const _scratchClickDir = new THREE.Vector3();
const _scratchClickOrigin = new THREE.Vector3();

export async function runInputPipeline(ctx: MainContext): Promise<void> {
    ctx.timeOffset = { value: 0 };

    await StageLoader.loadStage('input', () => {
        ctx.inputSystem = initInput(
            camera,
            ctx.audioSystem!,
            () => toggleDayNight(ctx.timeOffset),
            () => (player as any).isDancing
        );
        setInputSystem(ctx.inputSystem);
        ctx.controls = ctx.inputSystem.controls;
    });

    if (!ctx.inputSystem) {
        ctx.inputSystem = {
            controls: null,
            updateReticleState: () => {},

        };
    }

    await StageLoader.loadStage('interaction', () => {
        ctx.interactionSystem = new InteractionSystem(camera, ctx.inputSystem.updateReticleState);
    });

    if (!ctx.interactionSystem) {
        ctx.interactionSystem = {
            triggerClick: () => false,
            update: () => {},
            dispose: () => {},
        } as any;
    }

    initDeferredVisualsDependencies(scene, camera, renderer);

    const sceneInit = ctx.sceneInitResult!;
    await StageLoader.loadStage('gameLoop', () => {
        if (!ctx.interactionSystem) {
            console.warn('[gameLoop] InteractionSystem not initialized, using dummy');
            ctx.interactionSystem = {
                triggerClick: () => false,
                update: () => {},
                dispose: () => {},
            } as any;
        }
        initGameLoopDependencies({
            scene,
            camera,
            renderer,
            postProcessing: ctx.postProcessing,
            weatherSystem: ctx.weatherSystem!,
            audioSystem: ctx.audioSystem!,
            beatSync: ctx.beatSync!,
            interactionSystem: ctx.interactionSystem!,
            moon: ctx.moon,
            fireflies: null,
            controls: ctx.controls,
            sunLight: sceneInit.sunLight,
            ambientLight: sceneInit.ambientLight,
            sunGlow: sceneInit.sunGlow,
            sunCorona: sceneInit.sunCorona,
            lightShaftGroup: sceneInit.lightShaftGroup,
            sunGlowMat: sceneInit.sunGlowMat,
            coronaMat: sceneInit.coronaMat,
            uShaftOpacity: sceneInit.uShaftOpacity,
            timeOffset: ctx.timeOffset,
        });

        const canvasEl = document.getElementById('glCanvas') as HTMLCanvasElement | null;
        if (canvasEl && ctx.controls) {
            registerPhotoModeInit({
                camera,
                canvas: canvasEl,
                controls: ctx.controls,
                timeOffset: ctx.timeOffset,
                renderer,
                renderFrame: () => ctx.postProcessing.render(),
                getGameTime,
                cycleDuration: CYCLE_DURATION,
                postFx: {
                    uBloomStrength,
                    uColorSaturation,
                    uColorContrast,
                    uVignetteStrength,
                    uDofFocus,
                    uDofMix,
                    uShaftScatterBoost,
                },
                explore: {
                    getExploreCamera,
                    initExploreCamera,
                    setExploreOrbitFlag,
                },
                getWorldSeed,
                announcePolite,
            });
        }
    });

    window.addEventListener('keydown', (e) => {
        try {
            if (!e.key) return;
            const key = e.key.toLowerCase();
            if (key === 'p') {
                profiler.toggle();
            } else if (key === 'o' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
                toggleOverlay();
            } else if (key === 'f') {
                // Demo logic...
            } else if (key === 'g') {
                if (document.pointerLockElement) {
                    camera.getWorldDirection(_scratchClickDir);
                    void ensureGameplay().then((gp) => {
                        gp.glitchGrenadeSystem.throwGrenade(scene, camera.position, _scratchClickDir);
                    });
                }
            }
        } catch (err) {
            console.warn('Demo trigger error', err);
        }
    });

    window.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement) {
            if (e.button === 0) {
                const handled = ctx.interactionSystem?.triggerClick?.() ?? false;
                if (!handled) {
                    camera.getWorldDirection(_scratchClickDir);
                    _scratchClickOrigin.copy(camera.position).addScaledVector(_scratchClickDir, 1.0);
                    _scratchClickOrigin.y -= 0.2;
                    void ensureGameplay().then((gp) => {
                        gp.fireRainbow(scene, _scratchClickOrigin, _scratchClickDir);
                    });
                }
            }
        }
    });

    const initialGroundY = getGroundHeight(camera.position.x, camera.position.z);
    camera.position.y = initialGroundY + CONFIG.player.eyeHeight;
    player.position.copy(camera.position);
    player.velocity.set(0, 0, 0);
    console.log(`[Startup] Camera positioned at ground height: y=${camera.position.y.toFixed(2)}`);
}

import { CONFIG } from '../config.ts';
import { AudioSystem } from '../../audio/audio-system.ts';
import { BeatSync } from '../../audio/beat-sync.ts';
import type { WeatherSystem } from '../../systems/weather.ts';
import { musicReactivitySystem } from '../../systems/music-reactivity.ts';
import { validateNodeGeometries } from '../../foliage/index.ts';
import { initWorldCritical } from '../../world/generation.ts';
import { StageLoader } from '../../debug/index.ts';
import { scene, renderer } from './exports.ts';
import type { MainContext } from './context.ts';

export async function runAudioWorldPipeline(ctx: MainContext): Promise<void> {
    const { loadingScreen } = ctx;

    loadingScreen.startPhase('audio-init');
    console.time('Audio & Systems Init');

    await StageLoader.loadStage('audio', () => {
        ctx.audioSystem = new AudioSystem(CONFIG.audio.useScriptProcessorNode);
        (window as any).AudioSystem = ctx.audioSystem;
        loadingScreen.updateProgress(40, 'Creating audio system...');
        ctx.beatSync = new BeatSync(ctx.audioSystem!);
    });

    await StageLoader.loadStage('weather', async () => {
        loadingScreen.updateProgress(70, 'Initializing weather system...');
        const { loadWeatherSystem } = await import('../../systems/weather/lazy.ts');
        ctx.weatherSystem = (await loadWeatherSystem(scene, renderer as any)) as WeatherSystem;
    });

    console.timeEnd('Audio & Systems Init');
    loadingScreen.updateProgress(100);
    loadingScreen.completePhase('audio-init');

    loadingScreen.startPhase('world-generation');
    console.time('World Generation');
    loadingScreen.updateProgress(10, 'Loading critical world...');

    await StageLoader.loadStage('worldCritical', async () => {
        loadingScreen.updateProgress(20, 'Generating terrain...');
        const result = await initWorldCritical(scene, ctx.weatherSystem!);
        ctx.moon = result.moon;
        loadingScreen.updateProgress(90, 'World objects ready...');
    });

    console.timeEnd('World Generation');
    loadingScreen.updateProgress(100, 'Base world ready');
    loadingScreen.completePhase('world-generation');

    await StageLoader.loadStage('musicReactivity', () => {
        musicReactivitySystem.init(scene, ctx.weatherSystem!, ctx.beatSync);
        if (ctx.moon) {
            musicReactivitySystem.registerMoon(ctx.moon);
        }

        const audioSystem = ctx.audioSystem;
        if (audioSystem) {
            if (audioSystem.onNote) {
                audioSystem.onNote((note: string, velocity: number, channel: number) => {
                    musicReactivitySystem.handleNoteOn(note, velocity, channel);
                });
            } else if (audioSystem.setNoteCallback) {
                audioSystem.setNoteCallback((note: string, velocity: number, channel: number) => {
                    musicReactivitySystem.handleNoteOn(note, velocity, channel);
                });
            }
        }
    });

    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => validateNodeGeometries(scene), { timeout: 3000 });
    } else {
        setTimeout(() => validateNodeGeometries(scene), 100);
    }
}

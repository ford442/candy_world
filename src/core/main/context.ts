import type { AudioSystem } from '../../audio/audio-system.ts';
import type { BeatSync } from '../../audio/beat-sync.ts';
import type { InteractionSystem } from '../../systems/interaction.ts';
import type { WeatherSystem } from '../../systems/weather.ts';
import type { initLoadingScreen } from '../../ui/loading-screen.ts';
import type { initScene } from '../init.ts';

export type SceneInitResult = NonNullable<Awaited<ReturnType<typeof initScene>>>;
export type LoadingScreen = ReturnType<typeof initLoadingScreen>;

/** Mutable runtime state shared across bootstrap pipeline modules. */
export interface MainContext {
    loadingScreen: LoadingScreen;
    waitForFullPopulation: boolean;
    worldGenerationActive: boolean;
    sceneInitResult?: SceneInitResult;
    mode: SceneInitResult['mode'];
    postProcessing: any;
    audioSystem?: AudioSystem;
    beatSync?: BeatSync;
    weatherSystem?: WeatherSystem;
    moon?: any;
    timeOffset: { value: number };
    inputSystem: any;
    controls: any;
    interactionSystem: InteractionSystem;
}

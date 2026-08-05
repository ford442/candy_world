import type * as THREE from 'three';
import type { WeatherSystem } from './weather.ts';

let weatherSystemInstance: WeatherSystem | null = null;
let weatherSystemPromise: Promise<typeof import('./weather.ts')> | null = null;

export async function loadWeatherSystem(scene: THREE.Scene, renderer?: THREE.WebGLRenderer): Promise<WeatherSystem> {
    if (weatherSystemInstance) {
        if (renderer) weatherSystemInstance.setRenderer(renderer);
        return weatherSystemInstance;
    }

    if (!weatherSystemPromise) {
        weatherSystemPromise = import('./weather.ts');
    }

    const { WeatherSystem } = await weatherSystemPromise;
    weatherSystemInstance = new WeatherSystem(scene);
    if (renderer) {
        weatherSystemInstance.setRenderer(renderer);
    }
    return weatherSystemInstance;
}

export function getWeatherSystem(): WeatherSystem | null {
    return weatherSystemInstance;
}

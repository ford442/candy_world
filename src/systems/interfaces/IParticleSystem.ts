import * as THREE from 'three';

export interface IParticleSystem {
    percussionRain: THREE.Points | null;
    melodicMist: THREE.Points | null;

    init(scene: THREE.Scene): void;
    update(time: number, bassIntensity: number, melodyVol: number, weatherState: string, weatherType: string, intensity: number): void;
    dispose(scene: THREE.Scene): void;
}

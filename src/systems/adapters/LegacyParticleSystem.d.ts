import * as THREE from 'three';

export interface WeatherState {
  bassIntensity: number;
  melodyVol: number;
  weatherType: string;
  weatherState: string;
  intensity: number;
}

/**
 * Legacy particle system for weather effects
 */
export class LegacyParticleSystem {
  percussionRain: THREE.Points | null;
  melodicMist: THREE.Points | null;

  constructor();
  
  /**
   * Initialize the particle system
   */
  init(scene: THREE.Scene): void;
  
  /**
   * Update particle system
   */
  update(
    time: number,
    bassIntensity: number,
    melodyVol: number,
    weatherState: string,
    weatherType: string,
    intensity: number
  ): void;
  
  /**
   * Update rain particles
   */
  updatePercussionRain(
    time: number,
    bassIntensity: number,
    weatherState: string,
    weatherType: string,
    intensity: number
  ): void;
  
  /**
   * Update mist particles
   */
  updateMelodicMist(
    time: number,
    melodyVol: number,
    weatherState: string,
    weatherType: string
  ): void;
  
  /**
   * Dispose of resources
   */
  dispose(): void;
}

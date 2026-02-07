import * as THREE from 'three';

export type ImpactType = 
  | 'jump' 
  | 'land' 
  | 'dash' 
  | 'berry' 
  | 'snare' 
  | 'mist' 
  | 'rain' 
  | 'trail' 
  | 'muzzle' 
  | 'spore';

export interface ImpactOptions {
  color?: { r: number; g: number; b: number };
  direction?: { x: number; y: number; z: number };
}

/**
 * Creates the global impact particle system
 */
export function createImpactSystem(): THREE.InstancedMesh;

/**
 * Spawns an impact effect at the given position
 * @param pos - World position for the impact
 * @param type - Type of impact effect
 * @param options - Optional color and direction overrides
 */
export function spawnImpact(
  pos: THREE.Vector3 | { x: number; y: number; z: number },
  type?: ImpactType,
  options?: ImpactOptions
): void;

import * as THREE from 'three';

export type FoliageType = 'grass' | 'flower' | 'tree' | 'shrub' | 'vine' | 'orb' | 'cloud' | 'starflower' | string;

export interface FoliageUserData {
  animationType?: string;
  animationOffset?: number;
  type?: FoliageType;
  originalY?: number;
  [key: string]: any; // For additional extensible properties
}

export interface CreateFoliageOptions {
  color?: number;
  shape?: string;
  size?: number;
  length?: number;
}

export interface InitGrassSystemResult extends Array<THREE.InstancedMesh<any, any>> {}

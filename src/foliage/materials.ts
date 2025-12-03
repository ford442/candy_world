import * as THREE from 'three';
import type { FoliageUserData } from './types';

export function createClayMaterial(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.0,
        roughness: 0.8,
        flatShading: false
    });
}

export const foliageMaterials: Record<string, THREE.Material> & { flowerPetal: THREE.Material[] } = {
    grass: createClayMaterial(0x7CFC00),
    flowerStem: createClayMaterial(0x228B22),
    flowerCenter: createClayMaterial(0xFFFACD),
    flowerPetal: [
        createClayMaterial(0xFF69B4),
        createClayMaterial(0xBA55D3),
        createClayMaterial(0x87CEFA)
    ],
    lightBeam: new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })
};

export const reactiveMaterials: THREE.Material[] = [];

export function registerReactiveMaterial(mat: THREE.Material) {
    if (reactiveMaterials.length < 3000) reactiveMaterials.push(mat);
}

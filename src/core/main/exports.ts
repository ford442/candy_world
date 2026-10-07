import type * as THREE from 'three';
import { player } from '../../systems/physics/index.ts';
import { addCameraShake } from '../game-loop.ts';
import type { CandyRenderer } from '../init.ts';

// Assigned once by scene-pipeline.ts when the core scene is up; read-only for everyone else.
export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let renderer: CandyRenderer;

export { player, addCameraShake };

export function assignCoreExports(
    nextScene: THREE.Scene,
    nextCamera: THREE.PerspectiveCamera,
    nextRenderer: CandyRenderer
): void {
    scene = nextScene;
    camera = nextCamera;
    renderer = nextRenderer;
}

import { player } from '../../systems/physics/index.ts';
import { addCameraShake } from '../game-loop.ts';

export let scene: any;
export let camera: any;
export let renderer: any;

export { player, addCameraShake };

export function assignCoreExports(nextScene: any, nextCamera: any, nextRenderer: any): void {
    scene = nextScene;
    camera = nextCamera;
    renderer = nextRenderer;
}

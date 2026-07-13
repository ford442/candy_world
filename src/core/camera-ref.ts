import * as THREE from 'three';

export let camera: THREE.PerspectiveCamera | null = null;
export function setCameraRef(c: THREE.PerspectiveCamera) {
    camera = c;
}

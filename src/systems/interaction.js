import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class InteractionSystem {
    constructor(camera, reticleCallback) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();

        // Use CONFIG if available, otherwise fallback
        this.raycaster.far = CONFIG?.interaction?.maxDistance || 50;

        this.hoveredObject = null;
        this.nearbyObjects = new Set();
        this.reticleCallback = reticleCallback;

        // Load settings
        this.proximityRadius = CONFIG?.interaction?.proximityRadius || 12.0;
        this.interactionDistance = CONFIG?.interaction?.interactionDistance || 8.0;
    }

    update(dt, playerPosition, interactables) {
        // Safety: Check if interactables is valid
        if (!interactables || !Array.isArray(interactables)) return;

        // 1. PROXIMITY CHECK
        const currentNearby = new Set();

        interactables.forEach(obj => {
            // Safety: Skip invalid objects or those without position
            if (!obj || !obj.position || !obj.visible) return;

            const dist = playerPosition.distanceTo(obj.position);

            if (dist < this.proximityRadius) {
                currentNearby.add(obj);

                if (!this.nearbyObjects.has(obj)) {
                    if (obj.userData?.onProximityEnter) {
                        try { obj.userData.onProximityEnter(dist); } catch(e) { console.warn('Proximity Error:', e); }
                    }
                }
            } else {
                if (this.nearbyObjects.has(obj)) {
                    if (obj.userData?.onProximityLeave) {
                        try { obj.userData.onProximityLeave(); } catch(e) { console.warn('Proximity Leave Error:', e); }
                    }
                    if (this.hoveredObject === obj) this.handleHover(null);
                }
            }
        });

        this.nearbyObjects = currentNearby;

        // 2. GAZE CHECK
        const candidates = Array.from(this.nearbyObjects);

        if (candidates.length > 0) {
            this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

            try {
                // Recursive raycast can crash on malformed geometry.
                // We wrap it to prevent game loop termination.
                const intersects = this.raycaster.intersectObjects(candidates, true);

                if (intersects.length > 0) {
                    let hitObj = intersects[0].object;
                    let rootObj = null;
                    const hitDist = intersects[0].distance;

                    // Bubble up to find the logic root (the Group with userData)
                    let depth = 0;
                    while (hitObj && depth < 10) {
                        if (candidates.includes(hitObj)) {
                            rootObj = hitObj;
                            break;
                        }
                        hitObj = hitObj.parent;
                        depth++;
                    }

                    if (rootObj && hitDist < this.interactionDistance) {
                        this.handleHover(rootObj);
                        return;
                    }
                }
            } catch (err) {
                // Suppress specific Raycaster errors to keep game running
                if (Math.random() < 0.01) console.warn("Interaction Raycast Warning:", err);
            }
        }

        this.handleHover(null);
    }

    handleHover(object) {
        if (this.hoveredObject === object) return;

        // Leave old
        if (this.hoveredObject && this.hoveredObject.userData?.onGazeLeave) {
            try { this.hoveredObject.userData.onGazeLeave(); } catch(e) {}
        }

        // Enter new
        this.hoveredObject = object;

        if (this.hoveredObject) {
            if (this.hoveredObject.userData?.onGazeEnter) {
                try { this.hoveredObject.userData.onGazeEnter(); } catch(e) {}
            }
            if (this.reticleCallback) this.reticleCallback('hover');
        } else {
            if (this.reticleCallback) this.reticleCallback('idle');
        }
    }

    triggerClick() {
        if (this.hoveredObject && this.hoveredObject.userData?.onInteract) {
            try {
                this.hoveredObject.userData.onInteract();
                if (this.reticleCallback) {
                    this.reticleCallback('interact');
                    setTimeout(() => this.reticleCallback('hover'), 150);
                }
                return true;
            } catch(e) {
                console.warn("Interact Error", e);
            }
        }
        return false;
    }
}

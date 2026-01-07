// src/systems/interaction.js
import * as THREE from 'three';

export class InteractionSystem {
    constructor(camera, reticleCallback) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 50; // Max interact distance

        // Track states
        this.hoveredObject = null;
        this.nearbyObjects = new Set();

        this.reticleCallback = reticleCallback; // Function to update UI cursor

        // Configuration
        this.proximityRadius = 10.0; // Distance for "waking up"
        this.interactionDistance = 6.0; // Max distance to gaze/click
    }

    update(dt, playerPosition, interactables) {
        // 1. PROXIMITY CHECK (Are you close?)
        const currentNearby = new Set();

        interactables.forEach(obj => {
            if (!obj.visible) return;

            const dist = playerPosition.distanceTo(obj.position);

            if (dist < this.proximityRadius) {
                currentNearby.add(obj);

                // Trigger 'Enter Proximity'
                if (!this.nearbyObjects.has(obj)) {
                    if (obj.userData.onProximityEnter) obj.userData.onProximityEnter(dist);
                }
            } else {
                // Trigger 'Leave Proximity'
                if (this.nearbyObjects.has(obj)) {
                    if (obj.userData.onProximityLeave) obj.userData.onProximityLeave();

                    // Safety: If we walk away while looking at it, cancel the gaze too
                    if (this.hoveredObject === obj) this.handleHover(null);
                }
            }
        });

        this.nearbyObjects = currentNearby;

        // 2. GAZE CHECK (Are you pointing at it?)
        // Only check objects that are already nearby (Optimization)
        const candidates = Array.from(this.nearbyObjects);

        if (candidates.length > 0) {
            this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

            // recursive: true ensures we hit child meshes of the Group
            const intersects = this.raycaster.intersectObjects(candidates, true);

            if (intersects.length > 0) {
                // We likely hit a mesh inside a Group. Bubble up to find the main object.
                let hitObj = intersects[0].object;
                let rootObj = null;
                const hitDist = intersects[0].distance;

                // Traverse up until we find one of our candidate objects
                while (hitObj) {
                    if (candidates.includes(hitObj)) {
                        rootObj = hitObj;
                        break;
                    }
                    hitObj = hitObj.parent;
                }

                if (rootObj && hitDist < this.interactionDistance) {
                    this.handleHover(rootObj);
                    return;
                }
            }
        }

        // If we hit nothing, clear hover
        this.handleHover(null);
    }

    handleHover(object) {
        if (this.hoveredObject === object) return; // No change

        // 1. Un-hover previous
        if (this.hoveredObject) {
            if (this.hoveredObject.userData.onGazeLeave) {
                this.hoveredObject.userData.onGazeLeave();
            }
        }

        // 2. Hover new
        this.hoveredObject = object;

        if (this.hoveredObject) {
            if (this.hoveredObject.userData.onGazeEnter) {
                this.hoveredObject.userData.onGazeEnter();
            }
            // Visual feedback: Cursor gets big
            if (this.reticleCallback) this.reticleCallback('hover');
        } else {
            // Visual feedback: Cursor back to normal
            if (this.reticleCallback) this.reticleCallback('idle');
        }
    }

    triggerClick() {
        if (this.hoveredObject && this.hoveredObject.userData.onInteract) {
            this.hoveredObject.userData.onInteract();

            // Visual feedback: Cursor click animation
            if (this.reticleCallback) {
                this.reticleCallback('interact');
                setTimeout(() => this.reticleCallback('hover'), 150);
            }
            return true; // Handled
        }
        return false; // Not handled
    }
}

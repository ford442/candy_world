import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class InteractionSystem {
    constructor(camera, reticleCallback) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();

        // Use CONFIG if available, otherwise fallback
        this.raycaster.far = CONFIG?.interaction?.maxDistance || 50;

        this.hoveredObject = null;

        // ⚡ OPTIMIZATION: Double-buffered Sets to avoid 'new Set()' every frame
        this._nearbySetA = new Set();
        this._nearbySetB = new Set();
        this.nearbyObjects = this._nearbySetA; // Points to the "Previous Frame" set initially

        // ⚡ OPTIMIZATION: Reusable scratch array for raycast candidates
        this._candidatesScratch = [];

        // ⚡ OPTIMIZATION: Reusable Vector2 for raycasting to avoid per-frame allocation
        this._scratchVec2 = new THREE.Vector2(0, 0);

        this.reticleCallback = reticleCallback;

        // Load settings
        this.proximityRadius = CONFIG?.interaction?.proximityRadius || 12.0;
        this.interactionDistance = CONFIG?.interaction?.interactionDistance || 8.0;
    }

    // ⚡ OPTIMIZATION: Accepts multiple arrays to avoid [...a, ...b] allocation in main loop
    update(dt, playerPosition, ...interactableLists) {
        // Swap sets: 'nearbyObjects' becomes 'prevNearby', and we fill 'nextNearby'
        const prevNearby = this.nearbyObjects;
        const nextNearby = (prevNearby === this._nearbySetA) ? this._nearbySetB : this._nearbySetA;
        nextNearby.clear();

        // 1. PROXIMITY CHECK
        // Populate nextNearby with ALL close objects from all input lists
        for (let i = 0; i < interactableLists.length; i++) {
            const list = interactableLists[i];
            if (!list || !Array.isArray(list)) continue;

            const len = list.length;
            for (let j = 0; j < len; j++) {
                const obj = list[j];
                // Safety: Skip invalid objects or those without position
                if (!obj || !obj.position || !obj.visible) continue;

                // ⚡ OPTIMIZATION: Calculate distance once per object
                // We use standard distanceTo for strict parity with legacy logic.
                const dist = playerPosition.distanceTo(obj.position);

                if (dist < this.proximityRadius) {
                    nextNearby.add(obj);
                }
            }
        }

        // Check for Enters (Object is in Next but was not in Prev)
        for (const obj of nextNearby) {
            if (!prevNearby.has(obj)) {
                 if (obj.userData?.onProximityEnter) {
                     try { obj.userData.onProximityEnter(playerPosition.distanceTo(obj.position)); } catch(e) { console.warn('Proximity Enter Error:', e); }
                 }
            }
        }

        // Check for Leaves (Object was in Prev but is not in Next)
        for (const obj of prevNearby) {
            if (!nextNearby.has(obj)) {
                if (obj.userData?.onProximityLeave) {
                    try { obj.userData.onProximityLeave(); } catch(e) { console.warn('Proximity Leave Error:', e); }
                }
                if (this.hoveredObject === obj) this.handleHover(null);
            }
        }

        // Update pointer for next frame
        this.nearbyObjects = nextNearby;

        // 2. GAZE CHECK
        // Populate scratch array from the Set
        this._candidatesScratch.length = 0;
        for (const obj of this.nearbyObjects) {
            // Extra Safety: Ensure root object is valid before raycasting
            if (obj && obj.visible !== false) {
                this._candidatesScratch.push(obj);
            }
        }

        const candidates = this._candidatesScratch;

        if (candidates.length > 0) {
            // ⚡ OPTIMIZATION: Use scratch vector
            this._scratchVec2.set(0, 0);
            this.raycaster.setFromCamera(this._scratchVec2, this.camera);

            // CRITICAL: Wrap raycast in try/catch to handle malformed geometry.
            // When using recursive=true, Raycaster visits all children.
            // If any child is a Mesh with undefined geometry (e.g., loading state),
            // accessing 'boundingSphere' will throw a TypeError.
            try {
                const intersects = this.raycaster.intersectObjects(candidates, true);

                if (intersects.length > 0) {
                    let hitObj = intersects[0].object;
                    let rootObj = null;
                    const hitDist = intersects[0].distance;

                    // Bubble up to find the logic root (the Group with userData)
                    let depth = 0;

                    while (hitObj && depth < 10) {
                        // We check if this ancestor is one of our tracked interactables
                        if (this.nearbyObjects.has(hitObj)) {
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
                // Suppress "boundingSphere of undefined" errors caused by uninitialized meshes
                // This keeps the game loop running even if one object is glitches.
                if (err instanceof TypeError && err.message.includes('boundingSphere')) {
                    // Known safe error, ignore
                } else {
                    if (Math.random() < 0.01) console.warn("Interaction Raycast Warning:", err);
                }
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

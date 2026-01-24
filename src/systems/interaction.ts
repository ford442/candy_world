import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';

// Define interface for interactive objects with userdata
export interface InteractiveObject extends THREE.Object3D {
    userData: {
        onProximityEnter?: (distance: number) => void;
        onProximityLeave?: () => void;
        onGazeEnter?: () => void;
        onGazeLeave?: () => void;
        onInteract?: () => void;
        // Other possible userData properties
        [key: string]: any;
    };
    visible: boolean;
    parent: THREE.Object3D | null;
}

// Callback type for reticle updates
export type ReticleCallback = (state: 'idle' | 'hover' | 'interact', label?: string) => void;

export class InteractionSystem {
    camera: THREE.Camera;
    raycaster: THREE.Raycaster;
    hoveredObject: InteractiveObject | null;

    // Using Set<InteractiveObject> but we might need to cast from Object3D
    _nearbySetA: Set<InteractiveObject>;
    _nearbySetB: Set<InteractiveObject>;
    nearbyObjects: Set<InteractiveObject>;

    _candidatesScratch: InteractiveObject[];
    _scratchVec2: THREE.Vector2;
    reticleCallback: ReticleCallback | null;

    proximityRadius: number;
    interactionDistance: number;

    constructor(camera: THREE.Camera, reticleCallback: ReticleCallback | null) {
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
    update(dt: number, playerPosition: THREE.Vector3, ...interactableLists: (THREE.Object3D[] | undefined)[]) {
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
                const obj = list[j] as InteractiveObject;
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
                // Raycaster.intersectObjects accepts Object3D[], but candidates is InteractiveObject[].
                // InteractiveObject extends Object3D, so this is valid.
                const intersects = this.raycaster.intersectObjects(candidates, true);

                if (intersects.length > 0) {
                    let hitObj = intersects[0].object as unknown as InteractiveObject; // Start with the mesh hit
                    let rootObj: InteractiveObject | null = null;
                    const hitDist = intersects[0].distance;

                    // Bubble up to find the logic root (the Group with userData)
                    let depth = 0;

                    while (hitObj && depth < 10) {
                        // We check if this ancestor is one of our tracked interactables
                        if (this.nearbyObjects.has(hitObj)) {
                            rootObj = hitObj;
                            break;
                        }
                        hitObj = hitObj.parent as InteractiveObject;
                        depth++;
                    }

                    if (rootObj && hitDist < this.interactionDistance) {
                        this.handleHover(rootObj);
                        return;
                    }
                }
            } catch (err: any) {
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

    handleHover(object: InteractiveObject | null) {
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
            if (this.reticleCallback) {
                const label = this.getLabel(this.hoveredObject);
                this.reticleCallback('hover', label);
            }
        } else {
            if (this.reticleCallback) this.reticleCallback('idle');
        }
    }

    private getLabel(object: InteractiveObject): string {
        if (object.userData?.interactionText) return object.userData.interactionText;
        if (object.userData?.type) {
            const type = object.userData.type;
            // Simple fallback formatting
            return type.charAt(0).toUpperCase() + type.slice(1);
        }
        return '';
   }

    triggerClick(): boolean {
        if (this.hoveredObject && this.hoveredObject.userData?.onInteract) {
            try {
                this.hoveredObject.userData.onInteract();
                if (this.reticleCallback) {
                    this.reticleCallback('interact');
                    // Restore hover state with label
                    setTimeout(() => {
                        if (this.reticleCallback && this.hoveredObject) {
                            const label = this.getLabel(this.hoveredObject);
                            this.reticleCallback('hover', label);
                        }
                    }, 150);
                }
                return true;
            } catch(e) {
                console.warn("Interact Error", e);
            }
        }
        return false;
    }
}

import * as THREE from 'three';

const _inverseMatrix = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _vA = new THREE.Vector3();

// --- Mixin: Analytic Raycast ---

/**
 * Attaches an analytic raycast function to the group, making it interactive
 * without needing a child Mesh.
 *
 * Supports a vertical Cylinder aligned with local Y-axis [0, height].
 */
export function makeInteractiveCylinder(group: THREE.Object3D, height: number, radius: number) {
    // We override the raycast method on this specific instance
    // THREE.Object3D.prototype.raycast is usually empty
    group.raycast = function(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
        const matrixWorld = this.matrixWorld;
        _inverseMatrix.copy(matrixWorld).invert();
        _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

        // Infinite Cylinder: x^2 + z^2 <= r^2
        const dx = _ray.direction.x;
        const dz = _ray.direction.z;
        const ox = _ray.origin.x;
        const oz = _ray.origin.z;

        const A = dx * dx + dz * dz;
        const B = 2 * (ox * dx + oz * dz);
        const C = ox * ox + oz * oz - radius * radius;

        if (Math.abs(A) < 0.0001) {
            // Ray parallel to Y-axis
            // If inside cylinder, check caps?
            // Usually we can ignore exact parallel unless looking straight down
            // If inside radius, it hits top/bottom cap?
            if (C <= 0) {
                 // Inside infinite cylinder. Check Y bounds.
                 // Entry at -Infinity, Exit at +Infinity
                 // Just check if ray intersects [0, height] interval
                 // Intersects top cap at y=height?
                 // t = (height - oy) / dy
                 // This is getting complex for parallel case. Skip for now.
            }
            return;
        }

        const det = B * B - 4 * A * C;
        if (det < 0) return;

        const sqrtDet = Math.sqrt(det);
        const t1 = (-B - sqrtDet) / (2 * A);
        const t2 = (-B + sqrtDet) / (2 * A);

        // Check intersection points for Y bounds [0, height]
        // We want the closest positive t
        let tHit = -1;

        // Function to check validity
        const check = (t: number) => {
            if (t < 0) return false; // Behind ray
            // Distance check (approximate in local space, but raycaster uses world distance later)
            // Wait, we need to check if point is within [near, far] in WORLD space.
            // But for selection, just check positive t first.
            const y = _ray.origin.y + t * _ray.direction.y;
            return y >= 0 && y <= height;
        };

        if (check(t1)) {
            tHit = t1;
            // If t2 is also valid and closer (unlikely for external ray), use t2?
            // t1 is always smaller than t2 (since A > 0 usually).
            // A = dx^2 + dz^2 > 0.
            // So t1 is entry, t2 is exit.
            // If inside, t1 might be negative.
            if (t1 < 0 && check(t2)) tHit = t2;
        } else if (check(t2)) {
            tHit = t2;
        }

        if (tHit !== -1) {
             // Calculate World Intersection Point
             _vA.copy(_ray.direction).multiplyScalar(tHit).add(_ray.origin);
             _vA.applyMatrix4(matrixWorld);

             // ⚡ OPTIMIZATION: Delayed Math.sqrt calculation until after early bounds check
             const distSq = raycaster.ray.origin.distanceToSquared(_vA);
             if (distSq < raycaster.near * raycaster.near || distSq > raycaster.far * raycaster.far) return;

             intersects.push({
                 distance: Math.sqrt(distSq),
                 point: _vA.clone(),
                 object: this,
                 uv: undefined
             });
        }
    };
}

/**
 * Attaches an analytic raycast function to the group, making it interactive
 * without needing a child Mesh.
 *
 * Supports a Sphere centered at local (0, height, 0) with radius R.
 */
export function makeInteractiveSphere(group: THREE.Object3D, radius: number, heightOffset: number = 0) {
    group.raycast = function(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
        const matrixWorld = this.matrixWorld;
        _inverseMatrix.copy(matrixWorld).invert();
        _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

        // Sphere Check at (0, heightOffset, 0)
        // Shift ray origin to pretend sphere is at (0,0,0)
        _ray.origin.y -= heightOffset;

        // Ray-Sphere Intersection: |O + tD|^2 = R^2
        // |D|^2 * t^2 + 2(O.D)t + |O|^2 - R^2 = 0
        // |D|=1? No, ray direction might not be normalized in local space if scale is non-uniform.
        // But assuming uniform scale or ignored scale:
        const D2 = _ray.direction.lengthSq();
        const OD = _ray.origin.dot(_ray.direction);
        const O2 = _ray.origin.lengthSq();

        const A = D2;
        const B = 2 * OD;
        const C = O2 - radius * radius;

        const det = B * B - 4 * A * C;
        if (det < 0) return;

        const sqrtDet = Math.sqrt(det);
        const t1 = (-B - sqrtDet) / (2 * A);
        const t2 = (-B + sqrtDet) / (2 * A);

        let tHit = -1;

        // Restore Ray Origin for correct point calculation
        _ray.origin.y += heightOffset;

        if (t1 >= 0) tHit = t1;
        else if (t2 >= 0) tHit = t2;

        if (tHit !== -1) {
             _vA.copy(_ray.direction).multiplyScalar(tHit).add(_ray.origin);
             _vA.applyMatrix4(matrixWorld);

             // ⚡ OPTIMIZATION: Delayed Math.sqrt calculation until after early bounds check
             const distSq = raycaster.ray.origin.distanceToSquared(_vA);
             if (distSq < raycaster.near * raycaster.near || distSq > raycaster.far * raycaster.far) return;

             intersects.push({
                 distance: Math.sqrt(distSq),
                 point: _vA.clone(),
                 object: this,
                 uv: undefined
             });
        }
    };
}

/**
 * Standard interactive mixin.
 * Initializes userData for hover/interact states and adds basic visual feedback.
 */
export function makeInteractive(group: THREE.Object3D) {
    if (!group.userData) group.userData = {};

    // Store original scale if not already stored
    if (!group.userData.originalScale) {
        group.userData.originalScale = group.scale.clone();
    }
    const originalScale = group.userData.originalScale;

    // Standard visual feedback: Scale up on hover
    // Users can override these handlers by overwriting userData.onGazeEnter
    // but typically they chain them.

    group.userData.onGazeEnter = () => {
        group.scale.copy(originalScale).multiplyScalar(1.1);
        group.userData.isHovered = true;
    };

    group.userData.onGazeLeave = () => {
        group.scale.copy(originalScale);
        group.userData.isHovered = false;
    };

    group.userData.onInteract = () => {
        // Simple visual feedback (spin or pulse)
        // Since we don't have tweening here easily, we rely on system updates
        // or just a momentary scale bump
        // group.scale.multiplyScalar(1.2); // Just for a frame, logic loop will reset it if using lerp
    };

    return group;
}

/**
 * Traps keyboard focus within a specified HTML element.
 * Useful for accessibility in modals and overlay menus.
 * @param element - The HTMLElement to trap focus within.
 * @returns A cleanup function to remove the event listener when the modal closes.
 */
export function trapFocusInside(element: HTMLElement): () => void {
    // 1. Select all potentially focusable elements within the modal
    const focusableSelectors = [
        'a[href]', 'button:not([disabled])', 'textarea',
        'input[type="text"]:not([disabled])', 'input[type="radio"]:not([disabled])',
        'input[type="checkbox"]:not([disabled])', 'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    const handleKeyDown = (e: KeyboardEvent) => {
        const isTabPressed = e.key === 'Tab' || e.keyCode === 9;

        if (!isTabPressed) {
            return; // Only intercept Tab keys
        }

        // Get current focusable elements (queried on keydown in case the DOM changed)
        const focusableEls = Array.from(element.querySelectorAll<HTMLElement>(focusableSelectors))
            .filter(el => el.offsetParent !== null); // Ensure they are visibly rendered

        if (focusableEls.length === 0) return;

        const firstFocusableEl = focusableEls[0];
        const lastFocusableEl = focusableEls[focusableEls.length - 1];

        if (e.shiftKey) /* Shift + Tab */ {
            if (document.activeElement === firstFocusableEl) {
                lastFocusableEl.focus();
                e.preventDefault(); // Prevent default browser tab behavior
            }
        } else /* Tab */ {
            if (document.activeElement === lastFocusableEl) {
                firstFocusableEl.focus();
                e.preventDefault();
            }
        }
    };

    // 2. Attach the listener
    element.addEventListener('keydown', handleKeyDown);

    // 3. Auto-focus the first element when triggered
    const initialFocusableEls = element.querySelectorAll<HTMLElement>(focusableSelectors);
    if (initialFocusableEls.length > 0) {
        initialFocusableEls[0].focus();
    }

    // 4. Return a cleanup function to prevent memory leaks
    return function cleanup() {
        element.removeEventListener('keydown', handleKeyDown);
    };
}

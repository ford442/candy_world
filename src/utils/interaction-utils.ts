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

             const dist = raycaster.ray.origin.distanceTo(_vA);
             if (dist < raycaster.near || dist > raycaster.far) return;

             intersects.push({
                 distance: dist,
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

             const dist = raycaster.ray.origin.distanceTo(_vA);
             if (dist < raycaster.near || dist > raycaster.far) return;

             intersects.push({
                 distance: dist,
                 point: _vA.clone(),
                 object: this,
                 uv: undefined
             });
        }
    };
}

const fs = require('fs');

const path = 'src/systems/music-reactivity.ts';
let code = fs.readFileSync(path, 'utf-8');

const target = `
        for (let i = 0; i < cpuAnimatedFoliage.length; i++) {
        const obj = cpuAnimatedFoliage[i];
        if (!obj) continue;
        totalObjects++;

        // ⚡ PERFORMANCE: Size-based culling distances
        let cullDistanceSq = 22500; // 150 * 150 Default

        const objType = obj.userData.type;
        const objSize = obj.userData.size;
        const objRadius = obj.userData.radius || 2.0;

        if (objType === 'flower') {
            cullDistanceSq = 6400; // 80 * 80
        } else if (objType === 'mushroom') {
            // Unreachable if we skip above, but kept for logic safety
            if (objSize === 'giant') {
            cullDistanceSq = 40000; // 200 * 200
            } else {
            cullDistanceSq = 14400; // 120 * 120
            }
        } else if (objType === 'tree' || objType === 'shrub') {
            cullDistanceSq = 22500; // 150 * 150
        } else if (objType === 'cloud') {
            cullDistanceSq = 62500; // 250 * 250
        }

        // Distance Culling
        // ⚡ OPTIMIZATION: Bypassed THREE.Vector3.distanceToSquared() overhead in hot loop with raw math
        const ox = obj.position.x;
        const oy = obj.position.y;
        const oz = obj.position.z;
        const distSq = (cx - ox) * (cx - ox) + (cy - oy) * (cy - oy) + (cz - oz) * (cz - oz);

        if (distSq > cullDistanceSq) {
            culledByDistance++;
            continue;
        }

        // Frustum Culling
        let isVisible = false;
        if (obj.geometry && obj.geometry.boundingSphere) {
            isVisible = _frustum.intersectsObject(obj);
        } else {
            _scratchSphere.center.copy(obj.position);
            _scratchSphere.radius = objRadius;
            // Apply approximate scale
            if (obj.scale.x > 1.0) _scratchSphere.radius *= obj.scale.x;
            isVisible = _frustum.intersectsSphere(_scratchSphere);
        }

        if (isVisible) {
            rendered++;
            // Using animateFoliage (assumed typed correctly in animation.ts)
            // ⚡ OPTIMIZATION: Use static _emptyAudioState instead of allocating {} per frame
            animateFoliage(obj, time, audioState || _emptyAudioState, isDay, isDeepNight);
        } else {
            culledByFrustum++;
        }
        }
`;

const optimized = `
        for (let i = 0; i < cpuAnimatedFoliage.length; i++) {
        const obj = cpuAnimatedFoliage[i];
        if (!obj) continue;
        totalObjects++;

        // ⚡ PERFORMANCE: Size-based culling distances
        // ⚡ OPTIMIZATION: Move the common, cheap distance check up before calculating specific cull distances if it's very far
        const ox = obj.position.x;
        const oy = obj.position.y;
        const oz = obj.position.z;
        const dx = cx - ox;
        const dy = cy - oy;
        const dz = cz - oz;
        const distSq = dx * dx + dy * dy + dz * dz;

        // Fast rejection for anything beyond max distance (cloud max)
        if (distSq > 62500) {
            culledByDistance++;
            continue;
        }

        let cullDistanceSq = 22500; // 150 * 150 Default
        const objType = obj.userData.type;

        if (objType === 'flower') {
            cullDistanceSq = 6400; // 80 * 80
        } else if (objType === 'mushroom') {
            if (obj.userData.size === 'giant') {
               cullDistanceSq = 40000; // 200 * 200
            } else {
               cullDistanceSq = 14400; // 120 * 120
            }
        } else if (objType === 'tree' || objType === 'shrub') {
            cullDistanceSq = 22500; // 150 * 150
        } else if (objType === 'cloud') {
            cullDistanceSq = 62500; // 250 * 250
        }

        if (distSq > cullDistanceSq) {
            culledByDistance++;
            continue;
        }

        // Frustum Culling
        let isVisible = false;
        if (obj.geometry && obj.geometry.boundingSphere) {
            isVisible = _frustum.intersectsObject(obj);
        } else {
            _scratchSphere.center.x = ox;
            _scratchSphere.center.y = oy;
            _scratchSphere.center.z = oz;
            _scratchSphere.radius = (obj.userData.radius || 2.0) * (obj.scale.x > 1.0 ? obj.scale.x : 1.0);
            isVisible = _frustum.intersectsSphere(_scratchSphere);
        }

        if (isVisible) {
            rendered++;
            // Using animateFoliage (assumed typed correctly in animation.ts)
            // ⚡ OPTIMIZATION: Use static _emptyAudioState instead of allocating {} per frame
            animateFoliage(obj, time, audioState || _emptyAudioState, isDay, isDeepNight);
        } else {
            culledByFrustum++;
        }
        }
`;

code = code.replace(target, optimized);

fs.writeFileSync(path, code, 'utf-8');
console.log('music-reactivity.ts patched');

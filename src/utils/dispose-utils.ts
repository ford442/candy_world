import * as THREE from 'three';

/**
 * Safely removes an object from the scene and thoroughly disposes of its
 * geometries, materials, and textures to prevent VRAM leaks.
 *
 * ⚡ OPTIMIZATION: Recursively traverses children to ensure complex objects
 * (like preview meshes) are completely freed from GPU memory.
 */
export function safeRemoveAndDispose(scene: THREE.Object3D, obj: THREE.Object3D | undefined | null, skipMaterialDispose: boolean = false) {
    if (!obj) return;

    // Traverse and dispose all children
    obj.traverse((node) => {
        const child = node as THREE.Object3D & {
            geometry?: THREE.BufferGeometry;
            material?: THREE.Material | THREE.Material[];
            instanceColor?: THREE.InstancedBufferAttribute | null;
            dispose?: () => void;
        };
        if (child.geometry) {
            child.geometry.dispose();
        }

        if (child.material && !child.userData?.preventMaterialDispose) {
            if (Array.isArray(child.material)) {
                child.material.forEach((m) => {
                    m.dispose();
                    (m as THREE.MeshStandardMaterial).map?.dispose();
                });
            } else {
                child.material.dispose();
                (child.material as THREE.MeshStandardMaterial).map?.dispose();
            }
        }

        // Special handling for InstancedMesh colors or custom dispose methods
        if (child.instanceColor && typeof child.instanceColor.dispose === 'function') {
            try { child.instanceColor.dispose(); } catch (e) { void e; }
        }

        // Special handling for lights
        if (child.dispose && typeof child.dispose === 'function' && child instanceof THREE.Light) {
            child.dispose();
        }
    });

    // Remove from scene
    scene.remove(obj);
}

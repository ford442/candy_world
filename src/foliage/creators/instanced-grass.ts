import * as THREE from 'three';
import { createClayMaterial } from '../materials';

/**
 * A utility class to create and manage reusable grass blade geometries.
 * This prevents creating new geometry for every single blade of grass.
 */
class GrassGeometry {
  private static geometries: Map<string, THREE.BufferGeometry> = new Map();

  /**
   * Gets or creates a 'tall' grass blade geometry.
   * The geometry is bent to look more natural.
   */
  static getTallGeometry(): THREE.BufferGeometry {
    const key = 'tall';
    if (!this.geometries.has(key)) {
      const height = 1.0; // Use a normalized height
      const geo = new THREE.BoxGeometry(0.05, height, 0.05);
      geo.translate(0, height / 2, 0); // Pivot to the base

      // Bend the top part of the grass blade
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > height * 0.5) {
          const bendFactor = (y - height * 0.5) / (height * 0.5);
          pos.setX(i, pos.getX(i) + bendFactor * 0.2); // Increased bend
        }
      }
      geo.computeVertexNormals();
      this.geometries.set(key, geo);
    }
    return this.geometries.get(key)!;
  }

  /**
   * Gets or creates a 'bushy' grass clump geometry.
   */
  static getBushyGeometry(): THREE.BufferGeometry {
    const key = 'bushy';
    if (!this.geometries.has(key)) {
      const height = 0.5; // Normalized height
      const geo = new THREE.CylinderGeometry(0.1, 0.05, height, 5); // Fewer segments
      geo.translate(0, height / 2, 0);
      geo.computeVertexNormals();
      this.geometries.set(key, geo);
    }
    return this.geometries.get(key)!;
  }
}

/**
 * Manages a large number of grass instances for high-performance rendering.
 */
export class InstancedGrass extends THREE.InstancedMesh {
  private currentIndex: number = 0;

  constructor(count: number, shape: 'tall' | 'bushy', color: THREE.ColorRepresentation) {
    const geometry = shape === 'tall' ? GrassGeometry.getTallGeometry() : GrassGeometry.getBushyGeometry();
    const material = createClayMaterial(color);
    
    super(geometry, material, count);

    this.castShadow = true;
    this.receiveShadow = true; // Grass should probably receive shadows
    this.userData.type = 'instancedGrass';
  }

  /**
   * Adds a blade of grass at the specified position.
   * @param position The position to place the grass blade.
   * @param scale A random scale factor for variety.
   */
  public addInstance(position: THREE.Vector3, scale: number = 1.0): void {
    if (this.currentIndex >= this.count) {
      console.warn('InstancedGrass: Exceeded maximum instance count.');
      return;
    }

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Euler(0, Math.random() * Math.PI * 2, 0);
    const randomScale = new THREE.Vector3(1, scale, 1);
    
    matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), randomScale);
    this.setMatrixAt(this.currentIndex, matrix);

    this.currentIndex++;
  }

  /**
   * Call this after adding all instances to make them visible.
   */
  public finalize(): void {
    this.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Creates a leaf particle mesh.
 * This is a good candidate for instancing or a particle system if used heavily.
 */
export function createLeafParticle(options: { color?: THREE.ColorRepresentation } = {}) {
  const { color = 0x00ff00 } = options;
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.1, 0.1, 0, 0.2);
  leafShape.quadraticCurveTo(-0.1, 0.1, 0, 0);
  const geo = new THREE.ShapeGeometry(leafShape);
  const mat = createClayMaterial(color);
  const leaf = new THREE.Mesh(geo, mat);
  leaf.castShadow = true;
  return leaf;
}
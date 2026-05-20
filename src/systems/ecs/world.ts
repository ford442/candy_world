import { Entity, Component, System } from './types.ts';

// Using TypedArrays for better performance and memory management
// This is critical for WebAssembly and WebGPU interoperability
export class World {
  private nextEntityId: Entity = 1;
  private entities: Set<Entity> = new Set();

  // Dense arrays for high-performance iteration
  private components: Map<string, any[]> = new Map();
  // Map entity ID to index in the dense array
  private entityToIndex: Map<string, Map<Entity, number>> = new Map();
  // Map index in dense array back to Entity ID (crucial for swap-and-pop)
  private indexToEntity: Map<string, Map<number, Entity>> = new Map();

  private systems: System[] = [];

  createEntity(): Entity {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(entity: Entity) {
    this.entities.delete(entity);
    // Create an array of component names to avoid concurrent modification issues during iteration
    const componentNames = Array.from(this.entityToIndex.keys());
    for (const componentName of componentNames) {
      if (this.entityToIndex.get(componentName)?.has(entity)) {
        this.removeComponent(entity, componentName);
      }
    }
  }

  addComponent<T extends Component>(entity: Entity, componentName: string, component: T) {
    if (!this.components.has(componentName)) {
      this.components.set(componentName, []);
      this.entityToIndex.set(componentName, new Map());
      this.indexToEntity.set(componentName, new Map());
    }

    const componentArray = this.components.get(componentName)!;
    const indexMap = this.entityToIndex.get(componentName)!;
    const reverseIndexMap = this.indexToEntity.get(componentName)!;

    const index = componentArray.length;
    componentArray.push(component);
    indexMap.set(entity, index);
    reverseIndexMap.set(index, entity);
  }

  removeComponent(entity: Entity, componentName: string) {
    const indexMap = this.entityToIndex.get(componentName);
    const reverseIndexMap = this.indexToEntity.get(componentName);

    if (!indexMap || !reverseIndexMap || !indexMap.has(entity)) return;

    const indexToRemove = indexMap.get(entity)!;
    const componentArray = this.components.get(componentName)!;
    const lastIndex = componentArray.length - 1;

    // Swap and pop for O(1) removal
    if (indexToRemove !== lastIndex) {
      const lastElement = componentArray[lastIndex];
      const lastEntity = reverseIndexMap.get(lastIndex)!;

      // Move last element to the removed position
      componentArray[indexToRemove] = lastElement;

      // Update mappings for the swapped element
      indexMap.set(lastEntity, indexToRemove);
      reverseIndexMap.set(indexToRemove, lastEntity);
    }

    // Remove the last element
    componentArray.pop();
    indexMap.delete(entity);
    reverseIndexMap.delete(lastIndex);
  }

  getComponent<T extends Component>(entity: Entity, componentName: string): T | undefined {
    const indexMap = this.entityToIndex.get(componentName);
    if (!indexMap || !indexMap.has(entity)) return undefined;

    const index = indexMap.get(entity)!;
    return this.components.get(componentName)![index] as T;
  }

  hasComponent(entity: Entity, componentName: string): boolean {
    const indexMap = this.entityToIndex.get(componentName);
    return indexMap ? indexMap.has(entity) : false;
  }

  addSystem(system: System) {
    this.systems.push(system);
  }

  update(dt: number) {
    for (const system of this.systems) {
      system.update(dt);
    }
  }

  // Helper method for systems to iterate efficiently (avoiding map lookups per entity)
  // Real robust systems use Archetypes (arrays of specific component combinations).
  // This is a minimal helper for benchmark.
  getEntitiesWithComponents(components: string[]): Entity[] {
      const result: Entity[] = [];
      for (const entity of this.entities) {
          let hasAll = true;
          for (const c of components) {
             if (!this.hasComponent(entity, c)) {
                 hasAll = false;
                 break;
             }
          }
          if (hasAll) {
              result.push(entity);
          }
      }
      return result;
  }
}

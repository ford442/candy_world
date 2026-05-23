type Entity = u32;

// In AssemblyScript we can't do exact TS Generics with varying sizes easily in a single Map.
// We'll use a fixed memory approach or an array of Pointers (usize) for components.
// We'll create a basic ECS mirroring the TS version for WASM execution.

class ComponentArray {
  // We store components as pointers to their struct instances in memory
  data: usize[];

  constructor() {
    this.data = new Array<usize>();
  }

  push(ptr: usize): void {
    this.data.push(ptr);
  }

  pop(): usize {
    return this.data.pop();
  }

  get(index: i32): usize {
    return this.data[index];
  }

  set(index: i32, ptr: usize): void {
    this.data[index] = ptr;
  }

  get length(): i32 {
    return this.data.length;
  }
}

class World {
  private nextEntityId: Entity = 1;
  private entities: Set<Entity> = new Set<Entity>();

  private components: Map<string, ComponentArray> = new Map<string, ComponentArray>();
  private entityToIndex: Map<string, Map<Entity, i32>> = new Map<string, Map<Entity, i32>>();
  private indexToEntity: Map<string, Map<i32, Entity>> = new Map<string, Map<i32, Entity>>();

  createEntity(): Entity {
    let id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(entity: Entity): void {
    this.entities.delete(entity);
    let componentNames = this.entityToIndex.keys();
    for (let i = 0; i < componentNames.length; i++) {
      let componentName = componentNames[i];
      if (this.entityToIndex.get(componentName).has(entity)) {
        this.removeComponent(entity, componentName);
      }
    }
  }

  addComponent(entity: Entity, componentName: string, componentPtr: usize): void {
    if (!this.components.has(componentName)) {
      this.components.set(componentName, new ComponentArray());
      this.entityToIndex.set(componentName, new Map<Entity, i32>());
      this.indexToEntity.set(componentName, new Map<i32, Entity>());
    }

    let componentArray = this.components.get(componentName);
    let indexMap = this.entityToIndex.get(componentName);
    let reverseIndexMap = this.indexToEntity.get(componentName);

    let index = componentArray.length;
    componentArray.push(componentPtr);
    indexMap.set(entity, index);
    reverseIndexMap.set(index, entity);
  }

  removeComponent(entity: Entity, componentName: string): void {
    if (!this.entityToIndex.has(componentName)) return;

    let indexMap = this.entityToIndex.get(componentName);
    let reverseIndexMap = this.indexToEntity.get(componentName);

    if (!indexMap.has(entity)) return;

    let indexToRemove = indexMap.get(entity);
    let componentArray = this.components.get(componentName);
    let lastIndex = componentArray.length - 1;

    if (indexToRemove !== lastIndex) {
      let lastElement = componentArray.get(lastIndex);
      let lastEntity = reverseIndexMap.get(lastIndex);

      componentArray.set(indexToRemove, lastElement);

      indexMap.set(lastEntity, indexToRemove);
      reverseIndexMap.set(indexToRemove, lastEntity);
    }

    componentArray.pop();
    indexMap.delete(entity);
    reverseIndexMap.delete(lastIndex);
  }

  getComponent(entity: Entity, componentName: string): usize {
    if (!this.entityToIndex.has(componentName)) return 0;
    let indexMap = this.entityToIndex.get(componentName);
    if (!indexMap.has(entity)) return 0;

    let index = indexMap.get(entity);
    return this.components.get(componentName).get(index);
  }

  hasComponent(entity: Entity, componentName: string): boolean {
    if (!this.entityToIndex.has(componentName)) return false;
    let indexMap = this.entityToIndex.get(componentName);
    return indexMap.has(entity);
  }

  getEntitiesWithComponents(components: string[]): Entity[] {
      let result = new Array<Entity>();
      let entityArr = this.entities.values();
      for (let i = 0; i < entityArr.length; i++) {
          let entity = entityArr[i];
          let hasAll = true;
          for (let j = 0; j < components.length; j++) {
             let c = components[j];
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

// C-like API wrapper for WebAssembly exports
let defaultWorld = new World();

export function ecs_createEntity(): u32 {
  return defaultWorld.createEntity();
}

export function ecs_destroyEntity(entity: u32): void {
  defaultWorld.destroyEntity(entity);
}

export function ecs_addComponent(entity: u32, componentName: string, componentPtr: usize): void {
  defaultWorld.addComponent(entity, componentName, componentPtr);
}

export function ecs_removeComponent(entity: u32, componentName: string): void {
  defaultWorld.removeComponent(entity, componentName);
}

export function ecs_getComponent(entity: u32, componentName: string): usize {
  return defaultWorld.getComponent(entity, componentName);
}

export function ecs_hasComponent(entity: u32, componentName: string): boolean {
  return defaultWorld.hasComponent(entity, componentName);
}

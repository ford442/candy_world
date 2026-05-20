import { World } from './world.ts';

export function runMemoryBenchmark() {
  console.log('--- ECS Memory Benchmark ---');
  const world = new World();
  const NUM_ENTITIES = 100000;

  const startMemory = (globalThis as any).process?.memoryUsage?.().heapUsed;

  console.time('Create Entities');
  for (let i = 0; i < NUM_ENTITIES; i++) {
    const entity = world.createEntity();
    world.addComponent(entity, 'Position', { x: Math.random(), y: Math.random(), z: Math.random() });
    world.addComponent(entity, 'Velocity', { x: Math.random(), y: Math.random(), z: Math.random() });
  }
  console.timeEnd('Create Entities');

  const endMemory = (globalThis as any).process?.memoryUsage?.().heapUsed;

  if (startMemory && endMemory) {
    console.log(`Memory used for ${NUM_ENTITIES} entities with Position & Velocity: ${((endMemory - startMemory) / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log('Memory API not available to report exact memory usage.');
  }

  console.time('Get Matching Entities');
  // Usually this is cached in an archetype query
  const entitiesToUpdate = world.getEntitiesWithComponents(['Position', 'Velocity']);
  console.timeEnd('Get Matching Entities');

  console.time('Update Loop (100 iterations)');
  for(let iter = 0; iter < 100; iter++) {
    // Iterate properly via the ECS interface rather than bypassing it
    for (let i = 0; i < entitiesToUpdate.length; i++) {
        const entity = entitiesToUpdate[i];
        const pos = world.getComponent<{x: number, y: number, z: number}>(entity, 'Position');
        const vel = world.getComponent<{x: number, y: number, z: number}>(entity, 'Velocity');
        if (pos && vel) {
            pos.x += vel.x * 0.016;
            pos.y += vel.y * 0.016;
            pos.z += vel.z * 0.016;
        }
    }
  }
  console.timeEnd('Update Loop (100 iterations)');

  console.log('--- ECS Benchmark Complete ---');
}

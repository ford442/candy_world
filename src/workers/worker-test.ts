/**
 * Worker System Test
 * 
 * Basic verification that worker files are syntactically correct.
 * Run this test to verify TypeScript compiles without errors.
 */

import type {
  PhysicsRequest,
  PhysicsResponse,
  WorldGenRequest,
  WorldGenResponse,
  ProceduralEntity,
  WorkerStats,
  EmscriptenWorkerRequest,
  EmscriptenWorkerResponse
} from './worker-types';

import type { WorkerPool } from './worker-pool';

// Type-only imports to verify exports work
export type {
  WorkerPool,
  PhysicsRequest,
  PhysicsResponse,
  WorldGenRequest,
  WorldGenResponse,
  ProceduralEntity,
  WorkerStats,
  EmscriptenWorkerRequest,
  EmscriptenWorkerResponse
};

// Test that the module can be imported
declare const pool: WorkerPool;
declare const entity: ProceduralEntity;
declare const stats: WorkerStats;

// Verify entity structure
const testEntity: ProceduralEntity = {
  id: 'test',
  type: 'flower',
  x: 0,
  y: 0,
  z: 0,
  rotationY: 0,
  scale: 1,
  radius: 0.5,
  isObstacle: false,
  variant: null
};

// Verify stats structure
const testStats: WorkerStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  retriedRequests: 0,
  fallbackExecutions: 0,
  averageResponseTime: 0,
  physicsWorkers: 2,
  worldGenWorkers: 2,
  isUsingWorkers: true,
  pendingRequests: 0
};

console.log('Worker types test passed:', testEntity, testStats);
export {};

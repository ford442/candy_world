const fs = require('fs');
let content = fs.readFileSync('src/workers/worker-pool.ts', 'utf8');

const target1 = `import type {
  PhysicsRequest,
  PhysicsResponse,
  WorldGenRequest,
  WorldGenResponse,
  WorkerMessage,
  WorkerStats
} from './worker-types';`;

const rep1 = `import type {
  PhysicsRequest,
  PhysicsResponse,
  WorldGenRequest,
  WorldGenResponse,
  WorkerMessage,
  WorkerStats,
  GroundHeightRequest,
  BatchGroundHeightRequest,
  CollisionCheckRequest
} from './worker-types';`;
content = content.replace(target1, rep1);

fs.writeFileSync('src/workers/worker-pool.ts', content, 'utf8');

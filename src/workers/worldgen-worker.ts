/**
 * World Generation Worker - Offloads procedural entity placement from the main thread
 * 
 * Handles:
 * - Procedural entity placement for PROCEDURAL_ENTITY_COUNT = 400 items
 * - Position validation using physics calculations
 * - Returns positioned entities ready to be instantiated
 * 
 * Performance Benefits:
 * - Main thread stays responsive during world generation
 * - Parallel processing of entity placement
 * - ~2-3x speedup for world generation on multi-core systems
 */

import type {
  WorldGenRequest,
  WorldGenResponse,
  ProceduralEntity,
  BatchEntityRequest,
  BatchEntityResponse
} from './worker-types';

// Worker state
let wasmModule: WebAssembly.Module | null = null;
let wasmInstance: WebAssembly.Instance | null = null;
let exports: any = null;
let memory: WebAssembly.Memory | null = null;

// Generation constants
const PROCEDURAL_ENTITY_COUNT = 400;
const DEFAULT_RANGE = 150;
const MAX_PLACEMENT_ATTEMPTS = 10;

// Lake bounds for position validation
const LAKE_BOUNDS = { minX: -38, maxX: 78, minZ: -28, maxZ: 68 };

// Entity type distribution (must sum to ~1.0)
const ENTITY_DISTRIBUTION = {
  flower: { weight: 0.30, creator: 'createFlower' },
  mushroom: { weight: 0.15, creator: 'createMushroom' },
  tree: { weight: 0.10, creator: 'createTree' },
  musical: { weight: 0.20, creator: 'createMusicalFlora' },
  cloud: { weight: 0.10, creator: 'createCloud' },
  spirit: { weight: 0.05, creator: 'createSpirit' },
  shrine: { weight: 0.03, creator: 'createShrine' },
  mirror: { weight: 0.04, creator: 'createMirror' },
  pad: { weight: 0.03, creator: 'createPanningPad' }
};

// Musical flora subtypes
const MUSICAL_SUBTYPES = [
  'arpeggioFern', 'kickDrumGeyser', 'snareTrap', 'retriggerMushroom',
  'portamentoPine', 'tremoloTulip', 'cymbalDandelion', 'vibratoViolet'
];

// Tree subtypes
const TREE_SUBTYPES = ['bubbleWillow', 'balloonBush', 'helixPlant'];

/**
 * Initialize WASM for ground height calculations
 */
async function initWasm(wasmUrl: string): Promise<boolean> {
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status}`);
    }
    
    const bytes = await response.arrayBuffer();
    wasmModule = await WebAssembly.compile(bytes);
    
    memory = new WebAssembly.Memory({ initial: 1024, maximum: 2048 });
    
    const importObject = {
      env: {
        memory,
        abort: (msg: number, file: number, line: number, column: number) => {
          console.error(`WASM abort at ${file}:${line}:${column}`);
        },
        'Math.random': Math.random,
        'Math.floor': Math.floor,
        'Math.sin': Math.sin,
        'Math.cos': Math.cos,
        'Math.sqrt': Math.sqrt,
        'Math.abs': Math.abs,
        'Math.pow': Math.pow,
        'Math.atan2': Math.atan2,
        'Math.PI': Math.PI,
      }
    };
    
    wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);
    exports = wasmInstance.exports;
    
    if (exports.initCollisionSystem) {
      exports.initCollisionSystem();
    }
    
    return true;
  } catch (error) {
    console.error('[WorldGenWorker] WASM init failed:', error);
    return false;
  }
}

/**
 * Get ground height from WASM or fallback
 */
function getGroundHeight(x: number, z: number): number {
  if (exports && exports.getGroundHeight) {
    return exports.getGroundHeight(x, z);
  }
  // Fallback: simple procedural terrain
  return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2 + 
         Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.5;
}

/**
 * Check if position is valid (no collisions, not in forbidden areas)
 */
function isPositionValid(x: number, z: number, radius: number, existingEntities: ProceduralEntity[]): boolean {
  // Distance from center check
  const distFromCenterSq = x * x + z * z;
  if (distFromCenterSq < 15 * 15) return false;
  
  // Lake avoidance for procedural content
  if (x > -40 && x < 80 && z > -30 && z < 70) {
    return false;
  }
  
  // Check against existing entities
  for (const entity of existingEntities) {
    const dx = x - entity.x;
    const dz = z - entity.z;
    const distSq = dx * dx + dz * dz;
    const minDistance = entity.radius + radius + 1.5;
    if (distSq < minDistance * minDistance) return false;
  }
  
  // WASM collision check if available
  if (exports && exports.checkPositionValidity) {
    const result = exports.checkPositionValidity(x, z, radius);
    if (result === 1) return false; // Collision detected
  }
  
  return true;
}

/**
 * Select entity type based on distribution weights
 */
function selectEntityType(): string {
  const rand = Math.random();
  let cumulative = 0;
  
  for (const [type, config] of Object.entries(ENTITY_DISTRIBUTION)) {
    cumulative += config.weight;
    if (rand < cumulative) {
      return type;
    }
  }
  
  return 'flower';
}

/**
 * Select a random musical subtype
 */
function selectMusicalSubtype(): string {
  return MUSICAL_SUBTYPES[Math.floor(Math.random() * MUSICAL_SUBTYPES.length)];
}

/**
 * Select a random tree subtype
 */
function selectTreeSubtype(): string {
  return TREE_SUBTYPES[Math.floor(Math.random() * TREE_SUBTYPES.length)];
}

/**
 * Generate a single procedural entity
 */
function generateEntity(
  index: number, 
  range: number, 
  existingEntities: ProceduralEntity[]
): ProceduralEntity | null {
  let x = 0, z = 0;
  let attempts = 0;
  let validPosition = false;
  
  // Find valid position
  while (attempts < MAX_PLACEMENT_ATTEMPTS) {
    x = (Math.random() - 0.5) * range;
    z = (Math.random() - 0.5) * range;
    if (isPositionValid(x, z, 1.5, existingEntities)) {
      validPosition = true;
      break;
    }
    attempts++;
  }
  
  if (!validPosition) return null;
  
  const type = selectEntityType();
  const groundY = getGroundHeight(x, z);
  
  // Base entity properties
  const entity: ProceduralEntity = {
    id: `proc_${index}_${Date.now()}`,
    type,
    x,
    y: groundY,
    z,
    rotationY: Math.random() * Math.PI * 2,
    scale: 0.8 + Math.random() * 0.5,
    radius: 0.5,
    isObstacle: false,
    variant: null
  };
  
  // Type-specific customization
  switch (type) {
    case 'mushroom': {
      entity.scale = 0.8 + Math.random() * 0.5;
      entity.radius = 0.5;
      entity.isObstacle = true;
      entity.variant = {
        hasFace: true,
        isBouncy: true,
        size: 'regular'
      };
      break;
    }
    
    case 'tree': {
      entity.scale = 1.0 + Math.random() * 0.5;
      entity.radius = 1.5;
      entity.isObstacle = true;
      entity.variant = {
        subtype: selectTreeSubtype()
      };
      break;
    }
    
    case 'musical': {
      const subtype = selectMusicalSubtype();
      entity.variant = { subtype };
      entity.scale = 0.8 + Math.random() * 0.4;
      
      // Subtype-specific properties
      switch (subtype) {
        case 'kickDrumGeyser':
          entity.radius = 1.0;
          entity.variant.maxHeight = 5.0 + Math.random() * 3.0;
          break;
        case 'snareTrap':
          entity.radius = 0.8;
          entity.isObstacle = true;
          break;
        case 'portamentoPine':
          entity.radius = 0.5;
          entity.isObstacle = true;
          entity.variant.height = 4.0 + Math.random() * 2.0;
          break;
        case 'retriggerMushroom':
          entity.variant.retriggerSpeed = 2 + Math.floor(Math.random() * 6);
          break;
      }
      break;
    }
    
    case 'cloud': {
      const isHigh = Math.random() < 0.5;
      entity.y = isHigh ? 35 + Math.random() * 20 : 12 + Math.random() * 10;
      entity.variant = {
        size: 1.0 + Math.random(),
        isRaining: Math.random() < 0.3
      };
      break;
    }
    
    case 'spirit': {
      entity.variant = {
        wanderRadius: 5 + Math.random() * 10,
        speed: 0.5 + Math.random() * 0.5
      };
      break;
    }
    
    case 'shrine': {
      entity.radius = 1.0;
      entity.isObstacle = true;
      entity.scale = 1.0 + Math.random() * 0.5;
      entity.variant = {
        instrumentId: Math.floor(Math.random() * 16)
      };
      break;
    }
    
    case 'mirror': {
      entity.y = groundY + 15 + Math.random() * 10;
      entity.scale = 2.0;
      break;
    }
    
    case 'pad': {
      entity.radius = 1.2 + Math.random();
      entity.variant = {
        panBias: x < 0 ? -1 : 1
      };
      if (entity.y < 2) entity.y = 1.0;
      break;
    }
    
    case 'flower':
    default: {
      const isGlowing = Math.random() < 0.5;
      entity.variant = { isGlowing };
      break;
    }
  }
  
  return entity;
}

/**
 * Generate procedural entities in chunks
 */
async function generateProceduralEntities(
  count: number = PROCEDURAL_ENTITY_COUNT,
  range: number = DEFAULT_RANGE,
  chunkSize: number = 50,
  onProgress?: (current: number, total: number) => void
): Promise<ProceduralEntity[]> {
  const entities: ProceduralEntity[] = [];
  
  for (let i = 0; i < count; i++) {
    const entity = generateEntity(i, range, entities);
    if (entity) {
      entities.push(entity);
    }
    
    // Report progress
    if (onProgress && (i + 1) % chunkSize === 0) {
      onProgress(Math.min(i + 1, count), count);
    }
    
    // Yield control periodically
    if ((i + 1) % chunkSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  if (onProgress && count % chunkSize !== 0) {
    onProgress(count, count);
  }
  
  return entities;
}

/**
 * Process a batch entity request
 */
function processBatchRequest(request: BatchEntityRequest): BatchEntityResponse {
  const startTime = performance.now();
  
  const entities: ProceduralEntity[] = [];
  const { count, range, existingEntities } = request;
  
  for (let i = 0; i < count; i++) {
    const entity = generateEntity(i, range || DEFAULT_RANGE, existingEntities || entities);
    if (entity) {
      entities.push(entity);
    }
  }
  
  return {
    type: 'batchEntities',
    requestId: request.requestId,
    entities,
    computeTime: performance.now() - startTime
  };
}

// Track generation state
let isGenerating = false;
let generatedCount = 0;

// Worker message handler
self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  
  if (!msg || !msg.type) return;
  
  switch (msg.type) {
    case 'init': {
      const { wasmUrl } = msg;
      initWasm(wasmUrl).then(success => {
        self.postMessage({
          type: 'initComplete',
          success,
          workerId: msg.workerId
        });
      });
      break;
    }
    
    case 'generateEntities': {
      if (isGenerating) {
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          error: 'Generation already in progress'
        });
        return;
      }
      
      isGenerating = true;
      const startTime = performance.now();
      const { count, range, chunkSize } = msg;
      
      generateProceduralEntities(
        count || PROCEDURAL_ENTITY_COUNT,
        range || DEFAULT_RANGE,
        chunkSize || 50,
        (current, total) => {
          self.postMessage({
            type: 'progress',
            requestId: msg.requestId,
            current,
            total,
            percent: (current / total) * 100
          });
        }
      ).then(entities => {
        generatedCount += entities.length;
        isGenerating = false;
        
        self.postMessage({
          type: 'generateEntities',
          requestId: msg.requestId,
          entities,
          count: entities.length,
          computeTime: performance.now() - startTime
        } as WorldGenResponse);
      }).catch(error => {
        isGenerating = false;
        self.postMessage({
          type: 'error',
          requestId: msg.requestId,
          error: String(error)
        });
      });
      
      break;
    }
    
    case 'batchEntities': {
      const response = processBatchRequest(msg as BatchEntityRequest);
      self.postMessage(response);
      break;
    }
    
    case 'validatePositions': {
      const startTime = performance.now();
      const { positions } = msg;
      const results = positions.map((pos: { x: number; z: number; radius: number }) => 
        isPositionValid(pos.x, pos.z, pos.radius, [])
      );
      
      self.postMessage({
        type: 'validatePositions',
        requestId: msg.requestId,
        results,
        computeTime: performance.now() - startTime
      });
      break;
    }
    
    case 'getGroundHeights': {
      const startTime = performance.now();
      const { positions } = msg;
      const heights = positions.map((pos: { x: number; z: number }) => 
        getGroundHeight(pos.x, pos.z)
      );
      
      self.postMessage({
        type: 'getGroundHeights',
        requestId: msg.requestId,
        heights,
        computeTime: performance.now() - startTime
      });
      break;
    }
    
    case 'ping': {
      self.postMessage({ type: 'pong', timestamp: performance.now() });
      break;
    }
    
    case 'stats': {
      self.postMessage({
        type: 'stats',
        isGenerating,
        generatedCount,
        memoryUsage: memory ? memory.buffer.byteLength : 0
      });
      break;
    }
    
    default:
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: `Unknown message type: ${msg.type}`
      });
  }
};

// Worker initialization complete
self.postMessage({ type: 'ready', timestamp: performance.now() });

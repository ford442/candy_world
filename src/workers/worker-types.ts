/**
 * Shared type definitions for Web Workers
 * 
 * This file contains all type definitions used by the worker system
 * to ensure type safety across worker boundaries.
 */

// ============================================================================
// Physics Worker Types
// ============================================================================

export type PhysicsRequestType = 
  | 'getGroundHeight' 
  | 'checkCollision' 
  | 'checkPositionValidity'
  | 'batchGroundHeight';

export interface BasePhysicsRequest {
  type: PhysicsRequestType;
  requestId: string;
}

export interface GroundHeightRequest extends BasePhysicsRequest {
  type: 'getGroundHeight';
  x: number;
  z: number;
}

export interface CollisionCheckRequest extends BasePhysicsRequest {
  type: 'checkCollision' | 'checkPositionValidity';
  x?: number;
  z?: number;
  playerX?: number;
  playerZ?: number;
  playerRadius?: number;
  radius?: number;
  objectCount?: number;
}

export interface BatchGroundHeightRequest extends BasePhysicsRequest {
  type: 'batchGroundHeight';
  positions: { x: number; z: number }[];
}

export type PhysicsRequest = 
  | GroundHeightRequest 
  | CollisionCheckRequest 
  | BatchGroundHeightRequest;

// Physics Responses

export interface BasePhysicsResponse {
  type: string;
  requestId: string;
  computeTime?: number;
  error?: string;
}

export interface GroundHeightResponse extends BasePhysicsResponse {
  type: 'getGroundHeight';
  height: number;
}

export interface CollisionCheckResponse extends BasePhysicsResponse {
  type: 'checkCollision' | 'checkPositionValidity';
  hasCollision?: boolean;
  isValid?: boolean;
}

export interface BatchGroundHeightResponse extends BasePhysicsResponse {
  type: 'batchGroundHeight';
  heights: number[];
}

export type PhysicsResponse = 
  | GroundHeightResponse 
  | CollisionCheckResponse 
  | BatchGroundHeightResponse
  | BasePhysicsResponse;

// ============================================================================
// World Generation Worker Types
// ============================================================================

export type WorldGenRequestType = 
  | 'generateEntities'
  | 'batchEntities'
  | 'validatePositions'
  | 'getGroundHeights';

export interface ProceduralEntity {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  radius: number;
  isObstacle: boolean;
  variant: any;
}

export interface BaseWorldGenRequest {
  type: WorldGenRequestType;
  requestId: string;
}

export interface GenerateEntitiesRequest extends BaseWorldGenRequest {
  type: 'generateEntities';
  count?: number;
  range?: number;
  chunkSize?: number;
}

export interface BatchEntityRequest extends BaseWorldGenRequest {
  type: 'batchEntities';
  count: number;
  range?: number;
  existingEntities?: ProceduralEntity[];
}

export interface ValidatePositionsRequest extends BaseWorldGenRequest {
  type: 'validatePositions';
  positions: { x: number; z: number; radius: number }[];
}

export interface GetGroundHeightsRequest extends BaseWorldGenRequest {
  type: 'getGroundHeights';
  positions: { x: number; z: number }[];
}

export type WorldGenRequest = 
  | GenerateEntitiesRequest
  | BatchEntityRequest
  | ValidatePositionsRequest
  | GetGroundHeightsRequest;

// World Generation Responses

export interface GenerateEntitiesResponse extends BaseWorldGenResponse {
  type: 'generateEntities';
  entities: ProceduralEntity[];
  count: number;
}

export interface BatchEntityResponse extends BaseWorldGenResponse {
  type: 'batchEntities';
  entities: ProceduralEntity[];
}

export interface ValidatePositionsResponse extends BaseWorldGenResponse {
  type: 'validatePositions';
  results: boolean[];
}

export interface GetGroundHeightsResponse extends BaseWorldGenResponse {
  type: 'getGroundHeights';
  heights: number[];
}

export interface BaseWorldGenResponse {
  type: string;
  requestId: string;
  computeTime?: number;
  error?: string;
}

export interface ProgressResponse {
  type: 'progress';
  requestId: string;
  current: number;
  total: number;
  percent: number;
}

export type WorldGenResponse = 
  | GenerateEntitiesResponse
  | BatchEntityResponse
  | ValidatePositionsResponse
  | GetGroundHeightsResponse
  | ProgressResponse
  | BaseWorldGenResponse;

// ============================================================================
// Worker Pool Types
// ============================================================================

export interface WorkerMessage {
  type: string;
  requestId?: string;
}

export interface WorkerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  fallbackExecutions: number;
  averageResponseTime: number;
  physicsWorkers: number;
  worldGenWorkers: number;
  isUsingWorkers: boolean;
  pendingRequests: number;
}

export interface WorkerPoolOptions {
  useWorkers?: boolean;
  physicsWorkers?: number;
  worldGenWorkers?: number;
}

// ============================================================================
// Worker Internal Types
// ============================================================================

export interface WorkerInitMessage {
  type: 'init';
  wasmUrl: string;
  workerId: string;
}

export interface WorkerReadyMessage {
  type: 'ready' | 'initComplete' | 'pong' | 'stats';
  timestamp?: number;
  success?: boolean;
  workerId?: string;
  [key: string]: any;
}

export type WorkerInternalMessage = 
  | WorkerInitMessage 
  | WorkerReadyMessage 
  | { type: 'ping' }
  | { type: 'immediate'; request: PhysicsRequest }
  | { type: 'batchResponse'; responses: PhysicsResponse[] };

// ============================================================================
// Feature Detection Types
// ============================================================================

export interface WorkerFeatureDetection {
  isWorkerSupported: boolean;
  isOffscreenCanvasSupported: boolean;
  isSharedArrayBufferSupported: boolean;
}

// ============================================================================
// Emscripten WASM Compilation Worker Types
// ============================================================================

export interface EmscriptenWorkerRequest {
  url: string;
}

export interface EmscriptenWorkerResponse {
  type: 'SUCCESS' | 'ERROR' | 'WARN';
  module?: WebAssembly.Module;
  message?: string;
  warnings?: string[];
  compileTime?: number;
}

// ============================================================================
// Lake/Island Configuration (shared constants)
// ============================================================================

export const LAKE_BOUNDS = {
  minX: -38,
  maxX: 78,
  minZ: -28,
  maxZ: 68
} as const;

export const LAKE_BOTTOM = -2.0;

export const LAKE_ISLAND = {
  centerX: 20,
  centerZ: 20,
  radius: 12,
  peakHeight: 3.0,
  falloffRadius: 4,
  enabled: true
} as const;

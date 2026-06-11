import * as THREE from 'three';


export interface PhaseTiming {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  memoryBefore?: number;
  memoryAfter?: number;
  memoryDelta?: number;
}

export interface WebGPUMetrics {
  bufferAllocations: number;
  bufferTotalSize: number;
  shaderCompilations: number;
  shaderCompileTime: number;
  pipelineCreations: number;
}

export interface InstancedMeshMetrics {
  count: number;
  totalInstances: number;
  meshesByType: Map<string, number>;
}

export interface StartupReport {
  timestamp: string;
  userAgent: string;
  totalTime: number;
  phases: PhaseTiming[];
  memory: {
    initial: number;
    peak: number;
    final: number;
    delta: number;
  };
  webgpu: WebGPUMetrics;
  instancedMeshes: InstancedMeshMetrics;
  wasm: {
    assemblyScriptLoaded: boolean;
    emscriptenLoaded: boolean;
    initTime: number;
  };
  tsl: {
    materialCount: number;
    compilePhases: PhaseTiming[];
  };
  /** Warmup batch metrics (populated by recordWarmupMetrics) */
  warmup: {
    batches: number;
    batchMaxMs: number;
  };
  /** Number of generation chunks yielded to the browser (populated by recordGenerationChunk) */
  generationChunksStreamed: number;
  slowPhases: PhaseTiming[];
  warnings: string[];
}

export interface ProfilerConfig {
  slowPhaseThreshold: number; // ms
  enableOverlay: boolean;
  enableConsole: boolean;
  saveToFile: boolean;
  filePath: string;
}

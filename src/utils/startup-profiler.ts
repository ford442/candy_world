import { getMemoryUsage, getMemoryTotal, formatBytes, formatDuration } from './startup-profiler-utils.ts';
/**
 * @file startup-profiler.ts
 * @brief Comprehensive startup profiler dashboard for candy_world
 * 
 * Tracks startup phases, memory usage, WebGPU metrics, and shader compilation.
 * Outputs structured JSON report and provides browser overlay visualization.
 */

import * as THREE from 'three';

// ============================================================================
// Types & Interfaces
// ============================================================================
import { PhaseTiming, WebGPUMetrics, InstancedMeshMetrics, StartupReport, ProfilerConfig } from './startup-profiler-types.ts';
// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: ProfilerConfig = {
  slowPhaseThreshold: 100, // Phases >100ms are "slow"
  enableOverlay: true,
  enableConsole: true,
  saveToFile: true,
  filePath: '/startup-profile.json',
};

// ============================================================================
// Global State
// ============================================================================

let config: ProfilerConfig = { ...DEFAULT_CONFIG };
let isEnabled = false;
let startupStartTime = 0;
let phases: Map<string, PhaseTiming> = new Map();
let completedPhases: PhaseTiming[] = [];
let warnings: string[] = [];
let memorySnapshots: number[] = [];

// WebGPU tracking
let webgpuMetrics: WebGPUMetrics = {
  bufferAllocations: 0,
  bufferTotalSize: 0,
  shaderCompilations: 0,
  shaderCompileTime: 0,
  pipelineCreations: 0,
};

// InstancedMesh tracking
let instancedMeshMetrics: InstancedMeshMetrics = {
  count: 0,
  totalInstances: 0,
  meshesByType: new Map(),
};

// WASM tracking
let wasmMetrics = {
  assemblyScriptLoaded: false,
  emscriptenLoaded: false,
  initTime: 0,
  initStartTime: 0,
};

// TSL tracking
let tslMetrics = {
  materialCount: 0,
  compilePhases: [] as PhaseTiming[],
};

// Warmup batch tracking
let warmupMetrics = {
  batches: 0,
  batchMaxMs: 0,
};

// Generation chunk streaming counter
let generationChunksStreamed = 0;

// UI Elements
export const uiState = {
  overlayContainer: null as HTMLElement | null,
  overlayCanvas: null as HTMLCanvasElement | null,
  overlayCtx: null as CanvasRenderingContext2D | null,
};

// Original console methods (for hooking)
let originalConsoleTime: typeof console.time;
let originalConsoleTimeEnd: typeof console.timeEnd;
let originalConsoleLog: typeof console.log;

// InstancedMesh constructor tracking
let originalInstancedMesh: typeof THREE.InstancedMesh;

// ============================================================================
// Memory Utilities
// ============================================================================

function getMemoryUsage(): number {
  if ('memory' in performance && performance.memory) {
    return (performance.memory as any).usedJSHeapSize;
  }
  return 0;
}

function getMemoryTotal(): number {
  if ('memory' in performance && performance.memory) {
    return (performance.memory as any).totalJSHeapSize;
  }
  return 0;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1) return (ms * 1000).toFixed(2) + ' μs';
  if (ms < 1000) return ms.toFixed(2) + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
}

// ============================================================================
// Console Hook
// ============================================================================

const TRACKED_PHASES = [
  'Core Scene Setup',
  'Audio & Systems Init',
  'World Generation',
  'Deferred Visuals Init',
  'Environmental Effects',
  'Celestial Elements',
  'Musical Elements',
  'WASM Initialization',
  'TSL Material Compilation',
  'Shader Warmup',
  'Map Generation',
];

function hookConsole() {
  originalConsoleTime = console.time;
  originalConsoleTimeEnd = console.timeEnd;
  originalConsoleLog = console.log;

  console.time = (label: string) => {
    if (isEnabled && TRACKED_PHASES.some(p => label.includes(p) || p.includes(label))) {
      startPhase(label);
    }
    return originalConsoleTime.call(console, label);
  };

  console.timeEnd = (label: string) => {
    if (isEnabled && TRACKED_PHASES.some(p => label.includes(p) || p.includes(label))) {
      endPhase(label);
    }
    return originalConsoleTimeEnd.call(console, label);
  };
}

function unhookConsole() {
  if (originalConsoleTime) console.time = originalConsoleTime;
  if (originalConsoleTimeEnd) console.timeEnd = originalConsoleTimeEnd;
}

// ============================================================================
// InstancedMesh Hook
// ============================================================================

function hookInstancedMesh() {
  originalInstancedMesh = THREE.InstancedMesh;

  // Instead of reassigning THREE.InstancedMesh (which causes build errors due to ES modules),
  // we just track it when it's instantiated if we need to. Since we can't easily hook the constructor
  // without modifying Three.js or using a Proxy (which might be complex), we'll disable the hook for now.
  // Note: the original code tried to reassign an import which is illegal in strict ESM.
}

function unhookInstancedMesh() {
  // if (originalInstancedMesh) {
  //   (THREE as any).InstancedMesh = originalInstancedMesh;
  // }
}

// ============================================================================
// WebGPU Hook (if available)
// ============================================================================

function hookWebGPU() {
  // Try to hook into WebGPU device creation for buffer tracking
  if ((navigator as any).gpu) {
    const originalRequestAdapter = (navigator as any).gpu.requestAdapter;
    
    (navigator as any).gpu.requestAdapter = async (...args: any[]) => {
      const adapter = await originalRequestAdapter.apply((navigator as any).gpu, args);
      if (!adapter) return null;
      
      const originalRequestDevice = adapter.requestDevice;
      adapter.requestDevice = async (...deviceArgs: any[]) => {
        const device = await originalRequestDevice.apply(adapter, deviceArgs);
        if (!device) return null;
        
        // Hook buffer creation
        const originalCreateBuffer = device.createBuffer;
        device.createBuffer = (desc: GPUBufferDescriptor) => {
          if (isEnabled) {
            webgpuMetrics.bufferAllocations++;
            webgpuMetrics.bufferTotalSize += desc.size;
          }
          // Fix for mapping issue on some devices - force mappedAtCreation to false when we can
          // Unless explicitly requested otherwise
          if (desc.mappedAtCreation === undefined) {
             desc.mappedAtCreation = false;
          }
          return originalCreateBuffer.call(device, desc);
        };
        
        // Hook shader module creation
        const originalCreateShaderModule = device.createShaderModule;
        device.createShaderModule = (desc: GPUShaderModuleDescriptor) => {
          if (isEnabled) {
            const start = performance.now();
            const result = originalCreateShaderModule.call(device, desc);
            const end = performance.now();
            webgpuMetrics.shaderCompilations++;
            webgpuMetrics.shaderCompileTime += (end - start);
            return result;
          }
          return originalCreateShaderModule.call(device, desc);
        };
        
        // Hook pipeline creation
        const originalCreateRenderPipeline = device.createRenderPipeline;
        device.createRenderPipeline = (desc: GPURenderPipelineDescriptor) => {
          if (isEnabled) {
            webgpuMetrics.pipelineCreations++;
          }
          return originalCreateRenderPipeline.call(device, desc);
        };
        
        return device;
      };
      
      return adapter;
    };
  }
}

// ============================================================================
// Phase Management
// ============================================================================

export function startPhase(name: string): void {
  if (!isEnabled) return;
  
  const memoryBefore = getMemoryUsage();
  phases.set(name, {
    name,
    startTime: performance.now(),
    endTime: 0,
    duration: 0,
    memoryBefore,
  });
  
  memorySnapshots.push(memoryBefore);

  // Emit a performance mark so external profilers (Lighthouse, DevTools) can surface it
  try { performance.mark(`candy:phase:${name}:start`); } catch (_e) { /* not all envs support this */ }
}

export function endPhase(name: string): PhaseTiming | null {
  if (!isEnabled) return null;
  
  const phase = phases.get(name);
  if (!phase) return null;
  
  phase.endTime = performance.now();
  phase.duration = phase.endTime - phase.startTime;
  phase.memoryAfter = getMemoryUsage();
  phase.memoryDelta = phase.memoryAfter - (phase.memoryBefore || 0);
  
  phases.delete(name);
  completedPhases.push(phase);

  // Emit performance marks/measure for external profilers
  try {
    performance.mark(`candy:phase:${name}:end`);
    performance.measure(`candy:${name}`, `candy:phase:${name}:start`, `candy:phase:${name}:end`);
  } catch (_e) { /* not all envs support this */ }
  
  // Check for slow phase
  if (phase.duration > config.slowPhaseThreshold) {
    warnings.push(`⚠️ Slow phase detected: "${name}" took ${phase.duration.toFixed(1)}ms (>100ms)`);
  }
  
  // Update overlay
  if (config.enableOverlay) {
    drawOverlay();
  }
  
  return phase;
}

export function recordWASMInit(startTime: number, assemblyScriptReady: boolean, emscriptenReady: boolean): void {
  if (!isEnabled) return;
  
  wasmMetrics.initTime = performance.now() - startTime;
  wasmMetrics.assemblyScriptLoaded = assemblyScriptReady;
  wasmMetrics.emscriptenLoaded = emscriptenReady;
}

export function recordTSLCompile(phaseName: string, duration: number): void {
  if (!isEnabled) return;
  
  tslMetrics.compilePhases.push({
    name: phaseName,
    startTime: 0,
    endTime: 0,
    duration,
  });
  tslMetrics.materialCount++;
}

/**
 * Record shader warmup batch metrics.
 * Call once after the warmup loop completes.
 * @param batches   Total number of batches processed
 * @param batchMaxMs  Duration (ms) of the slowest batch
 */
export function recordWarmupMetrics(batches: number, batchMaxMs: number): void {
  if (!isEnabled) return;
  warmupMetrics.batches = batches;
  warmupMetrics.batchMaxMs = batchMaxMs;
}

/**
 * Increment the generation-chunks-streamed counter.
 * Call once per time-budget yield inside the map-generation loop.
 */
export function recordGenerationChunk(): void {
  if (!isEnabled) return;
  generationChunksStreamed++;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(): StartupReport {
  const finalMemory = getMemoryUsage();
  const initialMemory = memorySnapshots[0] || 0;
  const peakMemory = Math.max(...memorySnapshots, finalMemory);
  
  const totalTime = completedPhases.length > 0
    ? completedPhases[completedPhases.length - 1].endTime - startupStartTime
    : 0;
  
  const slowPhases = completedPhases.filter(p => p.duration > config.slowPhaseThreshold);
  
  return {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    totalTime,
    phases: [...completedPhases],
    memory: {
      initial: initialMemory,
      peak: peakMemory,
      final: finalMemory,
      delta: finalMemory - initialMemory,
    },
    webgpu: { ...webgpuMetrics },
    instancedMeshes: {
      count: instancedMeshMetrics.count,
      totalInstances: instancedMeshMetrics.totalInstances,
      meshesByType: new Map(instancedMeshMetrics.meshesByType),
    },
    wasm: { ...wasmMetrics },
    tsl: { ...tslMetrics },
    warmup: { ...warmupMetrics },
    generationChunksStreamed,
    slowPhases,
    warnings: [...warnings],
  };
}

function saveReportToFile(report: StartupReport): void {
  if (!config.saveToFile) return;
  
  try {
    // Convert Map to plain object for JSON serialization
    const serializableReport = {
      ...report,
      instancedMeshes: {
        ...report.instancedMeshes,
        meshesByType: Object.fromEntries(report.instancedMeshes.meshesByType),
      },
    };
    
    const json = JSON.stringify(serializableReport, null, 2);
    
    // 1. Try to save to the workspace file via a fetch endpoint (if available in dev environment)
    try {
      fetch('/api/save-startup-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      }).catch(() => {
        // Silent fail - this endpoint may not exist in production
      });
    } catch (e) {}
    
    // 2. Also try the specific path for OpenClaw workspace
    try {
      fetch('/root/.openclaw/workspace/candy_world/startup-profile.json', {
        method: 'PUT',
        body: json,
      }).catch(() => {});
    } catch (e) {}
    
    // 3. Create a download link for the user
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'startup-profile.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // 4. Store in localStorage for persistence
    try {
      localStorage.setItem('candy_world_startup_profile', json);
    } catch (e) {}
    
    // 5. Also output to console as a data URI for easy copying
    if (config.enableConsole) {
      console.log('[StartupProfiler] Report ready for download: startup-profile.json');
      console.log('[StartupProfiler] Report also stored in localStorage as "candy_world_startup_profile"');
    }
  } catch (e) {
    console.warn('[StartupProfiler] Failed to save report:', e);
  }
}

function outputReportToConsole(report: StartupReport): void {
  if (!config.enableConsole) return;
  
  console.group('🚀 Candy World Startup Profile');
  console.log(`Total Time: ${formatDuration(report.totalTime)}`);
  console.log(`Timestamp: ${report.timestamp}`);
  
  console.group('⏱️ Phase Breakdown');
  const phaseTable = report.phases.map(p => ({
    Phase: p.name,
    Duration: formatDuration(p.duration),
    'Memory Δ': formatBytes(p.memoryDelta || 0),
    Slow: p.duration > config.slowPhaseThreshold ? '⚠️' : '',
  }));
  console.table(phaseTable);
  console.groupEnd();
  
  console.group('🧠 Memory');
  console.log(`Initial: ${formatBytes(report.memory.initial)}`);
  console.log(`Peak: ${formatBytes(report.memory.peak)}`);
  console.log(`Final: ${formatBytes(report.memory.final)}`);
  console.log(`Delta: ${formatBytes(report.memory.delta)}`);
  console.groupEnd();
  
  console.group('🔷 WebGPU');
  console.log(`Buffer Allocations: ${report.webgpu.bufferAllocations}`);
  console.log(`Buffer Total Size: ${formatBytes(report.webgpu.bufferTotalSize)}`);
  console.log(`Shader Compilations: ${report.webgpu.shaderCompilations}`);
  console.log(`Shader Compile Time: ${formatDuration(report.webgpu.shaderCompileTime)}`);
  console.log(`Pipeline Creations: ${report.webgpu.pipelineCreations}`);
  console.groupEnd();
  
  console.group('📦 Instanced Meshes');
  console.log(`Total Meshes: ${report.instancedMeshes.count}`);
  console.log(`Total Instances: ${report.instancedMeshes.totalInstances.toLocaleString()}`);
  const meshTable = Object.fromEntries(report.instancedMeshes.meshesByType);
  console.table(meshTable);
  console.groupEnd();
  
  console.group('⚡ WASM');
  console.log(`AssemblyScript: ${report.wasm.assemblyScriptLoaded ? '✅' : '❌'}`);
  console.log(`Emscripten: ${report.wasm.emscriptenLoaded ? '✅' : '❌'}`);
  console.log(`Init Time: ${formatDuration(report.wasm.initTime)}`);
  console.groupEnd();
  
  console.group('🎨 TSL Materials');
  console.log(`Material Count: ${report.tsl.materialCount}`);
  if (report.tsl.compilePhases.length > 0) {
    const tslTable = report.tsl.compilePhases.map(p => ({
      Phase: p.name,
      Duration: formatDuration(p.duration),
    }));
    console.table(tslTable);
  }
  console.groupEnd();

  console.group('🔥 Shader Warmup');
  console.log(`Batches: ${report.warmup.batches}`);
  console.log(`Max batch duration: ${formatDuration(report.warmup.batchMaxMs)}`);
  console.groupEnd();

  console.group('🌍 Map Generation');
  console.log(`Chunks streamed: ${report.generationChunksStreamed}`);
  console.groupEnd();
  
  if (report.warnings.length > 0) {
    console.group('⚠️ Warnings');
    report.warnings.forEach(w => console.warn(w));
    console.groupEnd();
  }
  
  console.groupEnd();
  
  // Output raw JSON for programmatic access
  console.log('[StartupProfiler] Raw report available at window.__startupProfile');
  (window as any).__startupProfile = report;
}

// ============================================================================
// Overlay UI
// ============================================================================
import { createOverlay, drawOverlay, hideOverlay, showOverlay } from './startup-profiler-ui.ts';
import { toggleOverlay } from './startup-profiler-ui.ts';

// ============================================================================
// Public API
// ============================================================================

/**
 * Enable the startup profiler
 * @param userConfig Optional configuration overrides
 */
export function enableStartupProfiler(userConfig: Partial<ProfilerConfig> = {}): void {
  if (isEnabled) return;
  
  config = { ...DEFAULT_CONFIG, ...userConfig };
  isEnabled = true;
  startupStartTime = performance.now();
  
  // Reset state
  phases.clear();
  completedPhases = [];
  warnings = [];
  memorySnapshots = [];
  webgpuMetrics = {
    bufferAllocations: 0,
    bufferTotalSize: 0,
    shaderCompilations: 0,
    shaderCompileTime: 0,
    pipelineCreations: 0,
  };
  instancedMeshMetrics = {
    count: 0,
    totalInstances: 0,
    meshesByType: new Map(),
  };
  wasmMetrics = {
    assemblyScriptLoaded: false,
    emscriptenLoaded: false,
    initTime: 0,
    initStartTime: 0,
  };
  tslMetrics = {
    materialCount: 0,
    compilePhases: [],
  };
  warmupMetrics = {
    batches: 0,
    batchMaxMs: 0,
  };
  generationChunksStreamed = 0;
  
  // Record initial memory
  memorySnapshots.push(getMemoryUsage());
  
  // Install hooks
  hookConsole();
  hookInstancedMesh();
  hookWebGPU();
  
  // Create overlay
  if (config.enableOverlay) {
    showOverlay();
  }
  
  if (config.enableConsole) {
    console.log('[StartupProfiler] Enabled - profiling startup performance');
  }
  
  // Start initial phase
  startPhase('Startup Profiler Init');
  endPhase('Startup Profiler Init');
}

/**
 * Disable the startup profiler
 */
export function disableStartupProfiler(): void {
  if (!isEnabled) return;
  
  isEnabled = false;
  
  // Remove hooks
  unhookConsole();
  unhookInstancedMesh();
  
  hideOverlay();
  
  if (config.enableConsole) {
    console.log('[StartupProfiler] Disabled');
  }
}

/**
 * Finalize the startup profile and output the report
 * Call this when startup is complete
 */
export function finalizeStartupProfile(): StartupReport {
  if (!isEnabled) {
    console.warn('[StartupProfiler] Not enabled, cannot finalize');
    return null as any;
  }
  
  const report = generateReport();
  
  // Output to console
  outputReportToConsole(report);
  
  // Save to file
  saveReportToFile(report);
  
  // Update overlay with final data
  drawOverlay();
  
  // Auto-hide overlay after 10 seconds
  setTimeout(() => {
    hideOverlay();
  }, 10000);
  
  return report;
}

/**
 * Toggle the profiler overlay visibility
 */
export function toggleOverlay(): void {
  if (!uiState.overlayContainer || uiState.overlayContainer.style.display === 'none') {
    showOverlay();
  } else {
    hideOverlay();
  }
}

/**
 * Get current profiler status
 */
export function getProfilerStatus(): {
  enabled: boolean;
  phaseCount: number;
  completedPhaseCount: number;
  elapsedTime: number;
} {
  return {
    enabled: isEnabled,
    phaseCount: phases.size,
    completedPhaseCount: completedPhases.length,
    elapsedTime: performance.now() - startupStartTime,
  };
}

/**
 * Manually record a custom phase
 * Useful for tracking specific operations not covered by console.time
 */
export function recordCustomPhase(phaseName: string, duration: number, metadata?: Record<string, any>): void {
  if (!isEnabled) return;
  
  const memoryBefore = getMemoryUsage();
  const now = performance.now();
  
  completedPhases.push({
    name: phaseName,
    startTime: now - duration,
    endTime: now,
    duration,
    memoryBefore,
    memoryAfter: memoryBefore, // Can't know after without re-measuring
    memoryDelta: 0,
  });
  
  if (metadata) {
    if (config.enableConsole) {
      console.log(`[StartupProfiler] Custom phase "${phaseName}": ${formatDuration(duration)}`, metadata);
    }
  }
}

// ============================================================================
// Auto-export for module systems
// ============================================================================

export default {
  enableStartupProfiler,
  disableStartupProfiler,
  finalizeStartupProfile,
  toggleOverlay,
  getProfilerStatus,
  startPhase,
  endPhase,
  recordWASMInit,
  recordTSLCompile,
  recordCustomPhase,
};

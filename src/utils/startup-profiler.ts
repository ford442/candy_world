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

interface PhaseTiming {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  memoryBefore?: number;
  memoryAfter?: number;
  memoryDelta?: number;
}

interface WebGPUMetrics {
  bufferAllocations: number;
  bufferTotalSize: number;
  shaderCompilations: number;
  shaderCompileTime: number;
  pipelineCreations: number;
}

interface InstancedMeshMetrics {
  count: number;
  totalInstances: number;
  meshesByType: Map<string, number>;
}

interface StartupReport {
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
  slowPhases: PhaseTiming[];
  warnings: string[];
}

interface ProfilerConfig {
  slowPhaseThreshold: number; // ms
  enableOverlay: boolean;
  enableConsole: boolean;
  saveToFile: boolean;
  filePath: string;
}

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

// UI Elements
let overlayContainer: HTMLElement | null = null;
let overlayCanvas: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;

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

function createOverlay(): void {
  if (overlayContainer) return;
  
  // Container
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'startup-profiler-overlay';
  overlayContainer.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 10000;
    background: rgba(10, 10, 30, 0.95);
    border: 2px solid #FF6B6B;
    border-radius: 12px;
    padding: 16px;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    color: #fff;
    min-width: 320px;
    max-width: 400px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    transition: opacity 0.3s ease;
  `;
  
  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 107, 107, 0.3);
  `;
  header.innerHTML = `
    <span style="font-weight: bold; font-size: 14px; color: #FF6B6B;">🚀 Startup Profiler</span>
    <button id="startup-profiler-close" style="
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s;
    ">×</button>
  `;
  overlayContainer.appendChild(header);
  
  // Content area
  const content = document.createElement('div');
  content.id = 'startup-profiler-content';
  overlayContainer.appendChild(content);
  
  // Canvas for charts
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 360;
  overlayCanvas.height = 200;
  overlayCanvas.style.cssText = `
    width: 100%;
    height: auto;
    margin-top: 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
  `;
  overlayContainer.appendChild(overlayCanvas);
  overlayCtx = overlayCanvas.getContext('2d');
  
  // Footer with actions
  const footer = document.createElement('div');
  footer.style.cssText = `
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    gap: 8px;
    font-size: 11px;
  `;
  footer.innerHTML = `
    <button id="startup-profiler-export" style="
      background: #FF6B6B;
      border: none;
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
    ">Export JSON</button>
    <button id="startup-profiler-hide" style="
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    ">Hide</button>
  `;
  overlayContainer.appendChild(footer);
  
  document.body.appendChild(overlayContainer);
  
  // Event listeners
  document.getElementById('startup-profiler-close')?.addEventListener('click', hideOverlay);
  document.getElementById('startup-profiler-hide')?.addEventListener('click', hideOverlay);
  document.getElementById('startup-profiler-export')?.addEventListener('click', () => {
    const report = generateReport();
    saveReportToFile(report);
  });
}

function drawOverlay(): void {
  if (!overlayCtx || !overlayCanvas) return;
  
  const ctx = overlayCtx;
  const canvas = overlayCanvas;
  const width = canvas.width;
  const height = canvas.height;
  
  // Clear
  ctx.clearRect(0, 0, width, height);
  
  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(0, 0, width, height);
  
  // Update content HTML
  const content = document.getElementById('startup-profiler-content');
  if (content) {
    const totalTime = completedPhases.length > 0
      ? completedPhases[completedPhases.length - 1].endTime - startupStartTime
      : 0;
    
    const currentMemory = getMemoryUsage();
    const memoryDelta = currentMemory - (memorySnapshots[0] || 0);
    
    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px;">
          <div style="font-size: 10px; color: #888; text-transform: uppercase;">Total Time</div>
          <div style="font-size: 18px; font-weight: bold; color: ${totalTime > 5000 ? '#FF6B6B' : '#4ADE80'};">
            ${formatDuration(totalTime)}
          </div>
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px;">
          <div style="font-size: 10px; color: #888; text-transform: uppercase;">Memory Δ</div>
          <div style="font-size: 18px; font-weight: bold; color: ${memoryDelta > 100 * 1024 * 1024 ? '#FBBF24' : '#4ADE80'};">
            ${formatBytes(memoryDelta)}
          </div>
        </div>
      </div>
      <div style="font-size: 11px; color: #888; margin-bottom: 4px;">Phase Breakdown:</div>
    `;
  }
  
  // Draw phase bars
  const maxDuration = Math.max(...completedPhases.map(p => p.duration), 1);
  const barHeight = 20;
  const barSpacing = 4;
  const maxBars = 6;
  const startY = 10;
  
  completedPhases.slice(-maxBars).forEach((phase, index) => {
    const y = startY + index * (barHeight + barSpacing);
    const barWidth = (phase.duration / maxDuration) * (width - 120);
    
    // Bar background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(80, y, width - 120, barHeight);
    
    // Bar fill - color based on duration
    if (phase.duration > config.slowPhaseThreshold) {
      ctx.fillStyle = '#FF6B6B'; // Red for slow
    } else if (phase.duration > 50) {
      ctx.fillStyle = '#FBBF24'; // Yellow for medium
    } else {
      ctx.fillStyle = '#4ADE80'; // Green for fast
    }
    ctx.fillRect(80, y, barWidth, barHeight);
    
    // Phase name (truncated)
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    const shortName = phase.name.length > 12 ? phase.name.substring(0, 12) + '...' : phase.name;
    ctx.fillText(shortName, 4, y + 14);
    
    // Duration
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.fillText(`${phase.duration.toFixed(0)}ms`, 85 + barWidth + 4, y + 14);
  });
  
  // Draw warnings
  const slowPhases = completedPhases.filter(p => p.duration > config.slowPhaseThreshold);
  if (slowPhases.length > 0) {
    const warningY = startY + maxBars * (barHeight + barSpacing) + 10;
    ctx.fillStyle = '#FF6B6B';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`⚠️ ${slowPhases.length} slow phase(s) detected`, 4, warningY);
  }
  
  // Draw InstancedMesh count
  const meshY = height - 30;
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.fillText(`InstancedMeshes: ${instancedMeshMetrics.count} (${instancedMeshMetrics.totalInstances.toLocaleString()} instances)`, 4, meshY);
  
  // Draw WebGPU metrics
  if (webgpuMetrics.shaderCompilations > 0) {
    ctx.fillText(`Shaders: ${webgpuMetrics.shaderCompilations} compiled in ${formatDuration(webgpuMetrics.shaderCompileTime)}`, 4, meshY + 14);
  }
}

function showOverlay(): void {
  if (!overlayContainer) {
    createOverlay();
  }
  if (overlayContainer) {
    overlayContainer.style.display = 'block';
    overlayContainer.style.opacity = '1';
    drawOverlay();
  }
}

function hideOverlay(): void {
  if (overlayContainer) {
    overlayContainer.style.opacity = '0';
    setTimeout(() => {
      if (overlayContainer) overlayContainer.style.display = 'none';
    }, 300);
  }
}

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
  if (!overlayContainer || overlayContainer.style.display === 'none') {
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

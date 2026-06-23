import { PhaseTiming, InstancedMeshMetrics, WebGPUMetrics, ProfilerConfig, StartupReport } from './startup-profiler-types.ts';
import { formatBytes, formatDuration, getMemoryUsage } from './startup-profiler-utils.ts';


let overlayContainer: HTMLElement | null = null;
let overlayCanvas: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;

export function createOverlay(): void {
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

export function drawOverlay(): void {
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

export function showOverlay(): void {
  if (!overlayContainer) {
    createOverlay();
  }
  if (overlayContainer) {
    overlayContainer.style.display = 'block';
    overlayContainer.style.opacity = '1';
    drawOverlay();
  }
}

export function hideOverlay(): void {
  if (overlayContainer) {
    overlayContainer.style.opacity = '0';
    setTimeout(() => {
      if (overlayContainer) overlayContainer.style.display = 'none';
    }, 300);
  }
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

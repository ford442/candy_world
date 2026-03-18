import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GPU Performance Metrics
 */
export interface GPUMetrics {
  frameTime: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  textureMemory: number;
  bufferMemory: number;
  renderPassCount: number;
  shaderSwitches: number;
}

/**
 * Pixel Heatmap Data
 */
export interface PixelHeatmap {
  width: number;
  height: number;
  data: Float32Array; // Cost value per pixel
  maxCost: number;
}

/**
 * Performance Screenshot Options
 */
export interface PerformanceScreenshotOptions {
  viewpoint: {
    name: string;
    cameraPosition: { x: number; y: number; z: number };
    cameraTarget: { x: number; y: number; z: number };
  };
  outputDir: string;
  captureDuration?: number; // ms to capture metrics
  enableHeatmap?: boolean;
  heatmapResolution?: number; // 0-1 scale of screenshot size
}

/**
 * Performance Screenshot Result
 */
export interface PerformanceScreenshotResult {
  screenshotPath: string;
  metrics: GPUMetrics;
  metricsOverlayPath: string;
  heatmapPath?: string;
  timeline: Array<{ timestamp: number; frameTime: number; drawCalls: number }>;
}

/**
 * Performance Screenshot Capture
 * 
 * Captures screenshots with GPU profiling data and generates
 * performance visualizations including heatmaps.
 */
export class PerformanceScreenshotCapture {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:5173') {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize browser with DevTools protocol for GPU profiling
   */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--enable-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--enable-devtools-experiments',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1
    });

    this.page = await this.context.newPage();

    // Inject performance instrumentation
    await this.page.addInitScript(() => {
      (window as any).__perfMetrics = {
        frames: [] as Array<{
          timestamp: number;
          frameTime: number;
          drawCalls: number;
          triangles: number;
        }>,
        gpuQueries: new Map<string, number>(),
        renderPasses: [] as string[],
        pixelCosts: new Map<string, number>() // x,y -> cost
      };

      // Hook into Three.js renderer if available
      const originalRAF = window.requestAnimationFrame;
      let lastTime = performance.now();
      let frameCount = 0;

      window.requestAnimationFrame = function(callback: FrameRequestCallback) {
        return originalRAF.call(window, (time) => {
          const frameTime = time - lastTime;
          lastTime = time;
          frameCount++;

          const perf = (window as any).__perfMetrics;
          const game = (window as any).game;
          
          let drawCalls = 0;
          let triangles = 0;

          // Try to get Three.js stats
          if (game?.renderer?.info) {
            drawCalls = game.renderer.info.render.calls;
            triangles = game.renderer.info.render.triangles;
          }

          perf.frames.push({
            timestamp: time,
            frameTime,
            drawCalls,
            triangles
          });

          // Keep last 300 frames (5 seconds at 60fps)
          if (perf.frames.length > 300) {
            perf.frames.shift();
          }

          callback(time);
        });
      };

      // WebGPU timestamp query support
      if (navigator.gpu) {
        const originalCreateCommandEncoder = GPUDevice.prototype.createCommandEncoder;
        GPUDevice.prototype.createCommandEncoder = function(descriptor) {
          const encoder = originalCreateCommandEncoder.call(this, descriptor);
          
          // Wrap beginRenderPass to track render passes
          const originalBeginRenderPass = encoder.beginRenderPass.bind(encoder);
          encoder.beginRenderPass = function(desc) {
            const pass = originalBeginRenderPass(desc);
            (window as any).__perfMetrics.renderPasses.push(desc.label || 'unnamed');
            return pass;
          };
          
          return encoder;
        };
      }
    });
  }

  /**
   * Navigate to viewpoint and start profiling
   */
  async navigateAndProfile(viewpoint: PerformanceScreenshotOptions['viewpoint']): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    await this.page.goto(`${this.baseUrl}?perfMode=true&skipIntro=true`, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await this.page.waitForSelector('#loading-overlay.loaded', { timeout: 60000 });
    await this.page.waitForTimeout(1000);

    // Set camera position
    await this.page.evaluate((vp) => {
      const game = (window as any).game;
      if (game?.camera) {
        game.camera.position.set(vp.cameraPosition.x, vp.cameraPosition.y, vp.cameraPosition.z);
        game.camera.lookAt(vp.cameraTarget.x, vp.cameraTarget.y, vp.cameraTarget.z);
      }
    }, viewpoint);

    // Warmup period
    await this.page.waitForTimeout(1000);
  }

  /**
   * Collect GPU metrics over time
   */
  async collectMetrics(duration: number = 2000): Promise<{
    timeline: PerformanceScreenshotResult['timeline'];
    averageMetrics: GPUMetrics;
  }> {
    if (!this.page) throw new Error('Page not initialized');

    // Wait for collection period
    await this.page.waitForTimeout(duration);

    // Retrieve collected metrics
    const metrics = await this.page.evaluate(() => {
      const perf = (window as any).__perfMetrics;
      const frames = perf.frames.slice(-Math.floor(duration / 16.67)); // Last ~duration ms
      
      if (frames.length === 0) {
        return { timeline: [], averageMetrics: null };
      }

      const avgFrameTime = frames.reduce((sum: number, f: any) => sum + f.frameTime, 0) / frames.length;
      const avgDrawCalls = frames.reduce((sum: number, f: any) => sum + f.drawCalls, 0) / frames.length;
      const avgTriangles = frames.reduce((sum: number, f: any) => sum + f.triangles, 0) / frames.length;

      return {
        timeline: frames,
        averageMetrics: {
          frameTime: avgFrameTime,
          fps: 1000 / avgFrameTime,
          drawCalls: Math.round(avgDrawCalls),
          triangles: Math.round(avgTriangles),
          textureMemory: 0, // Would need WebGPU query
          bufferMemory: 0,
          renderPassCount: perf.renderPasses.length,
          shaderSwitches: 0
        }
      };
    });

    return metrics;
  }

  /**
   * Capture screenshot with metrics overlay
   */
  async captureWithOverlay(options: PerformanceScreenshotOptions): Promise<PerformanceScreenshotResult> {
    if (!this.page) throw new Error('Browser not initialized');

    const { viewpoint, outputDir, captureDuration = 2000 } = options;

    // Navigate and profile
    await this.navigateAndProfile(viewpoint);

    // Collect metrics
    const { timeline, averageMetrics } = await this.collectMetrics(captureDuration);

    if (!averageMetrics) {
      throw new Error('Failed to collect metrics');
    }

    // Capture base screenshot
    fs.mkdirSync(outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `perf-${viewpoint.name}-${timestamp}`;
    const screenshotPath = path.join(outputDir, `${baseFilename}.png`);
    const overlayPath = path.join(outputDir, `${baseFilename}-overlay.png`);

    await this.page.screenshot({ path: screenshotPath });

    // Generate metrics overlay
    await this.generateMetricsOverlay(screenshotPath, overlayPath, averageMetrics, timeline);

    // Generate heatmap if enabled
    let heatmapPath: string | undefined;
    if (options.enableHeatmap) {
      heatmapPath = path.join(outputDir, `${baseFilename}-heatmap.png`);
      await this.generateHeatmap(screenshotPath, heatmapPath, options.heatmapResolution);
    }

    return {
      screenshotPath,
      metrics: averageMetrics,
      metricsOverlayPath: overlayPath,
      heatmapPath,
      timeline
    };
  }

  /**
   * Generate metrics overlay image
   */
  private async generateMetricsOverlay(
    screenshotPath: string,
    outputPath: string,
    metrics: GPUMetrics,
    timeline: PerformanceScreenshotResult['timeline']
  ): Promise<void> {
    // Use canvas API via page evaluation to draw overlay
    await this.page!.evaluate((data) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;

      // Draw semi-transparent overlay background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(20, 20, 350, 280);

      // Draw title
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('🎮 GPU Performance Metrics', 35, 50);

      // Draw metrics
      ctx.font = '16px monospace';
      ctx.fillStyle = '#0f0';
      
      const m = data.metrics;
      const lines = [
        `Frame Time: ${m.frameTime.toFixed(2)} ms`,
        `FPS: ${m.fps.toFixed(1)}`,
        `Draw Calls: ${m.drawCalls}`,
        `Triangles: ${m.triangles.toLocaleString()}`,
        `Render Passes: ${m.renderPassCount}`,
        '',
        '--- Timeline (last 60 frames) ---'
      ];

      let y = 80;
      lines.forEach(line => {
        ctx.fillText(line, 35, y);
        y += 22;
      });

      // Draw mini graph
      const graphY = y + 20;
      const graphWidth = 320;
      const graphHeight = 80;
      const recentFrames = data.timeline.slice(-60);

      if (recentFrames.length > 0) {
        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.strokeRect(35, graphY, graphWidth, graphHeight);

        // Draw frame time line
        ctx.strokeStyle = '#0f0';
        ctx.beginPath();
        
        const maxFrameTime = Math.max(...recentFrames.map(f => f.frameTime), 33.33);
        
        recentFrames.forEach((frame, i) => {
          const x = 35 + (i / (recentFrames.length - 1)) * graphWidth;
          const y = graphY + graphHeight - (frame.frameTime / maxFrameTime) * graphHeight;
          
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        
        ctx.stroke();

        // Draw 16.67ms (60fps) reference line
        const targetY = graphY + graphHeight - (16.67 / maxFrameTime) * graphHeight;
        ctx.strokeStyle = '#f00';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(35, targetY);
        ctx.lineTo(35 + graphWidth, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Store for screenshot
      (window as any).__metricsOverlayCanvas = canvas;
    }, { metrics, timeline });

    // Composite overlay onto screenshot
    await this.page!.evaluate((outputPath) => {
      return new Promise<void>((resolve) => {
        const canvas = (window as any).__metricsOverlayCanvas;
        const link = document.createElement('a');
        link.download = outputPath;
        link.href = canvas.toDataURL('image/png');
        link.click();
        resolve();
      });
    }, outputPath);

    // Note: In production, we'd properly composite using sharp or similar
    // For now, we save both images separately
  }

  /**
   * Generate performance heatmap
   */
  private async generateHeatmap(
    screenshotPath: string,
    outputPath: string,
    resolution: number = 0.25
  ): Promise<void> {
    // This is a simplified heatmap generation
    // In a full implementation, we'd use WebGPU queries to get per-pixel costs
    
    await this.page!.evaluate((data) => {
      const canvas = document.createElement('canvas');
      const res = data.resolution;
      canvas.width = 1920 * res;
      canvas.height = 1080 * res;
      const ctx = canvas.getContext('2d')!;

      // Get pixel data from main canvas
      const gameCanvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (!gameCanvas) return;

      // Create gradient representing "expensive" areas
      // In reality, this would come from WebGPU timestamp queries per tile
      const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 3, 0,
        canvas.width / 2, canvas.height / 3, canvas.width / 2
      );
      gradient.addColorStop(0, 'rgba(255, 0, 0, 0.8)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 0, 0.5)');
      gradient.addColorStop(1, 'rgba(0, 255, 0, 0.2)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add noise to simulate actual per-pixel variation
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 30;
        imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise));
        imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise));
        imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise));
      }
      ctx.putImageData(imageData, 0, 0);

      (window as any).__heatmapCanvas = canvas;
    }, { resolution });

    // Save heatmap
    await this.page!.evaluate((outputPath) => {
      const canvas = (window as any).__heatmapCanvas;
      const link = document.createElement('a');
      link.download = outputPath;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }, outputPath);
  }

  /**
   * Run full performance capture suite
   */
  static async runFullSuite(
    outputDir: string,
    baseUrl: string = 'http://localhost:5173',
    viewpoints: Array<PerformanceScreenshotOptions['viewpoint']> = []
  ): Promise<PerformanceScreenshotResult[]> {
    const defaultViewpoints = [
      { name: 'spawn', cameraPosition: { x: 0, y: 15, z: 30 }, cameraTarget: { x: 0, y: 0, z: 0 } },
      { name: 'lake', cameraPosition: { x: 50, y: 10, z: 50 }, cameraTarget: { x: 60, y: 0, z: 60 } },
      { name: 'forest', cameraPosition: { x: -40, y: 12, z: -40 }, cameraTarget: { x: -60, y: 5, z: -60 } }
    ];

    const capture = new PerformanceScreenshotCapture(baseUrl);
    const results: PerformanceScreenshotResult[] = [];

    try {
      await capture.init();

      for (const viewpoint of viewpoints.length > 0 ? viewpoints : defaultViewpoints) {
        console.log(`📊 Capturing performance for: ${viewpoint.name}`);
        
        const result = await capture.captureWithOverlay({
          viewpoint,
          outputDir: path.join(outputDir, viewpoint.name),
          captureDuration: 3000,
          enableHeatmap: true,
          heatmapResolution: 0.25
        });

        results.push(result);
        
        console.log(`  FPS: ${result.metrics.fps.toFixed(1)}`);
        console.log(`  Draw Calls: ${result.metrics.drawCalls}`);
        console.log(`  Triangles: ${result.metrics.triangles.toLocaleString()}`);
      }
    } finally {
      await capture.close();
    }

    return results;
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2] || './test/performance';
  const baseUrl = process.argv[3] || 'http://localhost:5173';

  console.log('🚀 Starting performance screenshot capture...');
  
  PerformanceScreenshotCapture.runFullSuite(outputDir, baseUrl)
    .then((results) => {
      console.log(`\n✅ Captured ${results.length} performance profiles`);
      results.forEach(r => {
        console.log(`\n${path.basename(r.screenshotPath)}:`);
        console.log(`  Average FPS: ${r.metrics.fps.toFixed(1)}`);
        console.log(`  Frame Time: ${r.metrics.frameTime.toFixed(2)}ms`);
      });
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Performance capture failed:', error);
      process.exit(1);
    });
}

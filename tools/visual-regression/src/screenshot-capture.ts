import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Viewport Configuration
 */
export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/**
 * Quality Settings
 */
export type QualitySetting = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityConfig {
  name: QualitySetting;
  renderScale: number;
  antialias: boolean;
  shadows: boolean;
  particleDensity: number;
}

/**
 * Test Viewpoint
 */
export interface Viewpoint {
  name: string;
  description: string;
  cameraPosition: { x: number; y: number; z: number };
  cameraTarget: { x: number; y: number; z: number };
  timeOfDay?: 'day' | 'night' | 'sunset' | 'dawn';
  weather?: 'clear' | 'rain' | 'storm';
  waitForStable: number; // ms to wait for stable frame
}

/**
 * Screenshot Options
 */
export interface ScreenshotOptions {
  viewpoint: Viewpoint;
  quality: QualityConfig;
  viewport: ViewportConfig;
  outputDir: string;
  fullPage?: boolean;
  mask?: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Predefined Viewports
 */
export const VIEWPORTS: ViewportConfig[] = [
  {
    name: 'mobile',
    width: 375,
    height: 667,
    deviceScaleFactor: 2
  },
  {
    name: 'desktop',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1
  },
  {
    name: 'ultrawide',
    width: 3440,
    height: 1440,
    deviceScaleFactor: 1
  },
  {
    name: 'tablet',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2
  }
];

/**
 * Quality Settings Configurations
 */
export const QUALITY_SETTINGS: Record<QualitySetting, QualityConfig> = {
  low: {
    name: 'low',
    renderScale: 0.5,
    antialias: false,
    shadows: false,
    particleDensity: 0.25
  },
  medium: {
    name: 'medium',
    renderScale: 0.75,
    antialias: true,
    shadows: true,
    particleDensity: 0.5
  },
  high: {
    name: 'high',
    renderScale: 1.0,
    antialias: true,
    shadows: true,
    particleDensity: 0.75
  },
  ultra: {
    name: 'ultra',
    renderScale: 1.5,
    antialias: true,
    shadows: true,
    particleDensity: 1.0
  }
};

/**
 * Test Viewpoints for candy_world
 */
export const VIEWPOINTS: Viewpoint[] = [
  {
    name: 'spawn',
    description: 'Player start position - central view of the world',
    cameraPosition: { x: 0, y: 15, z: 30 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    timeOfDay: 'day',
    waitForStable: 2000
  },
  {
    name: 'lake',
    description: 'Water/refractive surfaces - tests water shader quality',
    cameraPosition: { x: 50, y: 10, z: 50 },
    cameraTarget: { x: 60, y: 0, z: 60 },
    timeOfDay: 'day',
    waitForStable: 3000
  },
  {
    name: 'forest',
    description: 'Dense foliage - tests tree rendering and LOD',
    cameraPosition: { x: -40, y: 12, z: -40 },
    cameraTarget: { x: -60, y: 5, z: -60 },
    timeOfDay: 'day',
    waitForStable: 2500
  },
  {
    name: 'night',
    description: 'Night scene - tests lighting and glow effects',
    cameraPosition: { x: 0, y: 15, z: 30 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    timeOfDay: 'night',
    waitForStable: 3000
  },
  {
    name: 'particles',
    description: 'Fireflies, pollen, and particle effects',
    cameraPosition: { x: 20, y: 8, z: 20 },
    cameraTarget: { x: 30, y: 5, z: 30 },
    timeOfDay: 'night',
    waitForStable: 4000 // Particles need more time to stabilize
  },
  {
    name: 'weather',
    description: 'Rain/storm conditions - tests weather effects',
    cameraPosition: { x: 0, y: 20, z: 0 },
    cameraTarget: { x: 50, y: 0, z: 50 },
    timeOfDay: 'day',
    weather: 'rain',
    waitForStable: 3500
  },
  {
    name: 'sunset',
    description: 'Sunset lighting - tests atmospheric scattering',
    cameraPosition: { x: -30, y: 15, z: 30 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    timeOfDay: 'sunset',
    waitForStable: 2000
  }
];

/**
 * Screenshot Capture Class
 */
export class ScreenshotCapture {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:5173') {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize browser and page
   */
  async init(viewport: ViewportConfig, browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium'): Promise<void> {
    const browserLauncher = { chromium, firefox, webkit }[browserType];
    
    this.browser = await browserLauncher.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--enable-webgl',
        '--enable-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      deviceScaleFactor: viewport.deviceScaleFactor,
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    this.page = await this.context.newPage();
    
    // Inject performance monitoring
    await this.page.addInitScript(() => {
      (window as any).__visualRegression = {
        frameCount: 0,
        lastFrameTime: 0,
        stableFrames: 0,
        isStable: false,
        gpuMetrics: {
          frameTimes: [] as number[],
          drawCalls: 0,
          triangles: 0
        }
      };

      // Override requestAnimationFrame to track stability
      const originalRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function(callback: FrameRequestCallback) {
        return originalRAF.call(window, (time) => {
          const vr = (window as any).__visualRegression;
          const delta = time - vr.lastFrameTime;
          vr.lastFrameTime = time;
          vr.frameCount++;
          
          // Track frame times for stability detection
          if (vr.gpuMetrics.frameTimes.length < 60) {
            vr.gpuMetrics.frameTimes.push(delta);
          } else {
            vr.gpuMetrics.frameTimes.shift();
            vr.gpuMetrics.frameTimes.push(delta);
          }
          
          // Check for stability (low variance in frame times)
          if (vr.gpuMetrics.frameTimes.length >= 30) {
            const avg = vr.gpuMetrics.frameTimes.reduce((a: number, b: number) => a + b, 0) / vr.gpuMetrics.frameTimes.length;
            const variance = vr.gpuMetrics.frameTimes.reduce((sum: number, val: number) => sum + Math.pow(val - avg, 2), 0) / vr.gpuMetrics.frameTimes.length;
            vr.isStable = variance < 5; // Low variance indicates stable frame
            if (vr.isStable) vr.stableFrames++;
          }
          
          callback(time);
        });
      };
    });
  }

  /**
   * Navigate to the game and set up conditions
   */
  async navigate(options: ScreenshotOptions): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    // Build URL with quality parameters
    const params = new URLSearchParams({
      quality: options.quality.name,
      renderScale: options.quality.renderScale.toString(),
      antialias: options.quality.antialias.toString(),
      shadows: options.quality.shadows.toString(),
      particleDensity: options.quality.particleDensity.toString(),
      visualRegression: 'true',
      skipIntro: 'true'
    });

    await this.page.goto(`${this.baseUrl}?${params.toString()}`, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Wait for the game to initialize
    // We wait for the #candy-loading-overlay to not have the .visible class, or for __sceneReady
    await this.page.waitForFunction(() => {
      const el = document.getElementById('candy-loading-overlay');
      return (window as any).__sceneReady === true || (el && el.classList.contains('loaded')) || (el && !el.classList.contains('visible')) || !el;
    }, { timeout: 60000 });
    await this.page.waitForTimeout(1000);

    // Set up camera position and environment
    await this.setupViewpoint(options.viewpoint);
  }

  /**
   * Set up camera and environment for a specific viewpoint
   */
  private async setupViewpoint(viewpoint: Viewpoint): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.evaluate((vp) => {
      // Access the game's camera and scene through the global game instance
      const game = (window as any).game;
      if (!game) return;

      // Set camera position
      if (game.camera) {
        game.camera.position.set(vp.cameraPosition.x, vp.cameraPosition.y, vp.cameraPosition.z);
        game.camera.lookAt(vp.cameraTarget.x, vp.cameraTarget.y, vp.cameraTarget.z);
      }

      // Set time of day
      if (vp.timeOfDay && game.timeSystem) {
        const timeMap: Record<string, number> = {
          'dawn': 0.2,
          'day': 0.5,
          'sunset': 0.75,
          'night': 0.95
        };
        game.timeSystem.setTime(timeMap[vp.timeOfDay] || 0.5);
      }

      // Set weather
      if (vp.weather && game.weatherSystem) {
        game.weatherSystem.setWeather(vp.weather);
      }

      // Pause animations for consistent screenshots
      if (game.clock) {
        game.clock.autoStart = false;
      }
    }, viewpoint);

    // Wait for the specified time for the frame to stabilize
    await this.page.waitForTimeout(viewpoint.waitForStable);
  }

  /**
   * Wait for a stable frame (no animation jitter)
   */
  async waitForStableFrame(minStableFrames: number = 10): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.waitForFunction(
      (minFrames) => {
        const vr = (window as any).__visualRegression;
        return vr && vr.stableFrames >= minFrames;
      },
      minStableFrames,
      { timeout: 30000 }
    );
  }

  /**
   * Capture screenshot
   */
  async capture(options: ScreenshotOptions): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');

    // Wait for stable frame if needed
    await this.waitForStableFrame(10);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${options.viewpoint.name}-${options.quality.name}-${options.viewport.name}-${timestamp}.png`;
    const filepath = path.join(options.outputDir, filename);

    // Ensure output directory exists
    fs.mkdirSync(options.outputDir, { recursive: true });

    // Take screenshot
    await this.page.screenshot({
      path: filepath,
      fullPage: options.fullPage || false,
      mask: options.mask?.map(m => ({
        selector: 'body',
        frame: { x: m.x, y: m.y, width: m.width, height: m.height }
      }))
    });

    return filepath;
  }

  /**
   * Get performance metrics
   */
  async getMetrics(): Promise<{
    frameCount: number;
    averageFrameTime: number;
    stableFrames: number;
  }> {
    if (!this.page) throw new Error('Page not initialized');

    const metrics = await this.page.evaluate(() => {
      const vr = (window as any).__visualRegression;
      const avgFrameTime = vr.gpuMetrics.frameTimes.length > 0
        ? vr.gpuMetrics.frameTimes.reduce((a: number, b: number) => a + b, 0) / vr.gpuMetrics.frameTimes.length
        : 0;
      
      return {
        frameCount: vr.frameCount,
        averageFrameTime: avgFrameTime,
        stableFrames: vr.stableFrames
      };
    });

    return metrics;
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

  /**
   * Run full capture suite for all viewpoints, qualities, and viewports
   */
  static async runFullSuite(
    outputDir: string,
    baseUrl: string = 'http://localhost:5173',
    options?: {
      viewpoints?: Viewpoint[];
      qualities?: QualitySetting[];
      viewports?: ViewportConfig[];
      onProgress?: (completed: number, total: number, current: string) => void;
    }
  ): Promise<string[]> {
    const viewpoints = options?.viewpoints || VIEWPOINTS;
    const qualities = options?.qualities || Object.keys(QUALITY_SETTINGS) as QualitySetting[];
    const viewports = options?.viewports || VIEWPORTS;

    const capturedScreenshots: string[] = [];
    const total = viewpoints.length * qualities.length * viewports.length;
    let completed = 0;

    for (const viewpoint of viewpoints) {
      for (const qualityName of qualities) {
        for (const viewport of viewports) {
          const quality = QUALITY_SETTINGS[qualityName];
          const capture = new ScreenshotCapture(baseUrl);
          
          try {
            await capture.init(viewport);
            
            const screenshotOptions: ScreenshotOptions = {
              viewpoint,
              quality,
              viewport,
              outputDir: path.join(outputDir, viewpoint.name, qualityName)
            };

            await capture.navigate(screenshotOptions);
            const filepath = await capture.capture(screenshotOptions);
            capturedScreenshots.push(filepath);

            completed++;
            options?.onProgress?.(completed, total, filepath);
          } finally {
            await capture.close();
          }
        }
      }
    }

    return capturedScreenshots;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2] || './test/screenshots';
  const baseUrl = process.argv[3] || 'http://localhost:5173';

  console.log('🎮 Starting visual regression screenshot capture...');
  console.log(`Output directory: ${outputDir}`);
  console.log(`Base URL: ${baseUrl}`);

  ScreenshotCapture.runFullSuite(outputDir, baseUrl, {
    onProgress: (completed, total, current) => {
      const pct = Math.round((completed / total) * 100);
      console.log(`[${pct}%] Captured: ${path.basename(current)}`);
    }
  }).then((screenshots) => {
    console.log(`\n✅ Captured ${screenshots.length} screenshots`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ Capture failed:', error);
    process.exit(1);
  });
}

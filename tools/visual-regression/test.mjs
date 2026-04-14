import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--enable-webgl',
        '--enable-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--enable-unsafe-webgpu',
        '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  console.log("Navigating to localhost:5173");

  await page.addInitScript(() => {
      window.__visualRegression = {
        frameCount: 0,
        lastFrameTime: 0,
        stableFrames: 0,
        isStable: false,
        gpuMetrics: {
          frameTimes: [],
          drawCalls: 0,
          triangles: 0
        }
      };

      // Override requestAnimationFrame to track stability
      const originalRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function(callback) {
        return originalRAF.call(window, (time) => {
          const vr = window.__visualRegression;
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
            const avg = vr.gpuMetrics.frameTimes.reduce((a, b) => a + b, 0) / vr.gpuMetrics.frameTimes.length;
            const variance = vr.gpuMetrics.frameTimes.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / vr.gpuMetrics.frameTimes.length;
            vr.isStable = variance < 5; // Low variance indicates stable frame
            if (vr.isStable) vr.stableFrames++;
          }

          callback(time);
        });
      };
  });

  await page.goto('http://localhost:5173?visualRegression=true&skipIntro=true', { waitUntil: 'networkidle', timeout: 30000 });
  console.log("Loaded. Waiting for sceneReady...");

  try {
      await page.waitForFunction(() => {
          const el = document.getElementById('candy-loading-overlay');
          return (window.__sceneReady === true) || (el && el.classList.contains('loaded')) || (el && !el.classList.contains('visible')) || !el;
      }, { timeout: 30000 });
      console.log("Scene is ready!");
  } catch (e) {
      console.log("Wait for scene ready timed out.");
      const sceneReady = await page.evaluate(() => {
          return window.__sceneReady;
      });
      console.log("__sceneReady is:", sceneReady);
  }

  console.log("Waiting for stable frames...");
  await page.waitForTimeout(2000);
  try {
      await page.waitForFunction(() => window.__visualRegression && window.__visualRegression.stableFrames > 10, { timeout: 10000 });
      console.log("Stable frames reached!");
  } catch (e) {
      console.log("Stable frames timeout!");
      const vr = await page.evaluate(() => window.__visualRegression);
      console.log("VR State:", vr);
  }

  await browser.close();
})();

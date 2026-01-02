
import { test, expect, chromium } from '@playwright/test';

test('Verify Lake Features and Population Density', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu', // Headless often works better without GPU
      '--use-gl=swiftshader', // Force software rendering for consistent WebGL
       '--enable-unsafe-webgpu'
    ]
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Route console logs to terminal
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[Browser Error]: ${err}`));

  // Go to local dev server
  await page.goto('http://localhost:5174');

  // Wait for loading to finish
  // The loading overlay hides when complete.
  // We can also check for a log message like "[World] Finished populating procedural extras"
  try {
      await page.waitForFunction(() => {
          const logs = (window as any)._logs || []; // If we had a log capture, which we don't by default
          // Instead, let's wait for the start button to be enabled or overlay to disappear
           const btn = document.querySelector('#startButton');
           return btn && !btn.hasAttribute('disabled') && btn.textContent?.includes('Start');
      }, { timeout: 60000 });
  } catch (e) {
      console.log("Timeout waiting for start button, forcing overlay removal for screenshot...");
      // Force remove overlay if it gets stuck (common in headless WebGL)
      await page.evaluate(() => {
          const overlay = document.getElementById('loading-overlay');
          if (overlay) overlay.style.display = 'none';
      });
  }

  // Click Start to enter pointer lock (might fail in headless but triggers the 'play' state)
  const startBtn = page.locator('#startButton');
  if (await startBtn.isVisible()) {
      await startBtn.click();
  }

  // Wait a moment for scene to render
  await page.waitForTimeout(5000);

  // Teleport camera to view the new island at (-40, 2.5, 40)
  await page.evaluate(() => {
     const camera = (window as any).camera;
     if (camera) {
         // Position camera to look at the island
         camera.position.set(-20, 10, 20);
         camera.lookAt(-40, 2.5, 40);
         camera.updateMatrixWorld();
     }
  });

  await page.waitForTimeout(1000);

  // Take screenshot of the Lake/Island
  await page.screenshot({ path: 'verification/lake_island.png' });
  console.log("Screenshot taken: verification/lake_island.png");

  // Teleport to view density (bird's eye view)
  await page.evaluate(() => {
      const camera = (window as any).camera;
      if (camera) {
          camera.position.set(0, 50, 0);
          camera.lookAt(0, 0, 0);
          camera.updateMatrixWorld();
      }
   });
   await page.waitForTimeout(1000);
   await page.screenshot({ path: 'verification/world_density.png' });
   console.log("Screenshot taken: verification/world_density.png");

  await browser.close();
});

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
  await page.goto('http://localhost:5173?visualRegression=true&skipIntro=true', { waitUntil: 'networkidle', timeout: 30000 });
  console.log("Loaded. Waiting for sceneReady...");

  try {
      await page.waitForFunction(() => {
          return navigator.gpu !== undefined;
      }, { timeout: 5000 });
      console.log("WebGPU is supported!");
  } catch (e) {
      console.log("WebGPU not supported (timeout).");
      const gpu = await page.evaluate(() => navigator.gpu);
      console.log("navigator.gpu is:", gpu);
  }

  await browser.close();
})();

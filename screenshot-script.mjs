import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-webgpu']
  });
  const page = await browser.newPage();

  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });

  // Wait for the loading screen to finish and the start button to appear
  await page.waitForSelector('#startButton', { timeout: 30000 });

  // Select full mode
  await page.evaluate(() => {
    const btn = document.getElementById('btn-fast-full');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);

  // Click start button
  await page.evaluate(() => {
    const startBtn = document.getElementById('startButton');
    if (startBtn) startBtn.click();
  });

  // Wait for the scene to become ready
  await page.waitForFunction(() => window.__sceneReady === true, { timeout: 60000 });

  // Wait a bit for the world to populate
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'frontend-verification.png' });

  // Move player
  await page.keyboard.down('w');
  await page.waitForTimeout(2000);
  await page.keyboard.up('w');

  await page.screenshot({ path: 'frontend-interaction.png' });

  await browser.close();
})();

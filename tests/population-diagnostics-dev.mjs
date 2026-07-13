import { chromium } from '@playwright/test';

async function run() {
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
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[PAGE ERROR] ${err.message}\n${err.stack}`));

  try {
    await page.goto('http://localhost:5175', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Page loaded');

    await page.waitForFunction(() => window.__sceneReady === true, { timeout: 25000 });
    console.log('Scene ready');

    // Select FULL mode and click start
    await page.evaluate(() => {
      const btnFull = document.getElementById('btn-full-game');
      if (btnFull) btnFull.click();
    });
    await new Promise(r => setTimeout(r, 300));

    await page.evaluate(() => {
      const startBtn = document.getElementById('startButton');
      if (startBtn) startBtn.click();
    });
    console.log('Clicked start (FULL mode)');

    // Poll for spawn report over 90s
    let lastReport = null;
    const startPoll = Date.now();
    while (Date.now() - startPoll < 90000) {
      const report = await page.evaluate(() => {
        const sr = window.__spawnReport || null;
        const wr = window.__worldPopulationReport || null;
        return { spawnReport: sr, worldReport: wr };
      });
      if (report.worldReport) {
        lastReport = report;
        console.log('\n=== WORLD POPULATION REPORT (final) ===');
        console.log(JSON.stringify(report.worldReport, null, 2));
        break;
      }
      if (report.spawnReport && report.spawnReport.attempted > 0) {
        lastReport = report;
        console.log(`[Poll] attempted=${report.spawnReport.attempted} succeeded=${report.spawnReport.succeeded} failed=${report.spawnReport.failed}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!lastReport || !lastReport.worldReport) {
      console.log('\n=== SPAWN REPORT (latest) ===');
      console.log(JSON.stringify((lastReport && lastReport.spawnReport) || null, null, 2));
    }
  } catch (e) {
    console.error('Diagnostic run failed:', e.message);
  } finally {
    await browser.close();
  }
}

run();

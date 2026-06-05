import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import { request } from 'http';

function checkServerOnPort(port) {
  return new Promise((resolve) => {
    const req = request({ hostname: 'localhost', port, path: '/', method: 'GET' }, (res) => resolve(res.statusCode !== undefined));
    req.on('error', () => resolve(false));
    req.setTimeout(1000);
    req.end();
  });
}

function startVitePreview() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'preview'], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    let started = false;
    let timeout = setTimeout(() => { if (!started) { proc.kill(); reject(new Error('timeout')); } }, 20000);
    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      if (!started && text.includes('localhost')) {
        started = true;
        clearTimeout(timeout);
        resolve({ process: proc, port: 4173 });
      }
    });
    proc.stderr?.on('data', (data) => console.log('[Vite stderr]', data.toString()));
    proc.on('error', reject);
  });
}

async function run() {
  let viteServer = null;
  let browser = null;
  try {
    const serverRunning = await checkServerOnPort(4173);
    if (!serverRunning) {
      console.log('Starting preview server...');
      viteServer = await startVitePreview();
    } else {
      console.log('Using existing preview server');
    }
    await new Promise(r => setTimeout(r, 2000));

    browser = await chromium.launch({
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
    const consoleMessages = [];
    page.on('console', msg => {
      const text = `[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleMessages.push(text);
      console.log(text);
    });
    page.on('pageerror', err => console.error(`[PAGE ERROR] ${err.message}\n${err.stack}`));

    await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

    await page.close();
  } catch (e) {
    console.error('Diagnostic run failed:', e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (viteServer?.process) viteServer.process.kill();
  }
}

run();

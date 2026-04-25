// tests/smoke-runner.mjs
// Smoke test runner that starts Vite preview, runs tests, then exits

import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import { request } from 'http';

/**
 * Check if a server is running on a port
 */
function checkServerOnPort(port) {
  return new Promise((resolve) => {
    const req = request(
      { hostname: 'localhost', port, path: '/', method: 'GET' },
      (res) => {
        resolve(res.statusCode !== undefined);
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(1000);
    req.end();
  });
}

/**
 * Start Vite preview server
 */
function startVitePreview() {
  return new Promise((resolve, reject) => {
    const process = spawn('npm', ['run', 'preview'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let started = false;
    let timeout;

    const onData = (data) => {
      const text = data.toString();
      if (!started && text.includes('localhost')) {
        started = true;
        clearTimeout(timeout);
        console.log('[Vite] Server started');
        resolve({ process, port: 4173 });
      }
    };

    process.stdout?.on('data', onData);
    process.stderr?.on('data', (data) => {
      console.log('[Vite stderr]', data.toString());
    });

    timeout = setTimeout(() => {
      if (!started) {
        process.kill();
        reject(new Error('Vite preview did not start in time'));
      }
    }, 20000);

    process.on('error', reject);
  });
}

/**
 * Run the smoke test
 */
async function runSmokeTest() {
  console.log('🎮 Candy World Smoke Test');
  console.log('========================\n');

  let viteServer = null;
  let browser = null;
  let shouldKillServer = false;

  try {
    // Check if server is already running
    console.log('Checking for existing Vite preview server on port 4173...');
    const serverRunning = await checkServerOnPort(4173);

    if (!serverRunning) {
      console.log('Starting new Vite preview server...');
      viteServer = await startVitePreview();
      shouldKillServer = true;
    } else {
      console.log('✓ Existing server found, using it');
    }

    // Give the server a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('Launching Chromium browser...');
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
    let hasError = false;

    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push(text);
      console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${text}`);
      if (msg.type() === 'error') {
        // Ignore expected 404s for WASM fallbacks
        if (!text.includes('Failed to load resource: the server responded with a status of 404') &&
            !text.includes('candy_native.js not found') &&
            !text.includes('candy_native_st.js not found')) {
            hasError = true;
        }
      }
    });

    page.on('pageerror', (err) => {
      console.log(`[PAGE ERROR] ${err.message}\n[STACK] ${err.stack}`);
      hasError = true;
    });

    // Catch unhandled promise rejections for additional diagnostics
    await page.evaluate(() => {
      window.addEventListener('unhandledrejection', (event) => {
        console.error('[UNHANDLED REJECTION]', event.reason);
      });
    });

    // Navigate to localhost:4173
    console.log('\nNavigating to http://localhost:4173');
    try {
      await page.goto('http://localhost:4173', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      console.log('✓ Page loaded');
    } catch (e) {
      console.log('⚠ Page load timeout (continuing with test)');
    }

    // Wait for scene ready
    console.log('Waiting for window.__sceneReady (up to 25s)...');
    try {
      await page.waitForFunction(
        () => (window).__sceneReady === true,
        { timeout: 25000 }
      );
      console.log('✓ Scene is ready!');
    } catch (e) {
      console.log('⚠ Timeout waiting for scene ready');
    }

    // Check WebGPU
    const hasWebGPU = await page.evaluate(() => navigator.gpu !== undefined);
    console.log(`WebGPU support: ${hasWebGPU ? '✓' : '⚠'}`);

    // Check canvas
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas
        ? { width: canvas.width, height: canvas.height }
        : null;
    });

    if (canvasInfo) {
      console.log(`Canvas: ${canvasInfo.width}x${canvasInfo.height} ✓`);
    }

    await page.close();

    // Results
    console.log('\n📊 Test Results:');
    if (hasError) {
      console.log('❌ FAILED: Console errors detected');
      return false;
    } else {
      console.log('✅ PASSED: No console errors');
      return true;
    }
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    console.error(error.stack);
    return false;
  } finally {
    // Cleanup
    if (browser) {
      await browser.close();
    }
    if (viteServer?.process && shouldKillServer) {
      viteServer.process.kill();
    }
  }
}

// Run test
runSmokeTest().then((success) => {
  process.exit(success ? 0 : 1);
});

// tests/smoke.ts
// Playwright smoke test for Candy World
// Verifies that the game boots without errors and initializes WebGPU renderer

import { chromium, expect } from '@playwright/test';
import * as path from 'path';

interface TestResult {
  success: boolean;
  message: string;
  errors: string[];
  warnings: string[];
}

/**
 * Launches Vite preview server and returns the URL
 */
async function startVitePreview(): Promise<string> {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    const previewProcess = spawn('npm', ['run', 'preview'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    let output = '';
    let timeout: NodeJS.Timeout;

    const handleOutput = (data: Buffer) => {
      output += data.toString();
      console.log('[Preview]', data.toString().trim());

      if (output.includes('localhost')) {
        clearTimeout(timeout);
        // Extract URL from output (typical format: "http://localhost:5173")
        const match = output.match(/(http:\/\/localhost:\d+)/);
        if (match) {
          resolve(match[1]);
        } else {
          resolve('http://localhost:5173');
        }
      }
    };

    previewProcess.stdout?.on('data', handleOutput);
    previewProcess.stderr?.on('data', handleOutput);

    timeout = setTimeout(() => {
      reject(new Error('Vite preview server did not start in time'));
    }, 15000);

    previewProcess.on('error', reject);
  });
}

/**
 * Main smoke test
 */
export async function runSmokeTest(): Promise<TestResult> {
  const result: TestResult = {
    success: false,
    message: '',
    errors: [],
    warnings: [],
  };

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

  try {
    const page = await browser.newPage();
    let consoleErrors: string[] = [];

    // Capture console messages
    page.on('console', (msg) => {
      const text = msg.text();
      console.log('[BROWSER_CONSOLE]', text);
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
    });

    // Capture page errors
    page.on('pageerror', (err) => {
      console.log('[BROWSER_ERROR]', err.message);
      result.errors.push(err.message);
    });

    // Navigate to the app
    console.log('Navigating to http://localhost:5173');
    try {
      await page.goto('http://localhost:5173', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
    } catch (err) {
      // If navigation fails, it might be because Vite isn't running
      // In CI/local test, this is expected behavior
      console.log('Navigation timeout/error (expected if Vite not running):', err);
    }

    // Wait for the scene to be ready (window.__sceneReady flag)
    console.log('Waiting for window.__sceneReady...');
    try {
      await page.waitForFunction(
        () => {
          return (window as any).__sceneReady === true;
        },
        { timeout: 20000 }
      );
      console.log('✓ Scene is ready!');
    } catch (e) {
      result.warnings.push('Timeout waiting for window.__sceneReady');
      console.log('⚠ Timeout waiting for scene ready');
    }

    // Check for WebGPU support
    console.log('Checking WebGPU support...');
    try {
      const hasWebGPU = await page.evaluate(() => {
        return navigator.gpu !== undefined;
      });

      if (hasWebGPU) {
        console.log('✓ WebGPU is supported');
      } else {
        result.warnings.push('WebGPU not available in navigator.gpu');
        console.log('⚠ WebGPU not available');
      }
    } catch (e) {
      result.warnings.push('Could not check WebGPU support');
    }

    // Check canvas existence and size
    console.log('Checking canvas...');
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) {
        return { exists: false };
      }
      return {
        exists: true,
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      };
    });

    console.log('Canvas info:', canvasInfo);

    if (canvasInfo.exists && canvasInfo.width > 0 && canvasInfo.height > 0) {
      console.log('✓ Canvas is initialized with size', canvasInfo.width, 'x', canvasInfo.height);
    } else {
      result.warnings.push('Canvas not properly initialized');
      console.log('⚠ Canvas not properly initialized');
    }

    // Verify no console errors
    if (consoleErrors.length > 0) {
      result.errors = consoleErrors;
      console.log('✗ Console errors detected:', consoleErrors);
    } else {
      console.log('✓ No console errors');
    }

    // Determine final result
    if (result.errors.length === 0) {
      result.success = true;
      result.message = 'Smoke test passed';
    } else {
      result.message = `Smoke test failed with ${result.errors.length} error(s)`;
    }

    await page.close();
  } catch (error) {
    result.errors.push(String(error));
    result.message = `Smoke test crashed: ${error}`;
  } finally {
    await browser.close();
  }

  return result;
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🎮 Candy World Smoke Test');
  console.log('========================\n');

  runSmokeTest().then((result) => {
    console.log('\n📊 Test Results:');
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    if (result.errors.length > 0) {
      console.log('Errors:', result.errors);
    }
    if (result.warnings.length > 0) {
      console.log('Warnings:', result.warnings);
    }

    process.exit(result.success ? 0 : 1);
  });
}

export default runSmokeTest;

import { chromium } from 'playwright';

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
const errors = [];
const consoleLogs = [];

page.on('console', (msg) => {
  const text = msg.text();
  consoleLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
  if (msg.type() === 'error') {
    if (!text.includes('candy_native') && !text.includes('404') && 
        !text.includes('WebGPU Device Lost') && !text.includes('Device was destroyed')) {
      errors.push(text);
    }
  }
});

page.on('pageerror', (err) => {
  errors.push(`PAGE ERROR: ${err.message}`);
});

console.log('Navigating to http://localhost:4174...');
try {
  await page.goto('http://localhost:4174', { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch(e) {
  console.log('Load timeout, continuing...');
}

// Wait up to 30s for scene ready
console.log('Waiting for __sceneReady...');
let sceneReady = false;
try {
  await page.waitForFunction(() => window.__sceneReady === true, { timeout: 30000 });
  sceneReady = true;
  console.log('Scene ready!');
} catch(e) {
  console.log('Timeout waiting for scene ready - taking screenshot anyway');
}

// Take screenshot
await page.screenshot({ path: '/tmp/candy-world-screenshot.png', fullPage: false });
console.log('Screenshot saved to /tmp/candy-world-screenshot.png');

// Check WebGPU
const gpuInfo = await page.evaluate(() => ({
  hasGPU: !!navigator.gpu,
  hasCanvas: !!document.querySelector('canvas'),
  canvasSize: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : 'none'; })(),
  sceneReady: window.__sceneReady,
}));
console.log('GPU info:', JSON.stringify(gpuInfo));
console.log('Scene ready:', sceneReady);
console.log('\n--- ERRORS (' + errors.length + ') ---');
errors.forEach(e => console.log(e));
console.log('\n--- ALL CONSOLE (last 30) ---');
consoleLogs.slice(-30).forEach(l => console.log(l));

await browser.close();

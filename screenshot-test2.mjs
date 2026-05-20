import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security',
    '--enable-webgl', '--enable-webgpu', '--enable-features=Vulkan,WebGPU',
    '--enable-unsafe-webgpu', '--disable-features=IsolateOrigins,site-per-process',
  ],
});

const page = await browser.newPage();
const allLogs = [];

page.on('console', (msg) => {
  allLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  allLogs.push(`[PAGEERROR] ${err.message}`);
});

await page.goto('http://localhost:4174', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Wait for scene ready or 60s
let sceneReady = false;
try {
  await page.waitForFunction(() => window.__sceneReady === true, { timeout: 60000 });
  sceneReady = true;
} catch(e) {}

// Extra 5s to let shaders compile
await new Promise(r => setTimeout(r, 5000));

await page.screenshot({ path: '/tmp/candy-world-2.png' });

const info = await page.evaluate(() => ({
  sceneReady: window.__sceneReady,
  hasGPU: !!navigator.gpu,
  canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : 'none'; })(),
  startupProfile: window.__startupProfile ? Object.keys(window.__startupProfile) : null,
}));

console.log('Scene ready:', sceneReady);
console.log('Info:', JSON.stringify(info, null, 2));
console.log('\n=== ALL LOGS ===');
allLogs.forEach(l => console.log(l));
await browser.close();

import { chromium } from 'playwright';
const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({
  executablePath: EXEC, headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security',
    '--enable-webgl','--enable-webgpu','--enable-features=Vulkan,WebGPU',
    '--enable-unsafe-webgpu','--disable-features=IsolateOrigins,site-per-process'],
});
const page = await browser.newPage();
const errors = [], logs = [];
page.on('console', msg => {
  const t = msg.text();
  logs.push(`[${msg.type().toUpperCase()}] ${t}`);
  if(msg.type()==='error') errors.push(t);
});
page.on('pageerror', err => errors.push('PAGEERROR: '+err.message));

await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('Waiting for __sceneReady...');
try { await page.waitForFunction(() => window.__sceneReady===true, {timeout:30000}); } catch(e){ console.log('timeout on sceneReady'); }

// Wait for startButton to be enabled and click it
console.log('Waiting for startButton...');
try {
  await page.waitForFunction(() => {
    const btn = document.getElementById('startButton');
    return btn && !btn.disabled;
  }, {timeout: 10000});
  await page.evaluate(() => {
    const btn = document.getElementById('startButton');
    console.log('Clicking startButton:', btn?.textContent?.trim());
    btn?.click();
  });
  console.log('Clicked startButton');
} catch(e) { console.log('startButton not found or disabled:', e.message); }

// Wait for world generation to complete (look for "Entering world" log or worldGenerated flag)
console.log('Waiting for world generation...');
try {
  await page.waitForFunction(() => window.__worldGenerated === true, {timeout: 60000});
  console.log('World generated!');
} catch(e) {
  console.log('__worldGenerated not set, waiting 15s instead...');
  await new Promise(r=>setTimeout(r, 15000));
}

await page.screenshot({ path: '/tmp/candy-world-entered.png', fullPage: false });

const info = await page.evaluate(() => ({
  sceneReady: window.__sceneReady,
  worldGenerated: window.__worldGenerated,
  gpuDeviceLost: window.__gpuDeviceLost,
  canvas: (()=>{const c=document.querySelector('canvas');return c?`${c.width}x${c.height}`:'none'})(),
}));
console.log('Info:', JSON.stringify(info));
const filtered = errors.filter(e=>!e.includes('candy_native')&&!e.includes('404')&&!e.includes('audio-processor'));
console.log('\nKey errors ('+filtered.length+'):', filtered.slice(0,10));
console.log('\n--- LAST 20 LOGS ---');
logs.slice(-20).forEach(l=>console.log(l));
await browser.close();

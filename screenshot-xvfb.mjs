import { chromium } from 'playwright';
const EXEC = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';

const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false,
  args: [
    '--no-sandbox','--disable-setuid-sandbox','--disable-web-security',
    '--enable-webgl','--enable-webgpu',
    '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
    '--enable-unsafe-webgpu',
    '--use-gl=swiftshader',
    '--disable-features=IsolateOrigins,site-per-process',
    '--display=:99',
  ],
  env: { ...process.env, DISPLAY: ':99' },
});

const page = await browser.newPage();
page.setViewportSize({ width: 1280, height: 720 });
const errors = [], logs = [];
page.on('console', msg => {
  const t = msg.text();
  logs.push(`[${msg.type().toUpperCase()}] ${t}`);
  if(msg.type()==='error') errors.push(t);
});
page.on('pageerror', err => errors.push('PAGEERROR: '+err.message));

await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('Waiting for __sceneReady...');
try { await page.waitForFunction(() => window.__sceneReady===true, {timeout:30000}); console.log('Scene ready!'); } catch(e){ console.log('timeout'); }

await page.waitForFunction(() => { const b=document.getElementById('startButton'); return b&&!b.disabled; }, {timeout:10000}).catch(()=>{});
await page.evaluate(() => { document.getElementById('startButton')?.click(); });
console.log('Clicked Enter World');

await new Promise(r=>setTimeout(r, 20000));
await page.screenshot({ path: '/tmp/candy-xvfb.png' });
console.log('Screenshot saved');

const info = await page.evaluate(() => ({
  meshes: window.__startupProfile?.instancedMeshes,
  sceneChildren: window.__scene?.children?.length,
}));
console.log('Info:', JSON.stringify(info));

const filtered = errors.filter(e=>!e.includes('candy_native')&&!e.includes('404')&&!e.includes('audio-processor'));
console.log('Errors:', filtered.slice(0,15));
await browser.close();

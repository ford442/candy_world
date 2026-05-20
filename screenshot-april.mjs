import { chromium } from 'playwright';
const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security',
    '--enable-webgl','--enable-webgpu','--enable-features=Vulkan,WebGPU',
    '--enable-unsafe-webgpu','--disable-features=IsolateOrigins,site-per-process'],
});
const page = await browser.newPage();
const errors = [];
const allLogs = [];
page.on('console', msg => {
  allLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  if(msg.type()==='error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push('PAGEERROR: '+err.message));
await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });
let ready = false;
try { await page.waitForFunction(() => window.__sceneReady===true, {timeout:45000}); ready=true; } catch(e){}
await new Promise(r=>setTimeout(r,3000));
await page.screenshot({ path: '/tmp/candy-april.png' });
const info = await page.evaluate(() => ({
  sceneReady: window.__sceneReady,
  canvas: (()=>{const c=document.querySelector('canvas');return c?`${c.width}x${c.height}`:'none'})(),
  meshes: window.__startupProfile?.instancedMeshes,
  wasm: window.__startupProfile?.wasm,
}));
console.log('Scene ready:', ready);
console.log('Info:', JSON.stringify(info, null, 2));
console.log('Errors:', errors.filter(e=>!e.includes('candy_native')&&!e.includes('404')));
console.log('\n--- LAST 20 LOGS ---');
allLogs.slice(-20).forEach(l=>console.log(l));
await browser.close();

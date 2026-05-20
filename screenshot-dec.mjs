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
  logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  if(msg.type()==='error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push('PAGEERROR: '+err.message));
await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Wait for sceneReady or just wait 15s
let ready = false;
try { await page.waitForFunction(() => window.__sceneReady===true, {timeout:20000}); ready=true; } catch(e){}
await new Promise(r=>setTimeout(r,3000));

// Try to click into world
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button,a,[role="button"]')];
  const enter = btns.find(b=>b.textContent.toLowerCase().includes('enter')||b.textContent.toLowerCase().includes('start')||b.textContent.toLowerCase().includes('play'));
  if(enter) { enter.click(); }
  // Hide any overlays
  document.querySelectorAll('[id*="overlay"],[id*="loading"],[class*="overlay"],[class*="loading"]').forEach(el => el.style.display='none');
});
await new Promise(r=>setTimeout(r,5000));
await page.screenshot({ path: '/tmp/candy-dec.png', fullPage: false });
const info = await page.evaluate(() => ({
  sceneReady: window.__sceneReady,
  canvas: (()=>{const c=document.querySelector('canvas');return c?`${c.width}x${c.height}`:'none'})(),
}));
console.log('Scene ready:', ready, '| Info:', JSON.stringify(info));
const filtered = errors.filter(e=>!e.includes('candy_native')&&!e.includes('404'));
console.log('Errors ('+filtered.length+'):', filtered.slice(0,8));
console.log('\n--- LAST 15 LOGS ---');
logs.slice(-15).forEach(l=>console.log(l));
await browser.close();

import { chromium } from 'playwright';
const EXEC = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({
  executablePath: EXEC, headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security',
    '--enable-webgl','--enable-webgpu','--enable-features=Vulkan,WebGPU',
    '--enable-unsafe-webgpu','--disable-features=IsolateOrigins,site-per-process'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if(msg.type()==='error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push('PAGEERROR: '+err.message));
await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForFunction(() => window.__sceneReady===true, {timeout:45000}); } catch(e){}
await new Promise(r=>setTimeout(r,2000));

// Try to click "Enter World" button
try {
  await page.evaluate(() => {
    // Try various selectors
    const btns = [...document.querySelectorAll('button')];
    const enterBtn = btns.find(b => b.textContent.includes('Enter'));
    if (enterBtn) { enterBtn.click(); console.log('Clicked Enter button:', enterBtn.textContent); }
    // Also try pressing Escape or Enter key to dismiss overlay
    const overlay = document.querySelector('#loading-overlay, .loading-overlay, [class*="overlay"], [class*="loading"]');
    if (overlay) overlay.style.display = 'none';
  });
} catch(e) { console.log('Click error:', e.message); }

await new Promise(r=>setTimeout(r,4000));
await page.screenshot({ path: '/tmp/candy-april-entered.png' });
console.log('Done. Errors:', errors.filter(e=>!e.includes('candy_native')&&!e.includes('404')).slice(0,5));
await browser.close();

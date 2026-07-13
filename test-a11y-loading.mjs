import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        recordVideo: { dir: '/home/jules/verification/videos' },
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    try {
        console.log('Navigating to game...');
        await page.goto('http://localhost:5173/');

        console.log('Waiting for loading screen to appear...');
        const loadingContainer = page.locator('#candy-loading-screen');
        await loadingContainer.waitFor({ state: 'attached' });

        console.log('Clicking start to trigger longer generation...');
        // We might need to click "Core Only" or "Start" to see the full generation process
        const startButton = page.locator('#startButton');
        await startButton.waitFor({ state: 'attached', timeout: 5000 }).catch(() => null);
        if (await startButton.count() > 0) {
             console.log('Wait until start button is not disabled...');
             await page.waitForFunction(() => {
                 const btn = document.querySelector('#startButton');
                 return btn && !btn.disabled;
             });
             console.log('Dispatching click event on start button');
             await startButton.evaluate((node) => node.click());
        }

        console.log('Getting aria-valuetext over time...');
        // Sample aria-valuetext a few times as the game loads
        for(let i=0; i<15; i++) {
             const isAttached = await loadingContainer.count() > 0;
             if (!isAttached) break;

             const valueText = await loadingContainer.getAttribute('aria-valuetext');
             const valueNow = await loadingContainer.getAttribute('aria-valuenow');
             console.log(`[${i}] valuenow: ${valueNow}, valuetext: ${valueText}`);
             await page.waitForTimeout(500);
        }

        console.log('Taking screenshot...');
        await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' });

    } catch(err) {
        console.error('Test failed:', err);
    } finally {
        await context.close();
        await browser.close();
    }
})();

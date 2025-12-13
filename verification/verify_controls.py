import asyncio
from playwright.async_api import async_playwright

async def verify_controls():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-gl-drawing-for-tests", "--use-gl=swiftshader", "--enable-unsafe-webgpu"])
        page = await browser.new_page()

        # Navigate to the file directly or localhost if server is running.
        # Since I cannot start a background server easily without potentially blocking,
        # I will try to start vite in background or use a file path if possible.
        # However, modules require HTTP.
        # I will attempt to start the server in a separate step or assume one is running if I could.
        # But I must start one.

        # For now, let us assume I will run the server before this script.
        await page.goto("http://localhost:5173")

        # Wait for the controls to be visible
        await page.wait_for_selector(".controls-container")

        # Check if the DL exists
        controls_list = page.locator("dl.controls-list")
        if await controls_list.count() > 0:
            print("Controls list found!")

        # Take a screenshot
        await page.screenshot(path="verification/controls_verification.png")
        print("Screenshot saved.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_controls())

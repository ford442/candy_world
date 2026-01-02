
from playwright.sync_api import sync_playwright

def verify_ux():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        context = browser.new_context()
        page = context.new_page()

        # Load index.html locally (assuming it works without a server for static HTML)
        # Note: We are testing the UI in index.html, not the 3D scene (WASM/WebGPU might fail headless).
        # We access the file directly.
        import os
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # 1. Verify "Day Mode" button initial state
        btn = page.locator("#toggleDayNight")
        print(f"Button text: {btn.inner_text()}")

        # Take screenshot of the button
        btn.screenshot(path="verification/day_night_btn_initial.png")

        # 2. Click the button to toggle (if JS logic works on file://)
        # Note: input.js imports "three" which might fail on file:// without a build step/bundler
        # because of "importmap" or module resolution.
        # Let s check if we can see the initial state at least.

        browser.close()

if __name__ == "__main__":
    verify_ux()

from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch browser with swiftshader to emulate WebGPU/WebGL if possible,
        # though Playwright support for WebGPU is limited.
        # We'll use standard launch options.
        # Note: --use-gl=swiftshader might help in some headless envs.
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-webgpu"]
        )
        page = browser.new_page()

        # Navigate to the preview server
        page.goto("http://localhost:4173/")

        # Wait for canvas to be present
        page.wait_for_selector("#glCanvas")

        # Wait a bit for the scene to load/render
        page.wait_for_timeout(5000)

        # Check for console errors
        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        # Take a screenshot
        page.screenshot(path="verification_screenshot.png")

        browser.close()

if __name__ == "__main__":
    verify_scene()

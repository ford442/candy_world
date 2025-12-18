import sys
import time
from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch using SwiftShader for WebGPU support in headless mode
        # as per memory instructions
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        page = browser.new_page()

        # Navigate to local dev server (default vite port)
        try:
            page.goto("http://localhost:5173", timeout=10000)
            print("Navigated to page")

            # Wait for key elements that indicate success
            # The #startButton is present in HTML, let's wait for it
            page.wait_for_selector("#startButton", state="visible", timeout=10000)
            print("Start button visible")

            # Wait a bit for 3D to init (even if we don't click start)
            time.sleep(2)

            # Check for console errors
            # We can't easily capture console logs synchronously here without setup,
            # but if it crashed, screenshot might show it.

            # Take screenshot
            page.screenshot(path="verification/refactor_check.png")
            print("Screenshot taken")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_state.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_scene()


import os
from playwright.sync_api import sync_playwright, expect

def verify_performance_optimization():
    with sync_playwright() as p:
        # Launch browser with specific flags for WebGPU support if possible in headless (though software renderer is used)
        # We need to bypass the "Click to Start" overlay to see the scene.
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"]
        )
        page = browser.new_page()

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173/")

            # Wait for the start button to appear
            print("Waiting for start button...")
            start_btn = page.locator("#startButton")
            start_btn.wait_for(state="visible", timeout=10000)

            # Click start to enter the scene (hides overlay)
            print("Clicking start...")
            start_btn.click()

            # Wait a bit for the scene to render and animation loop to run
            # The optimization is in the main loop, so if it crashes, we won't see the scene.
            print("Waiting for scene render...")
            page.wait_for_timeout(5000)

            # Check if canvas is present
            canvas = page.locator("#glCanvas")
            expect(canvas).to_be_visible()

            # Take a screenshot to verify visuals are still correct (optimization didn't break rendering)
            screenshot_path = "verification/performance_check.png"
            os.makedirs("verification", exist_ok=True)
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_performance_optimization()

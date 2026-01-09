import time
from playwright.sync_api import sync_playwright

def verify_berries():
    with sync_playwright() as p:
        # Launch using SwiftShader for WebGPU (emulated)
        # Note: We need specific args to enable WebGPU in headless on CI if possible,
        # but SwiftShader is often the only way.
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox"
            ]
        )
        page = browser.new_page()

        print("Navigating to app...")
        try:
            # Wait for Vite to start (it compiles WASM first)
            # We'll retry a few times
            for i in range(10):
                try:
                    page.goto("http://localhost:5173", timeout=10000)
                    break
                except:
                    print(f"Waiting for server... {i+1}/10")
                    time.sleep(5)

            print("Page loaded. Clicking Start...")

            # Click start button to initialize audio/context
            # It might be disabled initially while loading WASM
            start_btn = page.locator("#startButton")
            start_btn.wait_for(state="visible", timeout=30000)

            # Wait until it's not disabled (loading done)
            # The text changes from "Loading World..." to "Click to Start"
            # Logic in main.js handles this.

            # Take screenshot of loading state just in case
            page.screenshot(path="verification/loading.png")

            # Check if disabled
            if start_btn.is_disabled():
                print("Button disabled, waiting for enable...")
                # It might take a while for 'generateMap' to finish in background
                # We can check for a console log or text change
                for _ in range(20):
                    if not start_btn.is_disabled():
                        break
                    time.sleep(2)

            print("Clicking start button...")
            start_btn.click()

            # Wait for scene to render
            time.sleep(5)

            # We want to see Berries.
            # In 'generateMap', berries are placed.
            # We can try to look at them.
            # Or just take a screenshot of the view.

            print("Taking screenshot...")
            page.screenshot(path="verification/berries_scene.png")
            print("Screenshot saved to verification/berries_scene.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_berries()

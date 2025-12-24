import time
from playwright.sync_api import sync_playwright

def verify_splash():
    with sync_playwright() as p:
        # Use SwiftShader for WebGPU support if needed (though we're testing the CSS overlay mostly)
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox"
            ]
        )
        page = browser.new_page()

        # Navigate to the app
        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # 1. Capture Initial Splash State (Audio Init)
        print("Waiting for initial splash...")
        # We look for the generic splash text container or specific text
        # Because execution is fast, it might already be at a later stage, but let's try
        try:
            page.wait_for_selector("#loading-overlay")
            page.screenshot(path="verification/splash_initial.png")
            print("Captured initial splash")
        except:
            print("Could not capture initial splash in time")

        # 2. Wait for World Generation Text
        print("Waiting for World Map loading text...")
        try:
            # We check if text contains "World Map" or "Procedural" or "Physics"
            # It changes fast, so we might just take a few snapshots
            time.sleep(1) # Give it a second to progress
            page.screenshot(path="verification/splash_progress.png")

            # Print current text content for debugging
            text = page.inner_text("#loading-text")
            print(f"Current Loading Text: {text}")
        except Exception as e:
            print(f"Error checking progress: {e}")

        # 3. Wait for final 'Entering' text or button enablement
        # The 'Entering Candy World...' message is fast before fade out.
        # But we can try to catch it or just wait for the button.

        print("Waiting for start button enablement (loading done)...")
        try:
            # Wait for button to be enabled
            page.wait_for_function("document.getElementById('startButton').disabled === false", timeout=60000)
            print("Loading completed, button enabled.")

            # Take screenshot of the 'Ready' state (Splash should be fading/gone)
            time.sleep(1) # Wait for fade out
            page.screenshot(path="verification/splash_done.png")

            # Verify overlay is hidden/removed
            is_visible = page.is_visible("#loading-overlay")
            opacity = page.evaluate("document.getElementById('loading-overlay')?.classList.contains('loaded')")
            print(f"Overlay visible: {is_visible}, Has 'loaded' class: {opacity}")

        except Exception as e:
            print(f"Timeout waiting for load: {e}")
            # Capture state at failure
            page.screenshot(path="verification/splash_timeout.png")

        browser.close()

if __name__ == "__main__":
    verify_splash()

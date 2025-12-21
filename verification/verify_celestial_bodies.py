import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--use-gl=swiftshader",
            "--enable-unsafe-webgpu",
            "--no-sandbox"
        ]
    )
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Navigate to the local server
        print("Navigating to http://localhost:5173...")
        page.goto("http://localhost:5173")

        # 2. Wait for the 'Start' button to appear
        print("Waiting for start button...")
        page.wait_for_selector("#startButton", state="visible", timeout=30000)

        # 3. Wait for the button to become enabled (it starts disabled while WASM loads)
        print("Waiting for WASM initialization (button enabled)...")
        # Check periodically if the button is enabled
        for _ in range(60): # Try for 60 seconds
            is_disabled = page.is_disabled("#startButton")
            if not is_disabled:
                break
            time.sleep(1)

        if page.is_disabled("#startButton"):
            print("Timeout waiting for start button to enable.")
            # Take a screenshot anyway to see what's happening
            page.screenshot(path="verification/failed_load.png")
            return

        print("Button enabled. Clicking 'Start'...")
        page.click("#startButton")

        # 4. Wait for the scene to render
        print("Waiting for scene interaction...")
        # We can't easily detect "rendering", but we can wait a few seconds for the loop to run
        time.sleep(5)

        # 5. Capture console logs to verify initialization of bodies
        # (This script can't see the console directly unless we hooked it earlier,
        # but we can execute JS to check for the bodies if we exposed them or just check the scene graph)

        # Check if we can find the celestial bodies in the scene using evaluate
        print("Checking scene graph for celestial bodies...")
        bodies_found = page.evaluate("""() => {
            // Traverse scene to find objects with userData.type 'pulsar', 'planet', 'galaxy'
            // We assume 'scene' is not globally exposed easily unless we find where it is.
            // main.js doesn't export 'scene' to window.
            // However, we can perhaps assume they are in the scene if no errors occurred.
            // Let's rely on the screenshot for visual confirmation if possible,
            // or return a flag if we can access internal state (window.__sceneReady helps)
            return window.__sceneReady === true;
        }""")

        if bodies_found:
            print("Scene appears ready.")
        else:
            print("Warning: window.__sceneReady not found.")

        # 6. Take a screenshot
        # Since we are in pointer lock mode usually after clicking start,
        # the camera might be looking forward. The celestial bodies are high in the sky.
        # We might not see them directly without looking up.
        # But let's take a screenshot of the horizon/start view.
        print("Taking screenshot...")
        page.screenshot(path="verification/celestial_bodies_scene.png")
        print("Screenshot saved to verification/celestial_bodies_scene.png")

    except Exception as e:
        print(f"Error: {e}")
        page.screenshot(path="verification/error_state.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)

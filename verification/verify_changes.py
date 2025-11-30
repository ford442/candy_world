from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch browser in headless mode
        # Note: --use-gl=swiftshader is often needed for WebGPU/WebGL in headless environments
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--enable-unsafe-webgpu']
        )
        page = browser.new_page()

        # Navigate to the local server
        page.goto("http://localhost:8080")

        # Wait for the scene to load (give it some time)
        # We can look for the canvas element
        try:
            page.wait_for_selector("#glCanvas", timeout=10000)
            print("Canvas found.")
        except Exception as e:
            print(f"Canvas not found: {e}")

        # Check console logs for the spawn messages
        print("Checking console logs...")

        # We need to capture console messages
        found_king = False
        found_overgrown = False

        def handle_console(msg):
            nonlocal found_king, found_overgrown
            text = msg.text
            print(f"Console: {text}")
            if "Spawning King Mushroom" in text:
                found_king = True
            if "Spawning Overgrown Zone" in text:
                found_overgrown = True

        page.on("console", handle_console)

        # Wait a bit for scripts to execute
        page.wait_for_timeout(5000)

        if found_king:
            print("SUCCESS: King Mushroom spawn log found.")
        else:
            print("FAILURE: King Mushroom spawn log NOT found.")

        if found_overgrown:
            print("SUCCESS: Overgrown Zone spawn log found.")
        else:
            print("FAILURE: Overgrown Zone spawn log NOT found.")

        # Take a screenshot just in case it renders something
        page.screenshot(path="verification/scene_verification.png")
        print("Screenshot saved to verification/scene_verification.png")

        browser.close()

if __name__ == "__main__":
    verify_scene()

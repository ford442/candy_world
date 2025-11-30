from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--enable-unsafe-webgpu']
        )
        page = browser.new_page()

        # Register console listener BEFORE navigation
        found_king = False
        found_overgrown = False
        found_webgpu_error = False

        def handle_console(msg):
            nonlocal found_king, found_overgrown, found_webgpu_error
            text = msg.text
            # print(f"Console: {text}") # Comment out to avoid spam if needed, or keep for debug
            if "Spawning King Mushroom" in text:
                found_king = True
            if "Spawning Overgrown Zone" in text:
                found_overgrown = True
            if "WebGPU not supported" in text or "Error" in text:
                 # Check if it's a real error or just the memory warning
                 if "WebGPU" in text:
                     found_webgpu_error = True

        page.on("console", handle_console)

        # Navigate
        page.goto("http://localhost:8080")

        # Wait for potential rendering
        try:
            page.wait_for_selector("#glCanvas", timeout=10000)
        except:
            pass

        page.wait_for_timeout(5000)

        print(f"Found King Mushroom Log: {found_king}")
        print(f"Found Overgrown Zone Log: {found_overgrown}")
        print(f"Found WebGPU Error: {found_webgpu_error}")

        page.screenshot(path="verification/scene_verification_retry.png")
        browser.close()

if __name__ == "__main__":
    verify_scene()

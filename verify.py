from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch browser with swiftshader for WebGPU support emulation if needed,
        # though headless chromium usually doesn't support WebGPU well.
        # We will try with standard args first.
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader']
        )
        page = browser.new_page()

        # Navigate to the preview server
        try:
            page.goto("http://localhost:4173/")
            page.wait_for_timeout(5000) # Wait for scene to load

            # Check for console logs to verify no errors
            page.on("console", lambda msg: print(f"Console: {msg.text}"))

            # Take a screenshot
            page.screenshot(path="/home/jules/verification/verification_screenshot.png")
            print("Screenshot taken.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_scene()

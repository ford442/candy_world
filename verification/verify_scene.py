from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch browser with required flags for WebGPU
        browser = p.chromium.launch(
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
            print("Navigating to app...")
            page.goto("http://localhost:5173", timeout=60000)

            # Wait for loaded state
            page.wait_for_selector("#startButton", state="visible", timeout=30000)
            print("Page loaded.")

            # Click start to hide overlay and show scene
            page.click("#startButton")

            # Wait a bit for scene to stabilize/render
            page.wait_for_timeout(5000)

            # Take screenshot of scene
            screenshot_path = "verification/scene_verification.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_scene()

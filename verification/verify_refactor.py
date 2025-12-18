from playwright.sync_api import sync_playwright

def verify_scene():
    with sync_playwright() as p:
        # Launch browser with specific flags for WebGPU
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--enable-features=Vulkan",
                "--no-sandbox"
            ]
        )
        page = browser.new_page()

        # Capture console logs to catch JS errors
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173", timeout=60000)

            print("Waiting for start button...")
            page.wait_for_selector("#startButton", state="visible", timeout=30000)

            # Wait a bit for WASM to initialize (button becomes enabled)
            page.wait_for_timeout(5000)

            # Take screenshot of initial state
            page.screenshot(path="verification/refactor_check.png")
            print("Screenshot saved to verification/refactor_check.png")

        except Exception as e:
            print(f"Error during verification: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_scene()

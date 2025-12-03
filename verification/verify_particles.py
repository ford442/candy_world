from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

        try:
            print("Navigating...")
            page.goto("http://localhost:5173")

            # Wait for either instructions or error overlay
            print("Waiting for load...")
            page.wait_for_timeout(5000)

            # Check for vite error overlay
            if page.locator("vite-error-overlay").count() > 0:
                print("Vite Error Overlay detected!")
                # Try to get text from it if possible, but the console logs should suffice

            print("Attempting to click instructions...")
            page.click("#instructions", timeout=5000)

            page.wait_for_timeout(2000)
            page.screenshot(path="verification/verification.png")
            print("Screenshot taken successfully")

        except Exception as e:
            print(f"Script Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()

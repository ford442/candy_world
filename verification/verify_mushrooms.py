from playwright.sync_api import sync_playwright

def verify_mushrooms():
    with sync_playwright() as p:
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

        # Listen to console
        page.on("console", lambda msg: print(f"BROWSER LOG: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"BROWSER ERROR: {exc}"))

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173", timeout=60000)

            print("Waiting for start button...")
            page.wait_for_selector("#startButton", state="visible", timeout=60000)

            print("Waiting for button to be enabled...")
            page.wait_for_function(
                "document.getElementById('startButton') && !document.getElementById('startButton').disabled",
                timeout=60000
            )

            print("Button enabled. Clicking via JS.")
            # Bypass Playwright actionability checks for pointer lock buttons
            page.evaluate("document.getElementById('startButton').click()")

            print("Waiting for render (10s)...")
            page.wait_for_timeout(10000)

            screenshot_path = "verification/mushroom_verification.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_mushrooms()

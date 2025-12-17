from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"]
        )
        page = browser.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        try:
            print("Navigating...")
            page.goto("http://localhost:5173", timeout=60000)

            # Wait for button to be enabled and have correct text
            print("Waiting for WASM load...")
            start_btn = page.locator("#startButton")
            expect(start_btn).to_be_enabled(timeout=60000)
            expect(start_btn).to_have_text("Start Exploration 🚀")

            print("Clicking start...")
            start_btn.click()

            # Wait for overlay to disappear
            print("Waiting for game start...")
            expect(page.locator("#instructions")).not_to_be_visible()

            page.wait_for_timeout(2000)
            print("Taking screenshot...")
            page.screenshot(path="verification/verification.png")
            print("Done.")

        except Exception as e:
            print(f"Error: {e}")
            try:
                page.screenshot(path="verification/error.png")
            except:
                pass
        finally:
            browser.close()

if __name__ == "__main__":
    run()

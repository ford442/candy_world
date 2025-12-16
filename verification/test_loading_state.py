from playwright.sync_api import sync_playwright, expect
import time

def verify_loading_ux():
    with sync_playwright() as p:
        # Use WebGPU flags as per repo requirements
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        page = browser.new_page()
        try:
            print("Navigating to http://localhost:5173")
            # Navigate
            page.goto("http://localhost:5173", timeout=30000)

            # --- Check Initial State ---
            # NOTE: If the machine is too fast, we might miss the disabled state.
            # But the 'build:wasm' step in 'dev' might take a few seconds on first run.
            # Or if we hit the page while it's still compiling WASM in browser.

            start_btn = page.locator("#startButton")

            # Take immediate screenshot
            page.screenshot(path="verification/step1_initial.png")
            print("Initial screenshot taken.")

            # Check properties
            # We don't assert strictly here because timing is tricky,
            # but we log it for the engineer to verify.
            is_disabled = start_btn.is_disabled()
            text = start_btn.inner_text()
            print(f"Initial State: Disabled={is_disabled}, Text='{text}'")

            # --- Wait for Ready State ---
            print("Waiting for button to be enabled...")
            expect(start_btn).to_be_enabled(timeout=20000)
            expect(start_btn).to_contain_text("Start Exploration")

            page.screenshot(path="verification/step2_ready.png")
            print("Ready screenshot taken.")

            final_text = start_btn.inner_text()
            print(f"Final State: Text='{final_text}'")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_loading_ux()

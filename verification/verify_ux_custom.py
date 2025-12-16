from playwright.sync_api import sync_playwright, expect
import time

def verify_loading_state():
    with sync_playwright() as p:
        # Use specific args for WebGPU support (though we are just checking UI here)
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        )
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to app...")
        page.goto("http://localhost:5173/")

        # Check initial state (should be Loading...)
        # Note: It might be too fast to catch "Loading World..." if WASM loads instantly,
        # but in this environment it might take a moment.
        # We will try to catch the disabled state.

        start_button = page.locator("#startButton")

        # It's possible the loading happens so fast we miss it.
        # But we can check if the button exists and what its text is.
        # If it says "Start Exploration", it means loading finished.

        print("Waiting for start button...")
        start_button.wait_for(state="visible")

        initial_text = start_button.text_content()
        print(f"Button text: {initial_text}")

        # Verify it eventually becomes "Start Exploration" and is enabled
        print("Waiting for enabled state...")
        expect(start_button).to_have_text("Start Exploration 🚀")
        expect(start_button).to_be_enabled()

        # Take screenshot of final state
        page.screenshot(path="verification/ux_verified.png")
        print("Screenshot saved to verification/ux_verified.png")

        browser.close()

if __name__ == "__main__":
    verify_loading_state()

import time
from playwright.sync_api import sync_playwright

def verify_jukebox_ui():
    with sync_playwright() as p:
        # Launch browser with specific args for WebGPU/WebGL
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

        # Navigate to the app (assuming dev server is running on 5173)
        try:
            page.goto("http://localhost:5173", timeout=30000)

            # Wait for the page to be ready
            page.wait_for_selector("#instructions", state="visible", timeout=10000)

            # Click "Open Jukebox (Q)" to reveal the overlay
            # Note: The button ID is 'openJukeboxBtn'
            page.click("#openJukeboxBtn")

            # Wait for the overlay to appear
            page.wait_for_selector("#playlist-overlay", state="visible", timeout=2000)

            # Verify the Close button text
            close_btn = page.locator("#closePlaylistBtn")
            text = close_btn.inner_text()
            print(f"Close button text: '{text}'")

            if "Close (Esc)" in text:
                print("SUCCESS: Close button text contains '(Esc)'")
            else:
                print(f"FAILURE: Close button text is '{text}'")

            # Take a screenshot of the overlay
            page.screenshot(path="verification/jukebox_overlay.png")
            print("Screenshot saved to verification/jukebox_overlay.png")

        except Exception as e:
            print(f"Error during verification: {e}")
            # Take a screenshot even on error if possible
            try:
                page.screenshot(path="verification/error_state.png")
            except:
                pass
        finally:
            browser.close()

if __name__ == "__main__":
    verify_jukebox_ui()

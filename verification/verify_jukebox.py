
import os
import sys
from playwright.sync_api import sync_playwright, expect

def verify_jukebox_ux():
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

        # Log console messages to help debug if main.js fails
        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        try:
            print("Navigating to app...")
            # We assume the server is running on port 5173
            page.goto("http://localhost:5173/")

            print("Waiting for DOM...")
            page.wait_for_selector("body")

            # Force hide loading overlay to unblock UI interaction immediately
            # We don't wait for WASM or assets to load since we are testing HTML UI.
            print("Force-hiding loading overlay...")
            page.evaluate("""
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.style.display = 'none';

                // Also ensure instructions are visible (they contain the Jukebox button)
                const inst = document.getElementById('instructions');
                if (inst) inst.style.display = 'flex';

                // Ensure Jukebox button is enabled (just in case)
                const btn = document.getElementById('openJukeboxBtn');
                if (btn) btn.disabled = false;
            """)

            # Open Jukebox
            print("Opening Jukebox...")
            jukebox_btn = page.locator("#openJukeboxBtn")
            jukebox_btn.wait_for(state="visible", timeout=10000)
            jukebox_btn.click(force=True)

            # Wait for Playlist Overlay
            print("Waiting for playlist overlay...")
            overlay = page.locator("#playlist-overlay")
            expect(overlay).to_be_visible(timeout=5000)

            # Verify the helper text exists and is visible
            print("Verifying helper text...")
            # We look for the specific text we added in index.html
            # "Navigate: ↑ ↓"
            helper_text_generic = page.locator("#playlist-overlay").get_by_text("Navigate:")
            expect(helper_text_generic).to_be_visible()

            # Screenshot
            screenshot_path = os.path.abspath("verification/jukebox_ux.png")
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error during verification: {e}")
            # Take error screenshot
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_jukebox_ux()

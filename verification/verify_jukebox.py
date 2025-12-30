
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_jukebox_empty_state(page):
    page.goto("http://localhost:5173")

    # Brute force removal of loading overlay
    page.evaluate("document.getElementById('loading-overlay').remove()")

    # Force click the button using JS if Playwright struggles
    page.evaluate("document.getElementById('openJukeboxBtn').click()")

    # Wait for playlist overlay
    playlist_overlay = page.locator("#playlist-overlay")
    expect(playlist_overlay).to_be_visible(timeout=5000)

    # Check for the empty state button
    empty_btn = page.locator("button.secondary-button", has_text="No songs... Click to Add! 🍭")
    expect(empty_btn).to_be_visible()

    page.screenshot(path="verification/jukebox_empty_state.png")
    print("Screenshot saved to verification/jukebox_empty_state.png")

if __name__ == "__main__":
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
        try:
            verify_jukebox_empty_state(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

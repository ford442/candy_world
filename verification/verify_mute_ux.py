
from playwright.sync_api import sync_playwright, expect
import os

def verify_mute_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Get absolute path to index.html
        cwd = os.getcwd()
        file_path = f"file://{cwd}/index.html"

        print(f"Navigating to {file_path}")
        page.goto(file_path)

        # Force hide the canvas to avoid WebGL timeout/crashes in headless env
        page.add_style_tag(content="canvas { display: none !important; }")

        # Wait for the button
        mute_btn = page.locator("#toggleMuteBtn")
        expect(mute_btn).to_be_visible()

        # Check text content
        # Note: innerText might include whitespace, so we strip
        text = mute_btn.inner_text()
        print(f"Button text: '{text}'")

        if "🔊 Mute (M)" not in text:
             print("FAIL: Text does not contain '🔊 Mute (M)'")
        else:
             print("PASS: Text contains '🔊 Mute (M)'")

        # Check aria-keyshortcuts
        shortcut = mute_btn.get_attribute("aria-keyshortcuts")
        print(f"aria-keyshortcuts: '{shortcut}'")

        if shortcut != "M":
             print("FAIL: aria-keyshortcuts is not 'M'")
        else:
             print("PASS: aria-keyshortcuts is 'M'")

        # Take screenshot of the settings container
        settings = page.locator(".settings-container")
        settings.screenshot(path="verification/mute_button_verification.png")
        print("Screenshot saved to verification/mute_button_verification.png")

        browser.close()

if __name__ == "__main__":
    verify_mute_button()

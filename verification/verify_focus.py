
import os
import sys
from playwright.sync_api import sync_playwright

def verify_focus_rings():
    with sync_playwright() as p:
        # Use SwiftShader for WebGL support in headless mode if needed, though we are testing CSS.
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"]
        )
        context = browser.new_context(
            viewport={'width': 1280, 'height': 720}
        )
        page = context.new_page()

        # Load local HTML file directly
        # Ensure the path is absolute
        file_path = os.path.abspath("index.html")
        page.goto(f"file://{file_path}")

        # Inject styles to hide the loading overlay immediately so we can see the buttons
        # The loading overlay blocks the view
        page.add_style_tag(content="""
            #loading-overlay { display: none !important; }
            #instructions { opacity: 1 !important; display: flex !important; }
        """)

        # Wait for the Start Button to be visible
        page.wait_for_selector("#startButton")

        # 1. Focus on the Start Button
        start_btn = page.locator("#startButton")
        start_btn.focus()
        page.wait_for_timeout(200) # Wait for animation/render
        page.screenshot(path="verification/focus_start_btn.png")
        print("Captured focus_start_btn.png")

        # 2. Focus on the 'Switch to Night' button
        night_btn = page.locator("#toggleDayNight")
        night_btn.focus()
        page.wait_for_timeout(200)
        page.screenshot(path="verification/focus_night_btn.png")
        print("Captured focus_night_btn.png")

        # 3. Focus on the File Input Label (trickier as input is hidden)
        # We need to focus the INPUT, but the style is on the LABEL via + selector
        file_input = page.locator("#musicUpload")
        file_input.focus()
        page.wait_for_timeout(200)
        page.screenshot(path="verification/focus_file_label.png")
        print("Captured focus_file_label.png")

        browser.close()

if __name__ == "__main__":
    verify_focus_rings()

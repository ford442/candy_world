from playwright.sync_api import sync_playwright

def verify_mute_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox",
                "--disable-dev-shm-usage"
            ]
        )
        page = browser.new_page()

        # Load the local HTML file
        # Since we just need to verify the static HTML content for this change,
        # file:// protocol is sufficient and avoids needing to spin up a server
        # for a simple text change verification.
        import os
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Wait for the button to be visible
        mute_btn = page.locator("#toggleMuteBtn")

        # Check the text content
        text = mute_btn.text_content()
        print(f"Button text: '{text.strip()}'")

        if "Mute (M)" in text:
            print("SUCCESS: Button text contains '(M)'")
        else:
            print("FAILURE: Button text missing '(M)'")

        # Check aria-keyshortcuts
        shortcut = mute_btn.get_attribute("aria-keyshortcuts")
        print(f"aria-keyshortcuts: '{shortcut}'")

        if shortcut == "M":
            print("SUCCESS: aria-keyshortcuts is 'M'")
        else:
            print("FAILURE: aria-keyshortcuts incorrect")

        # Take screenshot of the settings container
        settings = page.locator(".settings-container")
        settings.screenshot(path="verification/mute_btn_visual.png")

        browser.close()

if __name__ == "__main__":
    verify_mute_button()

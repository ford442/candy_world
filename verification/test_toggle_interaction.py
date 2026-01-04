from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local server
        page.goto("http://localhost:5173")

        # Wait for instructions overlay to be visible (it is by default)
        toggle_btn = page.locator("#toggleDayNight")
        toggle_btn.wait_for(state="visible")

        print(f"Initial Text: '{toggle_btn.inner_text()}'")

        # Verify Initial Text
        if "Switch to Night" in toggle_btn.inner_text():
            print("SUCCESS: Initial text is correct.")
        else:
            print("FAILURE: Initial text is incorrect.")

        # Click the button (simulate Toggle)
        # Note: In headless mode, if the overlay is covered or not interactive, this might fail.
        # But #instructions is a high z-index overlay.

        # We might need to bypass the loading screen if it's blocking.
        # The loading screen #loading-overlay has z-index 9999.
        # We can wait for it to disappear or force hide it.

        # Let's force hide the loading screen
        page.evaluate("document.getElementById('loading-overlay').style.display = 'none'")

        toggle_btn.click()

        # Wait a bit for update
        page.wait_for_timeout(500)

        print(f"Text after click: '{toggle_btn.inner_text()}'")

        if "Switch to Day" in toggle_btn.inner_text():
             print("SUCCESS: Toggled text is correct.")
        else:
             print("FAILURE: Toggled text is incorrect.")

        page.screenshot(path="verification/toggle_verification.png")

        browser.close()

if __name__ == "__main__":
    run()

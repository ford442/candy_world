from playwright.sync_api import sync_playwright

def verify_mute_button():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        )

        # New page
        page = browser.new_page()

        try:
            # Navigate to local server
            page.goto("http://localhost:5173", timeout=30000)

            # Wait for splash screen to clear or manipulate it
            # We can force remove the splash screen to see the buttons
            page.evaluate("document.getElementById('loading-overlay').remove()")

            # Locate the Mute Button
            mute_btn = page.locator("#toggleMuteBtn")

            # Assert it exists and is visible
            print("Checking if mute button exists...")
            if mute_btn.is_visible():
                print("Mute button is visible.")
            else:
                print("Mute button NOT visible.")

            # Check initial text
            initial_text = mute_btn.inner_text()
            print(f"Initial Text: {initial_text}")

            if "Mute" in initial_text:
                print("PASS: Initial text correct.")
            else:
                print("FAIL: Initial text incorrect.")

            # Click it
            print("Clicking mute button...")
            mute_btn.click()

            # Check updated text/state
            updated_text = mute_btn.inner_text()
            aria_pressed = mute_btn.get_attribute("aria-pressed")

            print(f"Updated Text: {updated_text}")
            print(f"Aria Pressed: {aria_pressed}")

            if "Unmute" in updated_text and aria_pressed == "true":
                print("PASS: Button state updated correctly.")
            else:
                print("FAIL: Button state update incorrect.")

            # Take screenshot
            page.screenshot(path="verification/mute_button_verified.png")
            print("Screenshot saved to verification/mute_button_verified.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_mute_button()

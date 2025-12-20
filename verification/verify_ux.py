import time
from playwright.sync_api import sync_playwright

def verify_ux():
    with sync_playwright() as p:
        # Launch browser with specific flags to potentially handle WebGPU or just standard
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        page = browser.new_page()

        try:
            # Go to the app
            print("Navigating to http://localhost:5173/")
            page.goto("http://localhost:5173/")

            # Wait for DOM content to load
            page.wait_for_load_state('domcontentloaded')

            # 1. Verify Jukebox Input Attributes
            print("Checking Jukebox input attributes...")

            # Check if input has correct class
            input_locator = page.locator("#playlistUploadInput")
            class_attr = input_locator.get_attribute("class")
            print(f"Playlist Input Class: {class_attr}")

            if "visually-hidden" in class_attr:
                print("PASS: Input has 'visually-hidden' class.")
            else:
                print("FAIL: Input missing 'visually-hidden' class.")

            # Check if input is BEFORE label
            # We can check if the next sibling of input is the label
            is_before_label = page.evaluate("""
                () => {
                    const input = document.getElementById('playlistUploadInput');
                    const label = document.querySelector('label[for="playlistUploadInput"]');
                    return input.nextElementSibling === label;
                }
            """)

            if is_before_label:
                print("PASS: Input is structurally before Label (allows CSS sibling selector).")
            else:
                print("FAIL: Input is NOT immediately before Label.")

            # 2. Take a screenshot of the Jukebox structure (even if hidden, we can force display it for screenshot)
            # Force display block on overlay to see it
            print("Forcing Jukebox overlay to display for screenshot...")
            page.evaluate("document.getElementById('playlist-overlay').style.display = 'flex'")

            # Focus the input to see if style applies to label?
            # Note: focusing a hidden input via script works
            print("Focusing input to test CSS...")
            input_locator.focus()

            # Take screenshot
            page.screenshot(path="verification/jukebox_access.png")
            print("Screenshot saved to verification/jukebox_access.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_ux()

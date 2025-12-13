from playwright.sync_api import sync_playwright

def verify_ux():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        page = browser.new_page()

        # Navigate to the app
        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # Wait for instructions overlay to appear
        print("Waiting for instructions...")
        page.wait_for_selector("#instructions")

        # Check if Start button is present and visible
        print("Checking for Start Button...")
        start_button = page.locator("#startButton")
        if start_button.is_visible():
            print("SUCCESS: Start button is visible.")
        else:
            print("FAILURE: Start button is missing.")

        # Check for Upload Music input being visually hidden but present
        print("Checking Upload Music input...")
        music_input = page.locator("#musicUpload")
        is_hidden = music_input.get_attribute("class") == "visually-hidden"
        if is_hidden:
            print("SUCCESS: Music input has 'visually-hidden' class.")
        else:
            print(f"FAILURE: Music input class is {music_input.get_attribute('class')}")

        # Take a screenshot of the landing page
        page.screenshot(path="verification/ux_check.png")
        print("Screenshot taken: verification/ux_check.png")

        browser.close()

if __name__ == "__main__":
    verify_ux()

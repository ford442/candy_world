from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local file since we can't run the server easily in this env
        # Note: In a real environment we would check localhost:5173
        # For this verification, we can try opening the file directly but JS modules might fail.
        # However, we are verifying initial HTML state first.

        import os
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Verify initial state of the button
        toggle_btn = page.locator("#toggleDayNight")
        print(f"Initial Button Text: '{toggle_btn.inner_text()}'")

        if "Switch to Night" in toggle_btn.inner_text():
            print("SUCCESS: Initial text is correct.")
        else:
            print("FAILURE: Initial text is incorrect.")

        browser.close()

if __name__ == "__main__":
    run()

import sys; from playwright.sync_api import sync_playwright;

def verify(page):
    page.goto("http://localhost:5173")
    # Wait for canvas
    page.wait_for_selector("#glCanvas", state="visible", timeout=30000)

    # Wait for button to be enabled (loading done)
    page.wait_for_function("document.getElementById(\"startButton\") && !document.getElementById(\"startButton\").disabled", timeout=60000)

    # Start game
    page.click("#startButton", force=True)

    # Wait for generation text to disappear (meaning game started)
    # The overlay usually hides or the start button is removed/hidden
    page.wait_for_selector("#instructions", state="hidden", timeout=90000)

    # Wait a bit for grass to spawn and settle
    page.wait_for_timeout(5000)

    # Take screenshot
    page.screenshot(path="verification/verification.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"])
    page = browser.new_page()
    try:
        verify(page)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

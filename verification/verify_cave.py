
import time
from playwright.sync_api import sync_playwright

def verify_cave(page):
    # 1. Navigate to the app
    page.goto("http://localhost:5173")

    # 2. Wait for app to load (checking for canvas)
    page.wait_for_selector("canvas", timeout=10000)

    # Click start button to generate world which contains caves
    try:
        page.click("#startButton", timeout=5000)
        print("Clicked start button")
    except:
        print("Start button not found or already clicked")

    # Wait for generation
    time.sleep(5)

    # 4. Take Screenshot
    page.screenshot(path="verification/cave_visual.png")
    print("Screenshot taken: verification/cave_visual.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch with args to help with GPU/WebGL if possible, though software rendering is likely
        browser = p.chromium.launch(headless=True, args=["--use-gl=egl"])
        page = browser.new_page()
        try:
            verify_cave(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

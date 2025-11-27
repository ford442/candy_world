from playwright.sync_api import sync_playwright

def verify_scene_loads():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True, args=['--use-gl=swiftshader'])
        page = browser.new_page()

        # Navigate to the local server
        page.goto("http://localhost:8080")

        # Wait for the scene to load (canvas element)
        page.wait_for_selector("#glCanvas", timeout=10000)

        # Wait a bit for the scene to render
        page.wait_for_timeout(5000)

        # Take a screenshot
        page.screenshot(path="verification_screenshot.png")
        print("Screenshot taken: verification_screenshot.png")

        browser.close()

if __name__ == "__main__":
    verify_scene_loads()

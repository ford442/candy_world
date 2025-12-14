from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"])
    context = browser.new_context()
    page = context.new_page()

    # 1. Start application
    page.goto("http://localhost:5173/")

    # 2. Wait for loading
    page.wait_for_selector("#startButton")

    # 3. Take screenshot of Day (Stars hidden)
    page.screenshot(path="verification/day_stars.png")

    # 4. Trigger Night (Press 'N')
    page.keyboard.press("n")

    # 5. Wait for transition (opacity is lerped)
    page.wait_for_timeout(2000)

    # 6. Take screenshot of Night (Stars visible)
    page.screenshot(path="verification/night_stars.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)

from playwright.sync_api import sync_playwright

def run_cuj(page):
    # Navigate to the page
    page.goto("http://localhost:4173/?FULL_BOOT=fast")
    page.wait_for_timeout(2000)

    # Click the Start button (wait for it to become enabled first)
    page.wait_for_selector("#startButton:not([disabled])", timeout=15000)
    page.evaluate("document.getElementById('startButton').click()")
    page.wait_for_timeout(2000)

    # Press Esc to open the pause menu and show buttons
    page.keyboard.press("Escape")
    page.wait_for_timeout(1000)

    # Open the Jukebox using Q or clicking the button
    page.keyboard.press("Q")
    page.wait_for_timeout(1000)

    # We expect the empty state to be visible. Let's take a screenshot.
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    page.wait_for_timeout(1000)

    # Press Tab. The focus should move to the "Close" button first, then "Browse Music" button
    page.keyboard.press("Tab")
    page.wait_for_timeout(500)
    page.keyboard.press("Tab")
    page.wait_for_timeout(500)

    # Take a screenshot to verify focus
    page.screenshot(path="/home/jules/verification/screenshots/verification2.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()

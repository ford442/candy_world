from playwright.sync_api import sync_playwright

def run_cuj(page):
    # The preview server is on 4173
    page.goto("http://localhost:4173")

    # Wait for the game to load and the start button to be enabled
    page.wait_for_selector("#startButton:not([disabled])", timeout=30000)
    page.wait_for_timeout(500)

    # Bypass loading screen to get to the main UI
    # In some cases the game needs a click on start button
    page.get_by_role("button", name="Resume Exploration").click()
    page.wait_for_timeout(1000)

    # Open Jukebox
    page.keyboard.press("Escape")
    page.wait_for_timeout(1000)

    # Click Jukebox button
    page.click("#openJukeboxBtn")
    page.wait_for_timeout(1000)

    # Delete existing items to show empty state
    while True:
        remove_btns = page.locator(".playlist-remove-btn").all()
        if not remove_btns:
            break
        remove_btns[0].click()
        page.wait_for_timeout(200)

    # Take screenshot of the empty state
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    page.wait_for_timeout(2000)

if __name__ == "__main__":
    import os
    import os.path
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos",
            viewport={"width": 1280, "height": 720}
        )
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/screenshots/error.png")
        finally:
            context.close()
            browser.close()

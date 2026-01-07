from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:5173")

        # Wait for start button to be enabled (it starts disabled)
        page.wait_for_function("document.getElementById('startButton') && !document.getElementById('startButton').disabled")

        page.click("#startButton")

        # Wait for reticle
        page.wait_for_selector("#game-reticle", state="attached")

        # Inject hover state
        page.evaluate("document.getElementById('game-reticle').classList.add('hover')")
        page.wait_for_timeout(500)

        # Screenshot
        page.screenshot(path="verification/reticle_hover.png")
        print("Screenshot saved to verification/reticle_hover.png")
        browser.close()

if __name__ == "__main__":
    run_verification()

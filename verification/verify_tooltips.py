from playwright.sync_api import sync_playwright
import time

def verify_tooltips():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        print("Navigating to http://localhost:5173/ ...")
        try:
            page.goto("http://localhost:5173/", wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            return

        # Check for loading overlay and remove it if it gets stuck
        try:
             page.wait_for_selector("#loading-overlay", state="hidden", timeout=5000)
             print("Loading overlay disappeared naturally.")
        except:
             print("Loading overlay still present. Checking for errors...")
             # Force remove it to interact (but this implies app might be broken)
             page.evaluate("document.getElementById('loading-overlay').style.display = 'none'")
             print("Forced loading overlay hidden.")

        # Wait for controls
        print("Waiting for controls...")
        try:
            page.wait_for_selector("#volDownBtn", timeout=5000)
        except Exception as e:
             print(f"Controls not found: {e}")
             page.screenshot(path="verification/failed_load.png")
             return

        # Give a moment for initInput to run if it was delayed
        time.sleep(2)

        # Check Initial Tooltips
        vol_down = page.locator("#volDownBtn")
        toggle_mute = page.locator("#toggleMuteBtn")
        vol_up = page.locator("#volUpBtn")

        initial_vol_down_title = vol_down.get_attribute("title")
        initial_vol_up_title = vol_up.get_attribute("title")
        initial_mute_title = toggle_mute.get_attribute("title")

        print(f"Initial Vol Down Title: '{initial_vol_down_title}'")
        print(f"Initial Vol Up Title: '{initial_vol_up_title}'")
        print(f"Initial Mute Title: '{initial_mute_title}'")

        # Interact: Decrease Volume
        print("Clicking Decrease Volume...")
        try:
            vol_down.click(timeout=2000)
            time.sleep(0.5)
            new_vol_down_title = vol_down.get_attribute("title")
            print(f"New Vol Down Title: '{new_vol_down_title}'")
        except Exception as e:
            print(f"Click failed: {e}")

        # Take Screenshot
        page.screenshot(path="verification/debug_tooltips.png")
        print("Screenshot saved to verification/debug_tooltips.png")

        browser.close()

if __name__ == "__main__":
    verify_tooltips()

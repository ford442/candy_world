from playwright.sync_api import sync_playwright
import time

def verify_ux_improvements():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:5173/ ...")
        try:
            page.goto("http://localhost:5173/", wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            return

        # Wait for controls
        print("Waiting for controls...")
        try:
            page.wait_for_selector("#volDownBtn", timeout=5000)
            page.wait_for_selector("#volUpBtn", timeout=5000)
        except Exception as e:
             print(f"Controls not found: {e}")
             return

        # Check for Key Badges
        vol_down_badge = page.locator("#volDownBtn .key-badge")
        vol_up_badge = page.locator("#volUpBtn .key-badge")

        vol_down_badge_count = vol_down_badge.count()
        vol_up_badge_count = vol_up_badge.count()

        print(f"Vol Down Badge Count: {vol_down_badge_count}")
        print(f"Vol Up Badge Count: {vol_up_badge_count}")

        success = True
        if vol_down_badge_count == 0:
            print("FAIL: Missing key badge for Volume Down (-)")
            success = False
        else:
            print("PASS: Found key badge for Volume Down")

        if vol_up_badge_count == 0:
            print("FAIL: Missing key badge for Volume Up (+)")
            success = False
        else:
            print("PASS: Found key badge for Volume Up")

        browser.close()

        if not success:
            exit(1)

if __name__ == "__main__":
    verify_ux_improvements()

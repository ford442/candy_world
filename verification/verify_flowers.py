from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox'])
        page = browser.new_page()

        # Listen for console logs
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        print("Navigating to app...")
        try:
            page.goto("http://localhost:5173", timeout=30000)
            print("Page loaded.")

            # Wait for initialization
            time.sleep(5)

            # Check for errors
            if errors:
                print("ERRORS FOUND:")
                for e in errors:
                    print(e)
            else:
                print("No console errors detected.")

            page.screenshot(path="verification/flowers_screenshot.png")
            print("Screenshot saved.")

        except Exception as e:
            print(f"Navigation failed: {e}")
            if errors:
                print("ERRORS BEFORE FAIL:")
                for err in errors:
                    print(err)

        browser.close()

if __name__ == "__main__":
    run()

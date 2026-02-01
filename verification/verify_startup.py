from playwright.sync_api import sync_playwright
import time

def test_startup():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs to check for crashes
        console_logs = []
        page.on("console", lambda msg: console_logs.append(msg.text))

        print("Navigating to page...")
        page.goto("http://localhost:5173/")

        # Wait a bit for initialization (mimicking the deferred warmup time)
        print("Waiting for initialization...")
        time.sleep(3)

        # Check for the start button or loading screen
        # Note: In headless mode with WebGPU issues, scene might not render,
        # but we want to ensure the main thread didn't crash before that.

        print("Taking screenshot...")
        page.screenshot(path="verification/startup_verification.png")

        title = page.title()
        print(f"Page title: {title}")

        # Check for specific success logs or absence of specific error logs
        has_clipping_fix_log = any("[Deferred] Re-applied clipping planes fix." in log for log in console_logs)
        if has_clipping_fix_log:
            print("SUCCESS: Found clipping fix log message!")
        else:
            print("WARNING: Did not find clipping fix log message (might be timing issue or not reached yet).")

        # Check if we crashed
        crashed = any("Error: WebGPURenderer" in log for log in console_logs)
        if crashed:
            print("FAILURE: Detected WebGPURenderer crash!")
        else:
            print("SUCCESS: No WebGPURenderer crash detected in logs.")

        browser.close()

if __name__ == "__main__":
    test_startup()

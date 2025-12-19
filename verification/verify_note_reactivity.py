from playwright.sync_api import sync_playwright, expect
import time

# Verifies that demo spawn + trigger work and logs appear

def verify_note_reactivity():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[]
        )
        page = browser.new_page()
        logs = []

        def on_console(msg):
            try:
                logs.append(msg.text)
            except Exception:
                logs.append(str(msg))

        page.on("console", on_console)

        try:
            page.goto("http://localhost:5173", timeout=60000, wait_until='domcontentloaded')

            start_btn = page.locator("#startButton")
            expect(start_btn).to_be_enabled(timeout=20000)
            start_btn.click()

            # Give the scene a moment to initialize
            page.wait_for_timeout(1500)

            # Press G to spawn a flower, then F to trigger C4
            page.keyboard.press('g')
            page.wait_for_timeout(300)
            page.keyboard.press('f')
            page.wait_for_timeout(500)

            # Capture a screenshot for human inspection
            page.screenshot(path="verification/step_note_reactivity.png")

            # Basic assertions on logs
            spawn_logged = any('Demo: spawned a flower' in l for l in logs)
            trigger_logged = any('Demo: triggered C4' in l for l in logs)

            print(f"Logs captured: {logs}")
            assert spawn_logged, "Spawn log not found"
            assert trigger_logged, "Trigger log not found"

        finally:
            browser.close()


if __name__ == '__main__':
    verify_note_reactivity()

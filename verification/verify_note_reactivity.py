from playwright.sync_api import sync_playwright, expect
import time

# Verifies that demo spawn + trigger work and logs appear

def verify_note_reactivity():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-gl=swiftshader", "--enable-unsafe-webgpu"]
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
            page.goto("http://localhost:5173", timeout=90000, wait_until='domcontentloaded')

            # Wait for the scene to be ready (set by main.js)
            page.wait_for_function('window.__sceneReady === true', timeout=60000)

            # Give the scene a moment to initialize
            page.wait_for_timeout(1500)

            # Press H to spawn a mushroom, then T to trigger C4 on it
            page.keyboard.press('h')
            page.wait_for_timeout(500)
            page.keyboard.press('t')
            page.wait_for_timeout(500)

            # Capture a screenshot for human inspection
            page.screenshot(path="verification/step_note_reactivity.png")

            # Basic assertions on logs
            # We look for EITHER flower or mushroom logs depending on what was spawned
            spawn_logged = any('Demo: spawned a' in l for l in logs)
            trigger_logged = any('reactToNote:' in l for l in logs)

            print(f"Logs captured: {logs}")
            assert spawn_logged, "Spawn log not found"
            assert trigger_logged, "Trigger log not found"

            # Check if reactToNote was called with correct structure
            # reactToNote: mushroom note= C4 color= ff4040 velocity= 1
            trigger_entries = [l for l in logs if 'reactToNote:' in l]
            print(f"Trigger entries: {trigger_entries}")
            assert len(trigger_entries) > 0

        finally:
            browser.close()


if __name__ == '__main__':
    verify_note_reactivity()

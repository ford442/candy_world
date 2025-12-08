from playwright.sync_api import sync_playwright

def verify_night_mode():
    with sync_playwright() as p:
        # Need WebGPU flags
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu"
            ]
        )
        page = browser.new_page()
        try:
            # Navigate to local server (Vite default is 5173, but check log if needed)
            # Assuming 5173 for now
            page.goto("http://localhost:5173", timeout=60000)

            # Wait for instructions overlay
            page.wait_for_selector("#instructions")

            # Click to start (pointer lock)
            page.click("#instructions")

            # Wait a bit for initial load
            page.wait_for_timeout(2000)

            # Screenshot Day
            page.screenshot(path="verification_day.png")
            print("Day screenshot taken.")

            # Press 'N' for Night Mode
            page.keyboard.press("n")

            # Wait for transition (lerp is fast but safe 2s)
            page.wait_for_timeout(3000)

            # Screenshot Night
            page.screenshot(path="verification_night.png")
            print("Night screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_night_mode()

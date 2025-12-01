from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"]
        )
        page = browser.new_page()

        try:
            page.goto("http://localhost:5173/")
            page.wait_for_selector("#glCanvas", state="visible")

            # Click to start (hide instructions)
            page.click("#instructions")

            # Wait for animation/particles
            page.wait_for_timeout(5000)

            page.screenshot(path="verification_screenshot.png")
            print("Screenshot taken: verification_screenshot.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_frontend()

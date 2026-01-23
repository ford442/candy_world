from playwright.sync_api import sync_playwright
import time

def verify_weather():
    with sync_playwright() as p:
        # Use swiftshader to emulate GPU if possible
        browser = p.chromium.launch(headless=True, args=['--use-gl=swiftshader', '--enable-unsafe-webgpu'])
        page = browser.new_page()

        # Inject mock for WebGPU if needed, but let's try without first or see if we can trick it.
        # The app checks WebGPU.isAvailable().

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173/")

            print("Waiting for body...")
            page.wait_for_selector("body", timeout=30000)

            print("Waiting for 5 seconds...")
            time.sleep(5)

            # Check for error message in body
            content = page.content()
            if "WebGPU not supported" in content:
                print("WebGPU not supported warning detected.")

            print("Taking screenshot...")
            page.screenshot(path="verification/weather_verification.png")
            print("Screenshot saved to verification/weather_verification.png")

        except Exception as e:
            print(f"Error: {e}")
            try:
                page.screenshot(path="verification/error.png")
            except:
                pass

        browser.close()

if __name__ == "__main__":
    verify_weather()

from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-webgpu"])
    page = browser.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

    try:
        page.goto("http://localhost:5173/")
        page.wait_for_selector("#startButton", timeout=5000)

        # Hide instructions to see the scene
        page.evaluate("document.getElementById('instructions').style.display = 'none'")

        # Wait for potential WASM/scene load
        page.wait_for_timeout(2000)

        # Take Day Screenshot (Stars should be invisible)
        page.screenshot(path="verification/scene_day.png")
        print("Day screenshot taken.")

        # Toggle Night
        page.keyboard.press("n")
        print("Toggled Night mode.")

        # Wait for transition
        page.wait_for_timeout(3000)

        # Take Night Screenshot (Stars should be visible)
        page.screenshot(path="verification/scene_night.png")
        print("Night screenshot taken.")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

with sync_playwright() as p:
    run(p)

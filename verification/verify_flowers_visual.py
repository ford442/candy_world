from playwright.sync_api import Page, expect, sync_playwright
import time

def test_flowers_visual(page: Page):
    print("Navigating to http://localhost:5173")
    page.goto("http://localhost:5173")

    # Wait for canvas
    print("Waiting for canvas...")
    try:
        page.wait_for_selector("canvas", timeout=30000)
    except:
        print("Canvas not found! Dumping page content...")
        print(page.content()[:500])
        raise

    print("Canvas found. Waiting for world generation...")
    # Wait a bit for initial loading/generation
    time.sleep(10)

    # Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="/home/jules/verification/flowers_visual.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--enable-unsafe-webgpu']
        )
        page = browser.new_page()
        try:
            test_flowers_visual(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

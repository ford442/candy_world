from playwright.sync_api import sync_playwright

def verify_ux_changes(page):
    # Mock WebGPU to prevent crashes in headless mode
    page.add_init_script("""
        Object.defineProperty(navigator, 'gpu', {
            get: () => null
        });
    """)

    page.goto("http://localhost:4173")

    # Force hide loading screen after a short delay to ensure it loaded
    page.wait_for_timeout(1000)
    page.evaluate("if(window.hideLoadingScreen) window.hideLoadingScreen(); else document.getElementById('loading-overlay').style.display='none';")

    # Wait for instructions to be visible
    page.wait_for_selector("#instructions", state="visible")

    # Check for the new elements
    # Right Click Icon
    right_click = page.locator(".mouse-icon.right")
    # Assert it exists
    if right_click.count() > 0:
        print("✅ Right Click Icon found")
    else:
        print("❌ Right Click Icon NOT found")

    # Combo Badge (Space x2)
    combo_badge = page.locator(".combo-badge")
    if combo_badge.count() > 0:
        print("✅ Combo Badge found")
    else:
        print("❌ Combo Badge NOT found")

    # Take a screenshot of the controls container
    controls = page.locator(".controls-container")
    controls.scroll_into_view_if_needed()
    controls.screenshot(path="/home/jules/verification/controls_ux.png")
    print("📸 Screenshot saved to /home/jules/verification/controls_ux.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Use args for SwiftShader/WebGPU emulation as per memory
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--enable-unsafe-webgpu']
        )
        page = browser.new_page()
        try:
            verify_ux_changes(page)
        finally:
            browser.close()

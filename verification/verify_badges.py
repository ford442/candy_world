from playwright.sync_api import sync_playwright, expect

def verify_badges(page):
    print("Navigating to app...")
    page.goto("http://localhost:5173")

    print("Waiting for instructions overlay...")
    page.wait_for_selector("#instructions", state="visible")

    # Locate the settings container
    settings = page.locator(".settings-container")
    expect(settings).to_be_visible()

    print("Checking for Key Badges...")

    # Check Day/Night Button
    dn_btn = page.locator("#toggleDayNight")
    expect(dn_btn).to_be_visible()
    dn_badge = dn_btn.locator(".key-badge")
    expect(dn_badge).to_be_visible()
    expect(dn_badge).to_have_text("N")
    print("Day/Night Badge found: N")

    # Check Mute Button
    mute_btn = page.locator("#toggleMuteBtn")
    expect(mute_btn).to_be_visible()
    mute_badge = mute_btn.locator(".key-badge")
    expect(mute_badge).to_be_visible()
    expect(mute_badge).to_have_text("M")
    print("Mute Badge found: M")

    # Check Jukebox Button
    jukebox_btn = page.locator("#openJukeboxBtn")
    expect(jukebox_btn).to_be_visible()
    jukebox_badge = jukebox_btn.locator(".key-badge")
    expect(jukebox_badge).to_be_visible()
    expect(jukebox_badge).to_have_text("Q")
    print("Jukebox Badge found: Q")

    # Take screenshot
    print("Taking screenshot...")
    settings.screenshot(path="verification/badges_screenshot.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Use args to emulate WebGPU if possible or just standard
        browser = p.chromium.launch(headless=True, args=['--use-gl=swiftshader', '--enable-unsafe-webgpu'])
        page = browser.new_page()
        try:
            verify_badges(page)
            print("Verification Successful!")
        except Exception as e:
            print(f"Verification Failed: {e}")
            page.screenshot(path="verification/failure.png")
        finally:
            browser.close()

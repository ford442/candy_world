from playwright.sync_api import sync_playwright, expect
import os

def test_music_upload_feedback():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-gpu",
                "--use-gl=swiftshader"
            ]
        )
        context = browser.new_context()
        page = context.new_page()

        # Navigate to the app (assuming it's running on 5173)
        page.goto("http://localhost:5173")

        # Wait for the label to be visible
        label = page.locator('label[for="musicUpload"]')
        expect(label).to_be_visible()

        # Take initial screenshot
        page.screenshot(path="verification/step1_initial.png")
        print("Initial state screenshot taken")

        # Simulate file selection
        # Since we can't easily upload a real file in headless mode without a file path,
        # we will simulate the Change event manually via JS to test the UX logic.
        # This confirms our JS logic works, even if we don't do a full file upload.

        page.evaluate("""
            const input = document.getElementById('musicUpload');
            // Mock files property
            const file = new File(['dummy content'], 'song.mod', { type: 'audio/mod' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            input.files = dataTransfer.files;

            // Dispatch change event
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);
        """)

        # Wait for text update
        expect(label).to_contain_text("✅ 1 Track Added!")

        # Take feedback screenshot
        page.screenshot(path="verification/step2_feedback.png")
        print("Feedback state screenshot taken")

        # Wait for revert (2.5s + buffer)
        page.wait_for_timeout(3000)

        # Verify revert
        expect(label).to_contain_text("🎵 Upload Music")

        # Take reverted screenshot
        page.screenshot(path="verification/step3_reverted.png")
        print("Reverted state screenshot taken")

        browser.close()

if __name__ == "__main__":
    test_music_upload_feedback()

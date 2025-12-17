from playwright.sync_api import sync_playwright, expect

def test_music_upload_feedback():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"]
        )
        page = browser.new_page()
        page.goto("http://localhost:5173")

        # Enable console logging
        page.on("console", lambda msg: print(f"PAGE CONSOLE: {msg.text}"))

        # Verify element presence
        label = page.locator('label[for="musicUpload"]')
        expect(label).to_be_visible()

        # Trigger change event
        page.evaluate("""
            const input = document.getElementById('musicUpload');
            const file = new File(['test'], 'test.mod', { type: 'audio/mod' });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;

            console.log('Dispatching change event...');
            input.dispatchEvent(new Event('change', { bubbles: true }));
        """)

        # Wait a moment
        page.wait_for_timeout(1000)

        # Check text again
        text = label.inner_text()
        print(f"Label text after event: {text}")

        browser.close()

if __name__ == "__main__":
    test_music_upload_feedback()

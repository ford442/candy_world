import os
from playwright.sync_api import sync_playwright

def verify_kbd_visual():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a reasonable viewport
        page = browser.new_page(viewport={'width': 1024, 'height': 768})

        file_path = os.path.abspath("index.html")
        page.goto(f"file://{file_path}")

        # Inject styles to hide loading and show instructions clearly
        page.add_style_tag(content="""
            #loading-overlay { display: none !important; }
            #instructions { opacity: 1 !important; display: flex !important; }
            .controls-container { background: white !important; } /* Ensure contrast */
        """)

        # Wait for controls to render
        controls = page.locator(".controls-container")
        controls.wait_for()

        # Screenshot the controls container
        controls.screenshot(path="verification/controls_kbd.png")
        print("Captured controls_kbd.png")

        browser.close()

if __name__ == "__main__":
    verify_kbd_visual()

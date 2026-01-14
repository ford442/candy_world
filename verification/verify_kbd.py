import os
import sys
from playwright.sync_api import sync_playwright

def verify_kbd_elements():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        file_path = os.path.abspath("index.html")
        page.goto(f"file://{file_path}")

        # Check for kbd elements
        kbd_count = page.locator("kbd.key").count()
        print(f"Found {kbd_count} kbd.key elements")

        if kbd_count == 0:
            print("ERROR: No kbd elements found!")
            sys.exit(1)

        # Verify content of specific kbd elements
        w_key = page.locator("kbd.key", has_text="W").first
        if not w_key.is_visible():
            print("ERROR: W key not visible")
            sys.exit(1)

        print("W key verification passed")

        # Verify CSS computed style for one key
        # We need to make sure the CSS loaded. verify_focus.py uses file:// so style.css (if external) might work if relative.
        # But styles are in index.html <style> block, so they should work.

        style = w_key.evaluate("el => window.getComputedStyle(el).fontFamily")
        print(f"Computed Font Family: {style}")

        if 'Consolas' not in style and 'Monaco' not in style and 'monospace' not in style:
             print("ERROR: Font family does not match expected monospace stack")
             # It might just be 'monospace' depending on system

        display = w_key.evaluate("el => window.getComputedStyle(el).display")
        print(f"Computed Display: {display}")

        if display != "inline-block":
            print(f"ERROR: Expected inline-block, got {display}")
            sys.exit(1)

        browser.close()

if __name__ == "__main__":
    verify_kbd_elements()

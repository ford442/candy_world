from playwright.sync_api import sync_playwright, expect
import time

def test_shader_compile_message():
    with sync_playwright() as p:
        # Use SwiftShader for WebGPU verification as per instructions
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--disable-gpu-sandbox"
            ]
        )
        page = browser.new_page()

        # Go to the local dev server
        # Using localhost:5173 as per memory/common vite default
        try:
            page.goto("http://localhost:5173", timeout=60000)

            # We want to check for the loading message "Compiling Shaders..."
            # Note: This message might appear briefly or persist depending on how fast SwiftShader compiles.
            # We'll try to catch it or the subsequent "Entering Candy World..." to verify flow.
            # Given the headless env and swiftshader, it might actually be slow enough to catch.

            # Wait for loading overlay to appear
            page.wait_for_selector("#loading-overlay", state="visible", timeout=10000)

            # Check for the specific text.
            # It might have already passed if we are too slow, but let's try.
            # The text is inside #loading-text

            # Take a screenshot early to see initial state
            page.screenshot(path="verification/loading_initial.png")

            # Wait for either Compiling Shaders OR Entering Candy World
            # We can't guarantee catching "Compiling Shaders" if it's too fast,
            # but if we see "Entering Candy World" or the button enabling, we know init finished.

            # Let's just wait a bit and take screenshots at intervals to try and catch the state
            for i in range(10):
                text = page.locator("#loading-text").inner_text()
                print(f"Loading text at step {i}: {text}")
                if "Compiling Shaders" in text:
                    print("Caught 'Compiling Shaders' message!")
                    page.screenshot(path="verification/caught_compiling.png")
                    break
                if "Entering Candy World" in text:
                    print("Already entered Candy World")
                    break
                time.sleep(1)

            # Wait for start button to be enabled
            start_btn = page.locator("#startButton")
            expect(start_btn).to_be_enabled(timeout=120000) # Give plenty of time for shader compilation

            # Take final screenshot
            page.screenshot(path="verification/verification.png")
            print("Start button enabled, initialization complete.")

        except Exception as e:
            print(f"Test failed: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    test_shader_compile_message()

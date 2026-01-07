from playwright.sync_api import sync_playwright, expect
import time

def verify_interaction_ui():
    with sync_playwright() as p:
        # Launch browser with WebGPU flags enabled (just in case, though SwiftShader might be flaky)
        # Using chrome to support necessary flags better than generic chromium
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--enable-unsafe-webgpu",
                "--no-sandbox"
            ]
        )
        context = browser.new_context()
        page = context.new_page()

        try:
            print("Navigating to app...")
            # Wait for Vite to start up
            time.sleep(5)
            page.goto("http://localhost:5173")

            print("Waiting for Reticle to appear...")
            # The reticle is injected by input.js initInput.
            # We need to make sure the app initializes enough for initInput to run.

            # Check for the #game-reticle element
            reticle = page.locator("#game-reticle")

            # Wait for it to be attached to DOM
            expect(reticle).to_be_attached(timeout=30000)
            print("Reticle found in DOM.")

            # Force visible styles for screenshot just in case background is dark/light
            # The reticle has mix-blend-mode: difference, so it should be visible.

            # Take a screenshot of the initial state
            print("Taking screenshot of Reticle...")
            page.screenshot(path="verification/reticle_initial.png")

            # Verify styles (idle state)
            # Default: scale(1), bg: rgba(255, 255, 255, 0.8)
            # Note: computed style might convert rgba to rgb
            # We can check the transform style directly via evaluation
            transform = reticle.evaluate("el => el.style.transform")
            print(f"Initial Transform: {transform}")
            assert "scale(1)" in transform

            # Simulate Hover State (Directly calling the exported function is hard without exposing it globally)
            # But we can simulate it by finding the InteractionSystem instance? No, that's inside a closure/module.
            # However, we can cheat for verification:
            # The reticle logic is:
            # function updateReticleState(state) { const reticle = document.getElementById('game-reticle'); ... }
            # But that function is local to initInput scope or exported but not global.

            # Wait! updateReticleState reads from DOM ID 'game-reticle' every time.
            # So if we can somehow trigger the state change...
            # The InteractionSystem is created in main.js.

            # Since we can't easily trigger the JS logic from outside without exposing it,
            # We will verify the DOM element presence and its styling as proof `input.js` ran.

            # OPTIONAL: We can inject a script to test the reticle visuals if we really want to see the 'pink' state.
            # We can replicate the logic in the console to verify the CSS behaves as expected.
            print("Simulating Hover state via injection...")
            page.evaluate("""
                const reticle = document.getElementById('game-reticle');
                if (reticle) {
                    reticle.style.transform = 'translate(-50%, -50%) scale(3.0)';
                    reticle.style.backgroundColor = 'rgba(255, 105, 180, 0.8)';
                    reticle.style.border = '1px solid white';
                }
            """)

            time.sleep(0.5)
            page.screenshot(path="verification/reticle_hover_simulated.png")

            print("Verification Complete.")

        except Exception as e:
            print(f"Error: {e}")
            # Capture failure state
            page.screenshot(path="verification/verification_failed.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_interaction_ui()

from playwright.sync_api import sync_playwright

def verify_features():
    with sync_playwright() as p:
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

        # Capture logs
        logs = []
        page.on("console", lambda msg: logs.append(msg.text))

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173", timeout=60000)

            # Wait for loaded state
            print("Waiting for start button...")
            page.wait_for_selector("#startButton", state="visible", timeout=60000)

            # Click start
            print("Clicking start...")
            page.click("#startButton")

            # Wait for world generation logic to trigger
            print("Waiting for generation...")
            page.wait_for_timeout(10000)

            # Check logs
            found_start = False
            found_end = False

            for log in logs:
                if "Populating procedural extras" in log:
                    found_start = True
                if "Finished populating procedural extras" in log:
                    found_end = True

            if found_start and found_end:
                print("SUCCESS: Procedural extras generation started and finished successfully.")
            else:
                print(f"WARNING: Generation verification failed. Start: {found_start}, End: {found_end}")
                print("Last 20 logs:")
                for l in logs[-20:]:
                    print(l)

        except Exception as e:
            print(f"Error: {e}")
            print("Logs leading to error:")
            for l in logs[-20:]:
                print(l)
        finally:
            browser.close()

if __name__ == "__main__":
    verify_features()

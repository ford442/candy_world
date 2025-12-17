from playwright.sync_api import sync_playwright

def check_errors():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"]
        )
        page = browser.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"ERROR: {err}"))

        try:
            page.goto("http://localhost:5173", wait_until="networkidle")
        except Exception as e:
            print(f"Nav Error: {e}")

        page.wait_for_timeout(2000)
        browser.close()

if __name__ == "__main__":
    check_errors()

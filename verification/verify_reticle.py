from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

def run_test():
    options = webdriver.ChromeOptions()
    options.binary_location = '/home/jules/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=options)

    try:
        print("🌍 Loading Game...")
        driver.get("http://localhost:5173")

        # 1. Wait for Start Button (The critical fix)
        print("⏳ Waiting for Start Button...")
        start_btn = WebDriverWait(driver, 15).until(
            EC.element_to_be_clickable((By.ID, "startButton"))
        )

        # 2. Click Start
        print("🖱️ Clicking Start...")
        start_btn.click()

        # 3. Wait for Reticle
        print("🔍 Checking for Reticle...")
        reticle = WebDriverWait(driver, 5).until(
            EC.presence_of_element_located((By.ID, "game-reticle"))
        )

        # 4. Verify CSS Class toggling
        driver.execute_script("document.getElementById('game-reticle').classList.add('hover');")
        time.sleep(0.5)

        cls = reticle.get_attribute("class")
        if "hover" in cls:
            print("✅ Reticle accepted 'hover' class.")
        else:
            print(f"❌ Reticle failed to update class. Current: {cls}")

        print("✅ Reticle Verification Passed!")

    except Exception as e:
        print(f"❌ Test Failed: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    run_test()

import os

target_file = 'public/js/libopenmpt.js'

try:
    with open(target_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # The specific polyfill pattern causing the crash
    bad_pattern = "this.buffer = new ArrayBuffer(opts['initial'] * 65536);"
    # The fix: cast to Number()
    good_pattern = "this.buffer = new ArrayBuffer(Number(opts['initial']) * 65536);"

    if bad_pattern in content:
        new_content = content.replace(bad_pattern, good_pattern)
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("✅ libopenmpt.js patched successfully!")
    elif good_pattern in content:
        print("ℹ️ libopenmpt.js is already patched.")
    else:
        print("⚠️ Could not find the specific Memory polyfill pattern. File might differ from expected structure.")

except FileNotFoundError:
    print(f"❌ Error: {target_file} not found.")
except Exception as e:
    print(f"❌ Error patching file: {e}")

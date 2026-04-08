import os
import re

target_file = 'public/js/libopenmpt.js'

def patch_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    patches_applied = []
    
    # Patch 1: Fix BigInt/Number mixing error in Memory polyfill
    # The specific polyfill pattern causing the crash
    bad_pattern = "this.buffer = new ArrayBuffer(opts['initial'] * 65536);"
    # The fix: cast to Number()
    good_pattern = "this.buffer = new ArrayBuffer(Number(opts['initial']) * 65536);"
    
    if bad_pattern in content:
        content = content.replace(bad_pattern, good_pattern)
        patches_applied.append("Fixed BigInt/Number mixing in Memory polyfill")
    
    # Patch 2: Reduce large asmFunc buffer for AudioWorklet compatibility
    # The asmFunc has a hardcoded 537MB buffer (537460736 bytes) which causes
    # "Array buffer allocation failed" in AudioWorklet contexts
    # We reduce it to 64MB which should be sufficient for most use cases
    large_buffer_pattern = r"(function asmFunc\(imports\) \{\s*)var buffer = new ArrayBuffer\(537460736\);"
    reduced_buffer = r"\1var buffer = new ArrayBuffer(67108864);"  # 64MB instead of 537MB
    
    if re.search(large_buffer_pattern, content):
        content = re.sub(large_buffer_pattern, reduced_buffer, content)
        patches_applied.append("Reduced asmFunc buffer from 537MB to 64MB for AudioWorklet compatibility")
    
    # Write back if changes were made
    if patches_applied:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return patches_applied
    else:
        return ["No patches needed (already patched or patterns not found)"]

try:
    patches = patch_file(target_file)
    for patch in patches:
        print(f"✅ {patch}")

except FileNotFoundError:
    print(f"❌ Error: {target_file} not found.")
except Exception as e:
    print(f"❌ Error patching file: {e}")

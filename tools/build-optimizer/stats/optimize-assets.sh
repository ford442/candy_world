#!/bin/bash
# Asset Optimization Script for candy_world
# Generated: 2026-03-18T16:21:05.119Z

set -e

echo "🖼️ Optimizing assets..."

ASSETS_DIR="/root/.openclaw/workspace/candy_world/assets"
OUTPUT_DIR="/root/.openclaw/workspace/candy_world/dist/optimized-assets"

mkdir -p "$OUTPUT_DIR"

# Check for required tools
command -v cwebp >/dev/null 2>&1 || { echo "❌ cwebp not installed. Install with: apt install webp"; exit 1; }
command -v avifenc >/dev/null 2>&1 || echo "⚠️ avifenc not installed. AVIF generation skipped."

# Convert images to WebP
echo "Converting images to WebP..."
find "$ASSETS_DIR" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | while read img; do
  filename=$(basename "$img")
  name="${filename%.*}"
  
  # WebP conversion
  cwebp -q 85 "$img" -o "$OUTPUT_DIR/${name}.webp"
  echo "  ✓ ${name}.webp"
  
  # AVIF conversion (if available)
  if command -v avifenc >/dev/null 2>&1; then
    avifenc -q 80 "$img" "$OUTPUT_DIR/${name}.avif"
    echo "  ✓ ${name}.avif"
  fi
done

# Minify JSON files
echo "Minifying JSON files..."
find "$ASSETS_DIR" -name "*.json" | while read json; do
  filename=$(basename "$json")
  cat "$json" | jq -c . > "$OUTPUT_DIR/$filename"
  echo "  ✓ $filename minified"
done

echo ""
echo "✅ Optimization complete!"
echo "   Output: $OUTPUT_DIR"
echo ""
echo "Compare sizes:"
du -sh "$ASSETS_DIR"
du -sh "$OUTPUT_DIR"

#!/bin/bash
# Quick script to run visual regression tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "🎮 Candy World Visual Regression Testing"
echo "========================================="
echo ""

# Check if dev server is running
if ! curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "⚠️  Dev server not running at http://localhost:5173"
    echo "   Starting dev server..."
    npm run dev &
    DEV_PID=$!
    
    # Wait for server
    echo "   Waiting for server..."
    for i in {1..30}; do
        if curl -s http://localhost:5173 > /dev/null 2>&1; then
            echo "   ✅ Server ready"
            break
        fi
        sleep 1
    done
    
    if ! curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo "   ❌ Failed to start server"
        exit 1
    fi
else
    echo "✅ Dev server already running"
fi

echo ""
echo "📦 Installing dependencies..."
cd tools/visual-regression
npm install --silent 2>/dev/null || true

echo ""
echo "🚀 Running visual tests..."
npm run test:visual "$@"

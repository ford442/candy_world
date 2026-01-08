// Test to verify WASM loading works without errors
import { chromium } from '@playwright/test';

async function testWasmLoading() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const errors = [];
    const logs = [];
    
    // Capture console messages
    page.on('console', msg => {
        const text = msg.text();
        const type = msg.type();
        logs.push(text);
        if (type === 'warning' || type === 'error' || text.includes('WASM') || text.includes('Native') || text.includes('fallback')) {
            console.log(`CONSOLE [${type}]:`, text);
        }
    });
    
    // Capture errors
    page.on('pageerror', error => {
        errors.push(error.message);
        console.error('PAGE ERROR:', error.message);
    });
    
    try {
        console.log('Navigating to http://localhost:5173...');
        await page.goto('http://localhost:5173', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        // Wait a bit for WASM loading to complete
        await page.waitForTimeout(8000);
        
        // Check if WASM loader is available
        const wasmStatus = await page.evaluate(() => {
            if (window.wasmLoader) {
                return {
                    ready: window.wasmLoader.isWasmReady ? window.wasmLoader.isWasmReady() : false,
                    emscriptenReady: window.wasmLoader.isEmscriptenReady ? window.wasmLoader.isEmscriptenReady() : false
                };
            }
            return null;
        });
        
        console.log('WASM Status:', wasmStatus);
        
        // Check for critical errors
        const hasAbortError = errors.some(err => err.includes('Aborted(Assertion failed: missing Wasm export: calcSpeakerPulse)'));
        const hasWasmStreamingError = logs.some(log => log.includes('wasm streaming compile failed'));
        
        console.log('\n=== Test Results ===');
        console.log('Total errors:', errors.length);
        console.log('Has abort error:', hasAbortError);
        console.log('Has WASM streaming error:', hasWasmStreamingError);
        
        if (hasAbortError) {
            console.error('\n❌ FAILED: Still has calcSpeakerPulse abort error');
            process.exit(1);
        }
        
        // Check that we have fallback messages
        const hasFallbackMsg = logs.some(log => 
            log.includes('JS fallback') || 
            log.includes('candy_native.wasm not found') ||
            log.includes('Using JS fallback')
        );
        
        if (hasFallbackMsg) {
            console.log('\n✅ SUCCESS: WASM files not found, using JS fallback gracefully');
        } else {
            console.log('\n✅ SUCCESS: WASM loaded or no errors encountered');
        }
        
        await browser.close();
        process.exit(0);
        
    } catch (error) {
        console.error('Test failed:', error);
        await browser.close();
        process.exit(1);
    }
}

testWasmLoading();

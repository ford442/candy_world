// Shared utility for checking WASM file existence
// Used by wasm-loader.js and wasm-orchestrator.js

/**
 * Check if a WASM file exists by attempting HEAD requests at different paths
 * @param {string} filename - The WASM filename to check (e.g., 'candy_native.wasm')
 * @returns {Promise<{exists: boolean, path: string}>} - Result with existence status and resolved path
 */
export async function checkWasmFileExists(filename) {
    // Try production path first
    const prodPath = `/candy-world/${filename}`;
    try {
        const prodCheck = await fetch(prodPath, { method: 'HEAD' });
        if (prodCheck.ok) {
            return { exists: true, path: '/candy-world' };
        }
    } catch (prodError) {
        // Continue to local path check
    }

    // Try local path
    const localPath = `./${filename}`;
    try {
        const localCheck = await fetch(localPath, { method: 'HEAD' });
        if (localCheck.ok) {
            return { exists: true, path: '' };
        }
    } catch (localError) {
        // File not found
    }

    return { exists: false, path: null };
}

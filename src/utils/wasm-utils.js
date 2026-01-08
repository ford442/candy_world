// Shared utility for checking WASM file existence
// Used by wasm-loader.js and wasm-orchestrator.js

// Production deployment path prefix
const PRODUCTION_PATH_PREFIX = '/candy-world';

/**
 * Check if a WASM file exists by attempting HEAD requests at different paths
 * @param {string} filename - The WASM filename to check (e.g., 'candy_native.wasm')
 * @returns {Promise<{exists: boolean, path: string}>} - Result with existence status and resolved path
 */
export async function checkWasmFileExists(filename) {
    // Try production path first
    const prodPath = `${PRODUCTION_PATH_PREFIX}/${filename}`;
    try {
        const prodCheck = await fetch(prodPath, { method: 'HEAD' });
        if (prodCheck.ok) {
            return { exists: true, path: PRODUCTION_PATH_PREFIX };
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

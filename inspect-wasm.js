import fs from 'fs';
import path from 'path';

const wasmPath = path.resolve('public/candy_physics.wasm');
console.log(`Loading WASM from: ${wasmPath}`);

try {
    const buffer = fs.readFileSync(wasmPath);
    console.log(`File size: ${buffer.length} bytes`);

    WebAssembly.instantiate(buffer, {
        env: {
            abort: () => console.log('Abort called')
        },
        wasi_snapshot_preview1: {
            fd_close: () => 0,
            fd_seek: () => 0,
            fd_write: () => 0,
            fd_read: () => 0,
            fd_fdstat_get: () => 0,
            fd_prestat_get: () => 0,
            fd_prestat_dir_name: () => 0,
            path_open: () => 0,
            environ_sizes_get: () => 0,
            environ_get: () => 0,
            proc_exit: () => { },
            clock_time_get: () => 0,
        }
    }).then(result => {
        const exports = Object.keys(result.instance.exports);
        console.log('Exports found:', exports);
        if (exports.includes('getGroundHeight')) {
            console.log('SUCCESS: getGroundHeight is exported!');
        } else {
            console.error('FAILURE: getGroundHeight is MISSING.');
        }
    }).catch(e => {
        console.error('Instantiation failed:', e);
    });

} catch (e) {
    console.error('File read failed:', e);
}

import fs from 'fs';
const path = 'public/candy_native.wasm';
if (!fs.existsSync(path)) {
  console.log('wasm not found', path);
  process.exit(0);
}
try {
  const bytes = fs.readFileSync(path);
  const mod = new WebAssembly.Module(bytes);
  const ex = WebAssembly.Module.exports(mod).map(e => e.name);
  console.log('exports count:', ex.length);
  console.log(ex.join('\n'));
} catch (e) {
  console.error('failed to inspect wasm', e);
  process.exit(1);
}
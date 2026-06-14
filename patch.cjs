const fs = require('fs');
const text = fs.readFileSync('src/utils/startup-profiler.ts', 'utf8');
const newText = text.replace(
  'return originalCreateShaderModule.call(device, desc);',
  'return result;'
);
fs.writeFileSync('src/utils/startup-profiler.ts', newText);

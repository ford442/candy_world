const fs = require('fs');
const path = require('path');
const filePath = path.resolve(__dirname, '../src/audio-system.ts');
let content = fs.readFileSync(filePath, 'utf8');
const before = 'this.scriptNode.onaudioprocess = (e: any) =>';
const after = 'this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) =>';
if (content.includes(before)) {
  content = content.split(before).join(after);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated onaudioprocess parameter to AudioProcessingEvent.');
} else {
  console.log('No change needed — pattern not found.');
}

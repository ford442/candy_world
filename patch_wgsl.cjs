const fs = require('fs');

let content = fs.readFileSync('src/compute/chores/gpu-chores-wgsl.ts', 'utf8');

// Fix the barrier inside conditional flow issue
content = content.replace(
  /for \(var d = 1u; d < 256u; d \*= 2u\) \{\n        if \(lid >= d\) \{\n            let temp = sharedData\[lid - d\];\n            workgroupBarrier\(\);\n            sharedData\[lid\] \+= temp;\n        \}\n        workgroupBarrier\(\);\n    \}/g,
  `for (var d = 1u; d < 256u; d *= 2u) {
        var temp = 0u;
        if (lid >= d) {
            temp = sharedData[lid - d];
        }
        workgroupBarrier();
        if (lid >= d) {
            sharedData[lid] += temp;
        }
        workgroupBarrier();
    }`
);

fs.writeFileSync('src/compute/chores/gpu-chores-wgsl.ts', content);

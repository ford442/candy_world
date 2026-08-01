import madge from 'madge';
madge('src/core/main.ts', {
  includeNpm: false,
  excludeRegExp: [/^node_modules/]
}).then((res) => {
  const deps = res.obj();
  const depArray = [];
  for (const [dep, arr] of Object.entries(deps)) {
      if (dep.includes('audio')) {
          for (const item of arr) {
              if (item.includes('utils') || item.includes('world') || item.includes('ui') || item.includes('debug') || item.includes('core') || item.includes('systems') || item.includes('foliage') || item.includes('rendering') || item.includes('audio') || item.includes('compute') || item.includes('particles')) {
                  depArray.push(`${dep} -> ${item}`);
              }
          }
      }
  }
  console.log(depArray);
});

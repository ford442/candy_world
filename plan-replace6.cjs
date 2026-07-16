const fs = require('fs');
const path = 'src/systems/physics/physics-core.ts';
let code = fs.readFileSync(path, 'utf8');

const target1 = `                        const obj = cell[i];
                        if (obj._lastQueryId !== _globalQueryId) {
                            obj._lastQueryId = _globalQueryId;
                            this._queryResult.push(obj);
                        }`;
const replace1 = `                        const obj = cell[i];
                        if (obj._gridStamp !== _globalQueryId) {
                            obj._gridStamp = _globalQueryId;
                            this._queryResult.push(obj);
                        }`;

if (code.includes(target1)) {
    code = code.replace(target1, replace1);
    fs.writeFileSync(path, code);
    console.log('Replaced block in ' + path);
} else {
    console.log('Target block not found in ' + path);
}

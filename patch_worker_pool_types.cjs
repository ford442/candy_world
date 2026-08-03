const fs = require('fs');
let content = fs.readFileSync('src/workers/worker-pool.ts', 'utf8');

const target1 = `    const response = await this.sendRequest<PhysicsRequest>('physics', {
      type: 'getGroundHeight',
      x,
      z
    });`;
const rep1 = `    const response = await this.sendRequest<GroundHeightRequest>('physics', {
      type: 'getGroundHeight',
      x,
      z
    });`;
content = content.replace(target1, rep1);

const target2 = `    const response = await this.sendRequest<PhysicsRequest>('physics', {
      type: 'batchGroundHeight',
      positions
    }, 60000);`;
const rep2 = `    const response = await this.sendRequest<BatchGroundHeightRequest>('physics', {
      type: 'batchGroundHeight',
      positions
    }, 60000);`;
content = content.replace(target2, rep2);

const target3 = `    const response = await this.sendRequest<PhysicsRequest>('physics', {
      type: 'checkPositionValidity',
      x,
      z,
      radius
    });`;
const rep3 = `    const response = await this.sendRequest<CollisionCheckRequest>('physics', {
      type: 'checkPositionValidity',
      x,
      z,
      radius
    });`;
content = content.replace(target3, rep3);

fs.writeFileSync('src/workers/worker-pool.ts', content, 'utf8');

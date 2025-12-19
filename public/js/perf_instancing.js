import * as THREE from '/node_modules/three/build/three.module.js';
import { initWasm } from '/src/utils/wasm-loader.js';
import { musicalFlora } from '/src/foliage/musical_flora.js';

const logEl = id('log');
function id(n){return document.getElementById(n)}
function log(...args){ logEl.textContent += '\n' + args.join(' '); console.log(...args); logEl.scrollTop = logEl.scrollHeight; }

async function runTest({ count = 3000, instanced = true, frames = 300 }){
  log(`\n=== Running test: ${instanced ? 'Instanced' : 'Individual'} | count=${count}, frames=${frames}`);

  // Ensure WASM module is initialized (for batchAnimationCalc)
  const ok = await initWasm();
  log('initWasm ->', ok);

  // Basic THREE setup
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(800, 600);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x333333);
  const camera = new THREE.PerspectiveCamera(60, 800/600, 0.1, 1000);
  camera.position.set(0, 50, 120);
  camera.lookAt(0,0,0);

  // Light
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(50,80,50); scene.add(dl);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Geometry & material (simple, fast)
  const geo = new THREE.ConeGeometry(0.3, 0.8, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x88ff88 });

  const data = []; // {x,y,z,scale}
  const radius = 60;
  for (let i=0;i<count;i++){
    const a = Math.random()*Math.PI*2;
    const r = Math.sqrt(Math.random())*radius;
    const x = Math.cos(a)*r;
    const z = Math.sin(a)*r;
    const y = 0;
    data.push({x,y,z,scale: 1.0});
  }

  let instancedMesh = null;
  let individualGroup = null;

  if (instanced) {
    instancedMesh = new THREE.InstancedMesh(geo, mat, count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // populate matrices
    const dummy = new THREE.Object3D();
    for (let i=0;i<count;i++){
      const d = data[i];
      dummy.position.set(d.x, d.y, d.z);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    scene.add(instancedMesh);

    // Register to musicalFlora manager
    musicalFlora.register('perf_mushrooms', instancedMesh, data);
  } else {
    individualGroup = new THREE.Group();
    for (let i=0;i<count;i++){
      const m = new THREE.Mesh(geo, mat);
      const d = data[i];
      m.position.set(d.x, d.y, d.z);
      individualGroup.add(m);
    }
    scene.add(individualGroup);
  }

  // Animation loop measure
  let frame = 0;
  const times = [];
  const start = performance.now();

  function step(){
    const t0 = performance.now();
    const now = (t0 - start) / 1000;

    // Update animation: for instanced we use musicalFlora update which calls WASM-based batchAnimationCalc
    if (instanced) {
      musicalFlora.update(now, 1/60, { energy: 0.8, kickTrigger: 0 });
    } else {
      // naive per-mesh update (simulate heavy JS work)
      const children = individualGroup.children;
      for (let i=0;i<children.length;i++){
        const m = children[i];
        m.position.y = Math.sin(now*3 + i*0.01)*0.2;
        m.rotation.x = Math.sin(now*2 + i*0.01)*0.1;
      }
    }

    renderer.render(scene, camera);
    const t1 = performance.now();
    times.push(t1 - t0);
    frame++;

    if (frame < frames) requestAnimationFrame(step);
    else finishTest();
  }

  function finishTest(){
    const sum = times.reduce((a,b)=>a+b,0);
    const mean = sum / times.length;
    const max = Math.max(...times);
    const sorted = times.slice().sort((a,b)=>a-b);
    const median = sorted[Math.floor(sorted.length/2)];

    log(`Test finished — frames=${times.length}`);
    log(`Mean frame ms: ${mean.toFixed(2)} | median: ${median.toFixed(2)} | max: ${max.toFixed(2)}`);

    if (performance && performance.memory) {
      const mem = performance.memory;
      log(`JS Heap used: ${(mem.usedJSHeapSize/1024/1024).toFixed(2)} MB (limit ${(mem.jsHeapSizeLimit/1024/1024).toFixed(2)} MB)`);
    } else {
      log('performance.memory not available in this browser');
    }

    // Clean up
    if (instancedMesh) scene.remove(instancedMesh);
    if (individualGroup) scene.remove(individualGroup);
    renderer.dispose();
    canvas.remove();
    log('Cleanup done.');
  }

  requestAnimationFrame(step);
}

// UI wiring
id('run').addEventListener('click', ()=>{
  const count = Number(id('count').value);
  const inst = id('useInstanced').checked;
  const frames = Number(id('frames').value);
  runTest({ count, instanced: inst, frames });
});

id('runBoth').addEventListener('click', async ()=>{
  const count = Number(id('count').value);
  const frames = Number(id('frames').value);
  await runTest({ count, instanced: true, frames });
  await new Promise(r=>setTimeout(r, 800));
  await runTest({ count, instanced: false, frames });
});

log('Perf page loaded. Use the controls above to run tests.');

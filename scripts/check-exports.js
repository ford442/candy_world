import fs from 'fs';
import path from 'path';
import url from 'url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const required = {
  materials: ['foliageMaterials', 'reactiveMaterials', 'registerReactiveMaterial', 'createClayMaterial'],
  instancing: ['initGrassSystem', 'addGrassInstance'],
  animation: ['updateFoliageMaterials', 'animateFoliage'],
  creators: ['createGrass', 'createFlower', 'createFloweringTree', 'createShrub', 'createGlowingFlower', 'createFloatingOrb', 'createVine', 'createStarflower', 'createBellBloom', 'createWisteriaCluster', 'createRainingCloud', 'createLeafParticle', 'createGlowingFlowerPatch', 'createFloatingOrbCluster', 'createVineCluster', 'createBubbleWillow', 'createPuffballFlower', 'createHelixPlant', 'createBalloonBush', 'createPrismRoseBush']
};

function checkFile(filePath, names) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  let ok = true;
  names.forEach(name => {
    const re = new RegExp(`export\\s+(?:function|const|let|var|class)\\s+${name}`);
    const re2 = new RegExp(`export\\s+\\*\\s+from\\s+.*${name}`);
    if (!re.test(content) && !re2.test(content) && !content.includes(`export { ${name}`)) {
      console.error(`Missing export ${name} in ${filePath}`);
      ok = false;
    }
  });
  return ok;
}

let success = true;
success = success && checkFile(path.join(projectRoot, 'src', 'foliage', 'materials.ts'), required.materials);
success = success && checkFile(path.join(projectRoot, 'src', 'foliage', 'instancing.ts'), required.instancing);
success = success && checkFile(path.join(projectRoot, 'src', 'foliage', 'animation.ts'), required.animation);

// creators are re-exported from multiple files under creators/
const creatorFiles = {
  'createGrass': 'grass.ts',
  'createFlower': 'flowers.ts',
  'createFloweringTree': 'trees.ts',
  'createShrub': 'trees.ts',
  'createGlowingFlower': 'flowers.ts',
  'createFloatingOrb': 'orbs.ts',
  'createVine': 'vines.ts',
  'createStarflower': 'flowers.ts',
  'createBellBloom': 'flowers.ts',
  'createWisteriaCluster': 'flowers.ts',
  'createRainingCloud': 'clouds.ts',
  'createLeafParticle': 'grass.ts',
  'createGlowingFlowerPatch': 'clouds.ts',
  'createFloatingOrbCluster': 'orbs.ts',
  'createVineCluster': 'vines.ts',
  'createBubbleWillow': 'trees.ts',
  'createPuffballFlower': 'flowers.ts',
  'createHelixPlant': 'flowers.ts',
  'createBalloonBush': 'orbs.ts',
  'createPrismRoseBush': 'trees.ts'
};

Object.keys(creatorFiles).forEach(name => {
  success = success && checkFile(path.join(projectRoot, 'src', 'foliage', 'creators', creatorFiles[name]), [name]);
});

if (!success) {
  console.error('Export verification failed. Please ensure the exports exist in their modules.');
  process.exit(1);
}
console.log('Export verification passed.');

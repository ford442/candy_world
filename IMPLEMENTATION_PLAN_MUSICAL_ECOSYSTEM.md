# Musical Ecosystem - Implementation Plan

## Overview

Transform Candy World from a visual experience into an interactive musical ecosystem with weather-driven growth, enhanced day/night cycles, and platformer mechanics.

---

## Phase 1: Berry & Fruit System

### 1.1 Berry Geometry (`foliage.js`)

Create berry cluster functions with SSS-capable materials:

```javascript
function createBerryCluster(options = {}) {
  const count = options.count || 5;
  const color = options.color || 0xFF6600;
  const baseGlow = options.baseGlow || 0.2;
  
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.08, 16, 16);
  
  // SSS Material for translucency
  const material = new MeshPhysicalNodeMaterial();
  material.transmission = 0.6; // Translucent
  material.thickness = 0.4; // SSS depth
  material.roughness = 0.3;
  material.color.setHex(color);
  material.emissive.setHex(color);
  material.emissiveIntensity = baseGlow;
  
  // Create cluster
  for (let i = 0; i < count; i++) {
    const berry = new THREE.Mesh(geometry, material.clone());
    // Position in cluster pattern
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.12;
    berry.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.5,
      Math.sin(angle) * radius
    );
    berry.scale.setScalar(0.8 + Math.random() * 0.4);
    group.add(berry);
  }
  
  // Store for weather system
  group.userData.berries = group.children;
  group.userData.baseGlow = baseGlow;
  group.userData.weatherGlow = 0;
  
  return group;
}
```

**Berry Types:**

- **Cyan Berries** - Oak-like trees
- **Magenta Pears** - Flowering trees  
- **Orange Orbs** - Shrubs
- **Purple Clusters** - Vines

### 1.2 Integration with Trees

Modify `createFloweringTree` and tree functions:

```javascript
// In createFloweringTree
if (Math.random() > 0.5) {
  const berries = createBerryCluster({
    color: 0xFF00AA,
    count: 8,
    baseGlow: 0.3
  });
  berries.position.y = trunkHeight + crownRadius * 0.5;
  tree.add(berries);
  tree.userData.berries = berries;
}
```

### 1.3 Luminescence System

Add to `updateFoliageMaterials`:

```javascript
export function updateBerryGlow(tree, weatherIntensity, audioData) {
  if (!tree.userData.berries) return;
  
  // Use WASM lerpColor for smooth transitions
  const glowFactor = clamp(weatherIntensity + (audioData.grooveAmount || 0), 0, 2);
  
  tree.userData.berries.children.forEach(berry => {
    berry.material.emissiveIntensity = tree.userData.baseGlow * (1 + glowFactor);
  });
}
```

---

## Phase 2: Weather System

### 2.1 Weather Module (`weather.js`)

```javascript
export class WeatherSystem {
  constructor(scene, audioSystem) {
    this.scene = scene;
    this.audio = audioSystem;
    this.state = 'clear'; // clear, rain, storm
    this.intensity = 0;
    
    // Particle systems
    this.percussionRain = null; // Fat droplets
    this.melodicMist = null;    // Fine spray
    this.lightning = null;
    
    this.initParticles();
  }
  
  update(time, audioData) {
    // Map audio to weather
    const bassIntensity = audioData.kickTrigger || 0;
    const melodyVol = audioData.channelData?.[2]?.volume || 0;
    
    // Percussion Rain (bass → structural growth)
    if (bassIntensity > 0.7) {
      this.triggerPercussionRain(bassIntensity);
    }
    
    // Melodic Mist (melody → flowers)
    if (melodyVol > 0.3) {
      this.triggerMelodicMist(melodyVol);
    }
    
    // Storm (all channels peak)
    if (this.detectStorm(audioData)) {
      this.triggerStorm();
    }
    
    this.updateParticles(time);
  }
  
  triggerPercussionRain(intensity) {
    // Use WASM calcRainDropY for particle updates
    // Spawn fat droplets, track ground hits
    // On hit: grow tree/mushroom nearby
  }
  
  detectStorm(audioData) {
    // Check if multiple channels are peaking
    const channels = audioData.channelData || [];
    const peakCount = channels.filter(ch => ch.volume > 0.8).length;
    return peakCount >= 3;
  }
}
```

### 2.2 Growth Logic

```javascript
function handleRainHit(position, type) {
  if (type === 'percussion') {
    // Grow structural plant
    const nearest = findNearestStructural(position);
    if (nearest) {
      scaleStructural(nearest, 1.05); // Grow 5%
    } else {
      spawnNewTree(position);
    }
  } else if (type === 'melodic') {
    // Bloom flowers
    const flowers = findNearbyFlowers(position);
    flowers.forEach(f => bloomFlower(f));
  }
}
```

### 2.3 Berry Charging

```javascript
function chargeBerries(stormIntensity, duration) {
  allTrees.forEach(tree => {
    if (tree.userData.berries) {
      tree.userData.weatherGlow += stormIntensity * duration;
      tree.userData.weatherGlow = Math.min(2.0, tree.userData.weatherGlow);
      
      // Slow decay after storm
      tree.userData.glowDecayRate = 0.01;
    }
  });
}
```

---

## Phase 3: Enhanced Day/Night Cycle

### 3.1 New Cycle Structure

**Total: 16 minutes**

| Phase | Duration | Description |
|-------|----------|-------------|
| **Sunrise** | 1 min | Transition, plants wake |
| **Day** | 5 min | Normal growth |
| **Sunset** | 1 min | Transition |
| **Dusk Night** | 3 min | Partial bio glow |
| **Deep Night** | 2 min | Most sleep, special flowers glow |
| **Pre-Dawn** | 3 min | Re-awakening |

### 3.2 Deep Night Logic (`main.js`)

```javascript
function updateDeepNight(cycleProgress) {
  const isDeepNight = cycleProgress > 0.625 && cycleProgress < 0.75;
  
  if (isDeepNight) {
    // Dim most plants (use calcShiver for subtle movement)
    regularFoliage.forEach(plant => {
      if (!plant.userData.deepNightFlower) {
        plant.visible = false; // Or reduce opacity
      }
    });
    
    // Activate special flowers
    deepNightFlowers.forEach(flower => {
      const pulse = calcPrismRose(time, flower.userData.offset, 0, 0.5, true);
      flower.material.emissiveIntensity = pulse.pulse * 3.0;
    });
  }
}
```

### 3.3 Sleep States

Use WASM `calcShiver` for sleeping plants:

```javascript
if (plantIsSleeping) {
  const shiver = calcShiver(time, offset, 0.05); // Very subtle
  plant.rotation.x = shiver.rotX;
  plant.rotation.z = shiver.rotZ;
}
```

---

## Phase 4: Textures & Materials

### 4.1 Procedural Bark Texture

Use Emscripten `fbm` for bark:

```javascript
import { fbm } from './wasm-loader.js';

function generateBarkTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const noise = fbm(x * 0.05, y * 0.05, 4);
      const value = Math.floor((noise + 1) * 127.5);
      const idx = (y * size + x) * 4;
      imageData.data[idx] = value * 0.6; // R
      imageData.data[idx + 1] = value * 0.4; // G
      imageData.data[idx + 2] = value * 0.2; // B
      imageData.data[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
```

### 4.2 Mushroom Cap Material

```javascript
const capMaterial = new MeshPhysicalNodeMaterial();
capMaterial.map = generateMushroomCapTexture();
capMaterial.normalMap = generateBumpMap();
capMaterial.roughness = 0.6;
capMaterial.clearcoat = 0.3; // Waxy look
```

---

## Phase 5: Physics & Platforming

### 5.1 Cloud Collision

```javascript
class CloudPlatform {
  constructor(cloudMesh, tier) {
    this.mesh = cloudMesh;
    this.tier = tier; // 1 = solid, 2 = pass-through
    this.isWalkable = tier === 1;
    
    if (this.isWalkable) {
      // Create simplified collision mesh
      this.collider = new THREE.Mesh(
        new THREE.BoxGeometry(cloudMesh.scale.x, 2, cloudMesh.scale.z),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      this.collider.position.copy(cloudMesh.position);
    }
  }
  
  checkPlayerCollision(playerPos) {
    if (!this.isWalkable) return null;
    
    // Simple AABB check
    const bounds = this.collider.geometry.boundingBox;
    // ... collision logic
  }
}
```

### 5.2 Mushroom Bouncing

```javascript
function checkMushroomCapCollision(player, mushroom) {
  if (player.velocity.y < 0 && isOnCapTop(player, mushroom)) {
    // Use WASM calcHopY for bounce curve
    const audioBoost = audioSystem.getKickTrigger();
    const bounceForce = 5.0 * (1 + audioBoost);
    
    player.velocity.y = bounceForce;
    
    // Visual feedback
    const result = calcSpeakerPulse(time, 0, audioBoost);
    mushroom.scale.y = result.scaleY;
  }
}
```

---

## Implementation Order

### Week 1: Foundation

1. ✅ Berry geometry functions
2. ✅ Berry spawning on trees
3. ✅ Basic SSS materials
4. Weather.js skeleton

### Week 2: Audio Integration

5. Weather → audio mapping
6. Percussion rain particles
7. Melodic mist particles
8. Berry glow system

### Week 3: Cycle & Growth

9. Enhanced day/night phases
10. Deep Night flowers
11. Plant sleep states
12. Growth triggers from weather

### Week 4: Physics

13. Cloud collision
14. Mushroom bouncing
15. Texture generation
16. Polish & optimization

---

## Performance Targets

- **60 FPS** with 30+ giant mushrooms
- **Max 2000 particles** for weather
- Use **WASM batch functions** for particle updates
- GPU-side vertex displacement for "breathing" effect

---

## Files to Modify

| File | Changes |
|------|---------|
| `foliage.js` | Add berry functions, update materials |
| `main.js` | Integrate weather, update cycle |
| `sky.js` | Add Deep Night phase |
| `wasm-loader.js` | Already done ✅ |
| **NEW** | `weather.js` - Weather system module |

---

## Testing Checklist

- [ ] Berries spawn on all tree types
- [ ] Berry glow responds to weather
- [ ] Rain particles trigger growth
- [ ] Deep Night activates special flowers
- [ ] Player can walk on Tier 1 clouds
- [ ] Mushroom caps bounce player
- [ ] Textures load without lag
- [ ] 60 FPS maintained with all effects

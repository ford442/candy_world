# Local point and spot lights

Candy World is still lit as **hemisphere ambient + one directional sun**. Local
point and spot lights are first-class *fills*: physically plausible inverse-square
falloff (`decay = 2`), pastel PALETTE tints, optional cone/cookie, and at most
one extra shadow map.

The sun remains the shadow hero (CSM on WebGPU). Clustered / tiled culling
should consume this registry rather than walking the scene graph.

## API (`src/rendering/lights.ts`)

Call `initLocalLights(scene, renderer)` once from scene init (already wired).

| Function | GPU light? | Use |
| --- | --- | --- |
| `createPointLight(opts)` | yes | Authored / weather fills. Reuses a fixed pool. |
| `createSpotLight(opts)` | yes | Cone + optional `map` cookie. Optional `castShadow`. |
| `registerDecorativeFill(opts)` | **no** | Flower heads, orbs, generation loops. Descriptor only. |
| `releaseLocalLight(id)` | — | Returns the pool slot. No per-frame alloc. |
| `forEachLocalLight(fn)` | — | Snapshot walk for clustered culling. |
| `localShadowsAllowed()` | — | False on `low`, CI, WebGL. |

Ids are stable. Creating the same `id` twice returns the existing handle.

### Options (defaults from `CONFIG.lighting.local`)

```ts
createPointLight({
  id: 'authored-crystal-fill',
  role: 'authored',          // authored | weather | debug
  color: 0x7fe8ff,           // candy cyan
  intensity: 0.9,
  distance: 14,
  decay: 2,
  castShadow: false,
  parent: scene,
  position: [6, 2.8, -10],
});

createSpotLight({
  id: 'authored-mushroom-spot',
  role: 'authored',
  color: 0xffb3d9,           // candy pink
  angle: Math.PI / 5,
  penumbra: 0.5,
  castShadow: true,          // honored only if a shadow slot remains
  parent: scene,
  position: [0, 5.5, 3],
  target: [0, 0, 0],
  map: cookieTexture,        // optional; no IES
});
```

Quality tiers: lights still illuminate on `low`. Extra shadow maps are skipped
on `low`, CI/headless, and WebGL (directional-only shadows).

## In-world examples

- Spawn crystal fill + mushroom-cap spot (always, near origin).
- First cave entrance gets an interior cyan fill (`tryAttachAuthoredCaveFill`).
- First giant mushroom relocates the cap spot onto the cap.
- Lightning is the weather point light (`weather-lightning`), intensity 0 until a strike.

Helpers: `?debug=1` or `?lights=1`. Breadcrumb: `window.__localLights`.

## What not to do

```ts
// ❌ generation loop
headGroup.add(new THREE.PointLight(color, 0.3, 2));

// ✓ decorative descriptor (clustered follow-up will see it)
registerDecorativeFill({ parent: headGroup, color, intensity: 0.3, distance: 2 });
```

Pool sizes are fixed (8 point, 4 spot, 256 decorative). Exhaustion logs once
and returns `null` — raise the pool only for authored/weather, never for flora.

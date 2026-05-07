clip-distances
Scenario: Rendering a water reflection plane that clips underwater geometry.

Without this, you'd need to manually discard fragments in the fragment shader or use stencil masks, wasting GPU cycles on invisible pixels. With clip-distances, your vertex shader can mark geometry as "above" or "below" the water plane:

// Vertex shader
let world_pos = uniforms.model_matrix * vec4<f32>(position, 1.0);
// Distance to water plane (positive = above water)
vertex_output.clip_distance0 = dot(world_pos, water_plane);
The GPU automatically culls underwater triangles before rasterization, giving you free clipping for reflection passes. Perfect for mirror surfaces, portal rendering, or camera frustum culling in open-world games.

depth32float-stencil8
Scenario: Deferred decal rendering with precise stencil masking.

You're painting bullet holes and graffiti on complex geometry. You need both high-precision depth testing (to avoid z-fighting) and stencil operations to limit decals to specific surfaces. Without this extension, you'd need two separate textures, doubling your memory bandwidth.

With depth32float-stencil8, your G-buffer pass writes depth to the 32-bit float component while marking decal-receiving surfaces in the stencil component. Your decal pass then uses stencil_compare_func = equal to only affect marked pixels, all in a single efficient render pass.

dual-source-blending
Scenario: Order-independent transparency for particle systems.

Your game has magical fire effects with 50+ overlapping particles. Standard alpha blending requires painful sorting by depth. With dual-source blending, your fragment shader outputs two colors:

// Fragment shader
fragment_output.color0 = vec4<f32>(fire_color.rgb, alpha);  // Source color
fragment_output.color1 = vec4<f32>(fire_color.rgb * alpha, 0.0);  // Contribution
The blend operation src0 * (1 - dst_alpha) + src1 composites particles correctly without sorting, giving you 60% faster particle rendering for dense effects like smoke, magic, or explosions.

float32-blendable
Scenario: HDR bloom with linear filtering in high dynamic range.

You're doing deferred shading with lighting calculated in 32-bit float render targets. Without this extension, you must convert to 8-bit unorm for blending, crushing your HDR values and causing banding.

With float32-blendable, you can accumulate lights additively into a rgba32float target:

// Blend state for HDR accumulation
color_blend: {
    src_factor: one,
    dst_factor: one,
    operation: add
}
Then directly blur this HDR texture for bloom without precision loss. Your bright spots stay bright, and you avoid costly format conversions.

subgroups
Scenario: Tiled lighting in a forward+ renderer.

You're rendering a night scene with 200 point lights. In traditional forward+, each pixel loops through all lights, wasting cycles on distant lights. With subgroups, tiles of 16x16 pixels cooperatively cull lights:

// Fragment shader - all fragments in tile work together
var min_depth = subgroupMin(fragment_depth);
var max_depth = subgroupMax(fragment_depth);
let visible_lights = cull_lights_by_depth_range(min_depth, max_depth);

// Now each pixel only loops through lights that affect its tile
for (var i = 0u; i < visible_lights.count; i++) {
    lighting += calculate_light(visible_lights[i]);
}
This gives 3-5x speedup in scenes with many lights by sharing culling work across parallel pixels.

float32-filterable
Scenario: Volumetric fog with 3D noise textures.

Your atmospheric fog uses a 3D r32float texture to store signed distance field data for raymarching. Without filtering, you get harsh banding artifacts. With this extension, you enable linear filtering:

// Sample with hardware filtering
let fog_density = textureSampleLevel(fog_volume, sampler_linear, uvw, 0).r;
This gives smooth, cinematic fog without manual smoothing shaders, reducing your fog pass from 16 samples to 4 samples while maintaining quality.

texture-component-swizzle
Scenario: Terrain splatting with packed texture arrays.

Your terrain uses 4 splat maps (dirt, grass, rock, snow) but you want to save VRAM. Store them in a single rgba8unorm texture where:

R = dirt mask
G = grass mask
B = rock mask
A = snow mask
In your shader, swizzle components to reuse the same texture for different material properties:

// Bind same texture twice with different swizzles
@group(0) @binding(0) var diffuse_map: texture_2d<f32>;  // RGBA = masks
@group(0) @binding(1) var roughness_map: texture_2d<f32>;  // Swizzled view

// In pipeline creation, set roughness_map swizzle to .gggg
// Now sampling roughness_map gives you the grass mask in all channels
This cuts VRAM usage by 75% for terrain textures without complex packing/unpacking code.

shader-f16
Scenario: Mobile GPU vertex shader performance.

Your mobile game has complex skinning with 100+ bone matrices. Full f32 calculations are bandwidth-heavy and slow on mobile GPUs. Use f16 for skinning calculations:

// Vertex shader - half precision is enough for skinning
let bone_weights: vec4<f16> = input.weights;
let bone_indices: vec4<u32> = input.indices;

var skinned_pos: vec3<f16> = vec3<f16>(0.0);
for (var i = 0; i < 4; i++) {
    let bone_mat = bones[bone_indices[i]];
    skinned_pos += bone_mat * vec4<f16>(position, 1.0) * bone_weights[i];
}
This doubles your vertex throughput on mobile, reduces register pressure, and cuts memory bandwidth for bone data in half, giving 30-40% better frame rates on mid-range phones while maintaining visual quality.

For gaming, HDR canvas configuration in WebGPU unlocks visibly brighter highlights and more saturated colors. Here's how to implement it effectively:

Basic HDR Configuration
const canvas = document.querySelector('canvas');
const context = canvas.getContext('webgpu');

// Detect HDR support (optional but recommended)
const screenDetails = await window.getScreenDetails?.();
const supportsHDR = screenDetails?.currentScreen?.label.includes('HDR') || 
                    window.matchMedia('(dynamic-range: high)').matches;

context.configure({
    device: device,
    format: 'bgra8unorm', // or 'rgba16float' for higher precision
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    
    // KEY HDR PARAMETERS
    toneMapping: {
        mode: supportsHDR ? 'extended' : 'standard' // or 'standard' for SDR fallback
    },
    colorSpace: supportsHDR ? 'display-p3' : 'srgb',
    
    // Ensure alpha compositing works correctly
    compositingAlphaMode: 'premultiplied'
});
Tone Mapping Modes in Gaming
"standard" (Default SDR)

toneMapping: { mode: 'standard' }
Clamps all pixel values to [0, 1] range
Colors brighter than #FFFFFF get crushed to pure white
Use for: UI overlays, backward compatibility, or when HDR isn't supported
"extended" (HDR)

toneMapping: { mode: 'extended' }
Preserves values beyond 1.0 (up to ~10,000 nits on capable displays)
Bright pixels actually emit more light on HDR screens
Use for: Sunlight glints, explosions, magical effects, neon signs
Gaming Example: In a racing game, sunlight reflecting off chrome bumpers can output values of 5.0 or higher in your shader. With "extended", those highlights will physically dazzle on HDR monitors instead of looking flat white.

Color Spaces for Gaming
"srgb" (Standard)

~35% of visible colors
Safe default, all monitors support it
Use for: Conservative art styles, UI elements
"display-p3" (Wide Gamut)

~50% of visible colors (45% more than sRGB)
Reds and greens are especially vibrant
Use for: Lush fantasy forests, sci-fi neons, realistic fire
Gaming Example: A cyberpunk game's neon pink signs using #FF1493 in sRGB can become electric magenta in Display P3, making them pop against the night sky.

Complete Gaming Implementation
// 1. Configure for HDR
const hdrConfig = {
    device: device,
    format: 'rgba16float', // 16-bit float for HDR pipeline
    toneMapping: { mode: 'extended' },
    colorSpace: 'display-p3',
    compositingAlphaMode: 'premultiplied'
};

// 2. Graceful fallback
if (!supportsHDR) {
    hdrConfig.toneMapping.mode = 'standard';
    hdrConfig.colorSpace = 'srgb';
    console.log('HDR not supported, falling back to SDR');
}

context.configure(hdrConfig);

// 3. In your shader, output HDR values
// @fragment
fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
    // SDR content stays in [0,1]
    let baseColor = color.rgb;
    
    // HDR highlights can exceed 1.0
    let sunGlare = vec3f(8.0, 7.5, 6.0); // 8x brighter than white!
    let finalColor = baseColor + sunGlare * sun_intensity;
    
    return vec4f(finalColor, 1.0);
}
Key Gaming Benefits
Brighter Highlights: Muzzle flashes, explosions, and magic spells can be 10x brighter than SDR white
Better Visibility: Dark shadow details are preserved while bright areas don't clip
More Vibrant Colors: Laser beams and energy shields use colors impossible in SDR
Cinematic Quality: Match the HDR look of modern consoles/PC games
Performance & Compatibility
No performance cost on HDR displays; minimal overhead on SDR
Always check window.matchMedia('(dynamic-range: high)') before enabling
Provide in-game toggle: "HDR: On/Off" for user preference
Test on both HDR and SDR monitors—colors will look different!
This configuration is the gateway to next-gen visual fidelity in browser-based games.

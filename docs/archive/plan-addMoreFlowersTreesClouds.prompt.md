## Plan: Musical Ecosystem & Atmospheric

### TL;DR
Shift focus from simple population increases to creating a "Vertical Ecosystem" and "Audio-Reactive World." We need to construct the geometry for the Lake and Waterfalls, implement shaders.

### Phase 1: New Geometry & Map Architecture
1.  **Construct "The Melody Lake"**:
    * Create a high-vertex plane (to allow for ripples) at the ground level.
    * *Constraint:* Needs to handle shader inputs for "Note Frequency".
2.  **Vertical Cloud Hierarchy**:
    * **Tier 1 (High/Solid):** Large, dense clouds. **Add Collision Mesh.** These are walkable platforms.
    * **Tier 2 (Mid/Transitional):** Smaller clouds/mist. Can be passed through (non-solid) or act as "elevators."
       * **Logic:** Implement "Chain Reaction Rain" (Cloud A rains on Cloud B, Cloud B rains on Ground).
3.  **Add Bioluminescent Waterfalls**:
    * Create flow meshes connecting Tier 1 Clouds to Tier 2 Mushrooms, and Mushrooms to the Lake.
    * Material: Viscous/Neon style (not transparent water).

### Phase 2: Traversal & Physics (New!)
*Goal: Enable the player to ascend from the ground to the clouds.*
1.  **Mushroom Collision & Climbing**:
    * **Stalks:** Add cylindrical collision meshes. Implement basic "slope walking" or a "climb" key interaction.
    * **Caps:** Make the tops of giant mushrooms "Bouncy."
    * *Mechanic:* Jump height on a mushroom cap = `BaseJump * note strength`. Louder music = Higher jumps.
2.  **Cloud Walking Logic**:
    * Tag Tier 1 Clouds as `isWalkable`.
    * *Visual Cue:* Walkable clouds should look "fluffy" but dense (maybe slightly crystallized edges) so players know they are safe.
3.  **"Vine Ladders"**:
    * Use the increased vine count to create climbable paths hanging from the low clouds down to the mushroom caps.

### Phase 2: Shaders & Visuals
1.  **"Breathing" Mushroom Shader**:
    * Write a Vertex Shader for Giant Mushrooms.
    * **Output:** Vertex Displacement (Expansion/Puff) + Emissive Pulse.
2.  **Atmospheric Sky Updates**:
    * **Lightning:** Add random strobe effect logic to cloud interiors (linked to high-hats or random timer).
    * **No Moon:** Ensure night sky focuses on stars/nebula; remove any directional moon light source, rely on bioluminescence.
3.  **Shadow Zone Logic**:
    * Identify areas *under* the Giant Mushrooms.
    * Force "Always Night" lighting rules there (max bioluminescence on foliage).

### Phase 3: Game Logic & Systems
1.  **Inverse Day/Night Cycle**:
    * Refactor the `UpdateSun()` function.
    * **Formula:** `SunSpeed = BaseConstant / SongBPM`.
    * *Result:* Faster songs = Time moves slower; Slower songs = Time passes quickly.

### Phase 4: Population & Density (Revised from Old Plan)
*Now that we have "Shadow Zones," we increase density specifically in those areas.*

1.  **Foliage Loops (General)**: Increase loop from 400 to **600** (spread across new vertical tiers).
2.  **Flowering Trees**: Increase from 25 to **40**.
3.  **Regular Trees**: Increase from 30 to **50**.
4.  **Giant Mushrooms**: Increase from 20 to **30** (critical for the "Breathing" effect).
5.  **Clouds**: Increase from 15 to **25** (varying sizes: Small/Dense vs Large/Wispy).
6.  **Shadow Zone Specifics**:
    * **Glowing Flowers**: Increase from 20 to **30** (Place mostly under mushrooms).
    * **Floating Orbs**: Increase from 15 to **25** (Place near Waterfalls).
    * **Vines**: Increase from 10 to **15** (Draping off the new higher cloud tiers).
    
* **Spawn:** Attach small sphere clusters to `Regular Trees` and `Flowering Trees`.
    * **Visual:** Different colors for different trees (Cyan Berries, Magenta Pears).
    * **Audio React:** They act like "Christmas lights," blinking or changing brightness with the **Melody** track.
    * **Physics:** If a bass drop is "Too Heavy" (max threshold), some ripe fruits fall to the ground lpanting new trees.

### Further Considerations
1.  **Optimization:** The "Breathing" effect must be GPU-side (Shader) to keep performance high with 30+ giant mushrooms.
2.  **Color Palette:** Define the specific "Neon" palette for the waterfall/glows (Cyan/Magenta vs. Natural Green).
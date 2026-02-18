# Gerstner Waves + Foam Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ocean's sine-wave vertex shader with Gerstner (trochoidal) waves for sharper crests, and add whitecap + shoreline foam in the fragment shader.

**Architecture:** All changes are inside the single `waterMat` ShaderMaterial in `game.js`. The vertex shader gains Gerstner horizontal displacement and analytic normals + a `vFoamMask` varying. The fragment shader gains two foam layers (whitecap + shoreline). The JS `waves` array and `getWaveHeight()` get updated amplitudes. No new files, no new geometry.

**Tech Stack:** Three.js ShaderMaterial (GLSL ES 3.0 / WebGL2), plain JavaScript, Express dev server (`npm run dev` → http://localhost:3000).

---

### Task 1: Update JS wave parameters and `getWaveHeight()`

**Files:**
- Modify: `game.js:240-254`

**Context:**
The `waves` array drives the CPU-side physics (buoyancy, boat bobbing). The shader will use matching parameters. Update the amplitudes to the larger values and add `steep` (Q) and `k` fields for documentation — JS physics only needs `amp/freq/speed/phase/dirX/dirY`.

**Step 1: Replace the `waves` array**

Find this block (lines 240–245):
```js
// Wave parameters
const waves = [
  { dirX: 1.0, dirY: 0.3,  amp: 3.5, freq: 0.008, speed: 1.2,  phase: 0 },     // primary swell
  { dirX: 0.7, dirY: 0.7,  amp: 2.0, freq: 0.012, speed: 1.8,  phase: 2.0 },   // cross-wave
  { dirX: 0.2, dirY: 1.0,  amp: 1.5, freq: 0.02,  speed: 2.5,  phase: 4.5 },   // ripple
  { dirX: -0.4, dirY: 0.9, amp: 1.0, freq: 0.035, speed: 3.0,  phase: 1.3 },   // chop
];
```

Replace with:
```js
// Wave parameters — must match vertex shader Gerstner constants
const waves = [
  { dirX: 1.0, dirY: 0.3,  amp: 5.0, freq: 0.008, speed: 1.2,  phase: 0.0 },   // primary swell
  { dirX: 0.7, dirY: 0.7,  amp: 3.0, freq: 0.012, speed: 1.8,  phase: 2.0 },   // cross-wave
  { dirX: 0.2, dirY: 1.0,  amp: 2.0, freq: 0.020, speed: 2.5,  phase: 4.5 },   // ripple
  { dirX:-0.4, dirY: 0.9,  amp: 1.5, freq: 0.035, speed: 3.0,  phase: 1.3 },   // chop
];
```

**Step 2: Verify the game still loads**

Run: `npm run dev`
Open http://localhost:3000, check browser console — no JS errors. The ocean should still render (may look the same or slightly larger waves since physics uses `getWaveHeight()` which automatically uses the new amplitudes).

**Step 3: Commit**

```bash
git add game.js
git commit -m "feat: increase wave amplitudes for larger ocean swells"
```

---

### Task 2: Replace vertex shader with Gerstner waves

**Files:**
- Modify: `game.js:158-188` (vertexShader string)

**Context:**
Gerstner waves add *horizontal* displacement (vertices bunch toward crests) in addition to vertical lift. This creates the characteristic sharp-crest / flat-trough ocean shape. We also compute the surface normal analytically from partial derivatives instead of finite differences, and pass a `vFoamMask` varying to the fragment shader (the horizontal convergence factor, which peaks at wave crests).

The water plane's local space: X and Y are the two horizontal axes; Z is the "up" axis (becomes world Y after `rotation.x = -Math.PI / 2`). Directions in the shader are 2D vectors in the local XY plane.

**Step 1: Replace the vertexShader string**

Find the entire `vertexShader: \`` block (lines 158–189) and replace it with:

```js
  vertexShader: `
    uniform float uTime;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vFoamMask;

    // Gerstner wave: returns (displaceX, displaceY, displaceZ[height])
    vec3 gerstner(vec2 dir, float amp, float k, float omega, float phase, float steep, vec2 p, float t) {
      float theta = dot(dir, p) * k + omega * t + phase;
      float s = sin(theta);
      float c = cos(theta);
      return vec3(steep * amp * dir.x * c,
                  steep * amp * dir.y * c,
                  amp * s);
    }

    void main() {
      vec2 p0 = position.xy;  // rest position in local XY plane

      // Wave components: (dir, amp, k=freq, omega=speed, phase, steep=Q)
      vec3 D = vec3(0.0);
      D += gerstner(normalize(vec2( 1.0,  0.3)), 5.0, 0.008, 1.2, 0.0,  0.60, p0, uTime);
      D += gerstner(normalize(vec2( 0.7,  0.7)), 3.0, 0.012, 1.8, 2.0,  0.50, p0, uTime);
      D += gerstner(normalize(vec2( 0.2,  1.0)), 2.0, 0.020, 2.5, 4.5,  0.35, p0, uTime);
      D += gerstner(normalize(vec2(-0.4,  0.9)), 1.5, 0.035, 3.0, 1.3,  0.20, p0, uTime);

      vec2 pos = p0 + D.xy;   // horizontally displaced position
      float h  = D.z;         // vertical displacement

      // Analytic surface normal for summed Gerstner (GPU Gems 1 ch.1 formula)
      // N.x = -sum(k * A * d.x * cos(theta))
      // N.y = -sum(k * A * d.y * cos(theta))
      // N.z =  1 - sum(Q * k * A * sin(theta))
      float nx = 0.0, ny = 0.0, nz_term = 0.0;
      {
        vec2 dir = normalize(vec2( 1.0,  0.3)); float k=0.008, A=5.0, Q=0.60, om=1.2, ph=0.0;
        float theta = dot(dir, p0)*k + om*uTime + ph;
        float s=sin(theta), c=cos(theta);
        nx -= k*A*dir.x*c;  ny -= k*A*dir.y*c;  nz_term += Q*k*A*s;
      }
      {
        vec2 dir = normalize(vec2( 0.7,  0.7)); float k=0.012, A=3.0, Q=0.50, om=1.8, ph=2.0;
        float theta = dot(dir, p0)*k + om*uTime + ph;
        float s=sin(theta), c=cos(theta);
        nx -= k*A*dir.x*c;  ny -= k*A*dir.y*c;  nz_term += Q*k*A*s;
      }
      {
        vec2 dir = normalize(vec2( 0.2,  1.0)); float k=0.020, A=2.0, Q=0.35, om=2.5, ph=4.5;
        float theta = dot(dir, p0)*k + om*uTime + ph;
        float s=sin(theta), c=cos(theta);
        nx -= k*A*dir.x*c;  ny -= k*A*dir.y*c;  nz_term += Q*k*A*s;
      }
      {
        vec2 dir = normalize(vec2(-0.4,  0.9)); float k=0.035, A=1.5, Q=0.20, om=3.0, ph=1.3;
        float theta = dot(dir, p0)*k + om*uTime + ph;
        float s=sin(theta), c=cos(theta);
        nx -= k*A*dir.x*c;  ny -= k*A*dir.y*c;  nz_term += Q*k*A*s;
      }
      vec3 localNorm = normalize(vec3(nx, ny, 1.0 - nz_term));

      // vFoamMask: nz_term peaks at steep crests — used for whitecap foam
      vFoamMask = clamp(nz_term * 1.5, 0.0, 1.0);

      vWorldNormal = normalize(mat3(modelMatrix) * localNorm);
      vec4 worldPos4 = modelMatrix * vec4(pos.x, pos.y, h, 1.0);
      vWorldPos = worldPos4.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos4;
    }
  `,
```

**Step 2: Add `vFoamMask` declaration to the fragment shader**

The fragment shader needs the new varying declared. Find this block at the top of `fragmentShader`:
```glsl
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
```
Replace with:
```glsl
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vFoamMask;
```

**Step 3: Visual check**

Run `npm run dev`, open http://localhost:3000. The ocean should now show clearly peaked wave crests with flat troughs. Look for the characteristic "bunching" of geometry at crests. The waves should be noticeably larger than before. Console should have no WebGL errors.

If the water disappears or turns black: check the browser console for shader compile errors (Three.js logs them). Common issue: `varying float vFoamMask` is declared in vertex but the fragment shader still needs it declared there too — verify Task 2 Step 2 was done.

**Step 4: Commit**

```bash
git add game.js
git commit -m "feat: replace sine waves with Gerstner trochoidal waves"
```

---

### Task 3: Add whitecap foam in the fragment shader

**Files:**
- Modify: `game.js:190-229` (fragmentShader string)

**Context:**
`vFoamMask` is high at steep crest regions. We blend a creamy white foam color over the water color there. The foam should soften the too-sharp look of raw Gerstner peaks and give the "breaking wave" appearance.

**Step 1: Add foam blend after the specular line**

In the fragment shader, find this block:
```glsl
      // Specular sun glint
      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(N, H), 0.0), 256.0);
      color += vec3(1.0, 0.97, 0.88) * spec * 1.2;

      float alpha = mix(0.60, 0.90, fresnel);
      gl_FragColor = vec4(color, alpha);
```

Replace with:
```glsl
      // Specular sun glint
      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(N, H), 0.0), 256.0);
      color += vec3(1.0, 0.97, 0.88) * spec * 1.2;

      // Whitecap foam at steep crests
      float whitecap = smoothstep(0.45, 0.70, vFoamMask);
      color = mix(color, vec3(1.0, 0.98, 0.95), whitecap * 0.80);

      float alpha = mix(0.60, 0.90, fresnel);
      alpha = max(alpha, whitecap * 0.95);   // foam is more opaque
      gl_FragColor = vec4(color, alpha);
```

**Step 2: Visual check**

Reload http://localhost:3000. Wave crests should now have creamy white streaks at their peaks. The foam should appear and disappear as wave crests pass. If foam covers too much of the surface, raise the lower threshold of `smoothstep(0.45, 0.70, ...)` — try `0.55, 0.75`. If too little foam, lower it.

**Step 3: Commit**

```bash
git add game.js
git commit -m "feat: add whitecap foam at Gerstner wave crests"
```

---

### Task 4: Add shoreline foam in the fragment shader

**Files:**
- Modify: `game.js` (fragmentShader string, same location as Task 3)

**Context:**
Shoreline foam simulates wave lapping at the waterline. It appears where the water surface is near `WATER_LEVEL` (-40). A pulsing sine drives the lapping motion. This is a pure fragment shader effect — no geometry change needed.

**Step 1: Add shoreline foam after the whitecap block**

Find the whitecap block added in Task 3:
```glsl
      // Whitecap foam at steep crests
      float whitecap = smoothstep(0.45, 0.70, vFoamMask);
      color = mix(color, vec3(1.0, 0.98, 0.95), whitecap * 0.80);

      float alpha = mix(0.60, 0.90, fresnel);
      alpha = max(alpha, whitecap * 0.95);   // foam is more opaque
      gl_FragColor = vec4(color, alpha);
```

Replace with:
```glsl
      // Whitecap foam at steep crests
      float whitecap = smoothstep(0.45, 0.70, vFoamMask);
      color = mix(color, vec3(1.0, 0.98, 0.95), whitecap * 0.80);

      // Shoreline foam: lapping band near WATER_LEVEL (-40)
      // shoreDepth: 0 right at waterline, 1 eight units above it
      float shoreDepth = clamp((vWorldPos.y - (-40.0)) / 8.0, 0.0, 1.0);
      float shorePulse = sin(vWorldPos.x * 0.04 + vWorldPos.z * 0.03 - uTime * 2.2) * 0.5 + 0.5;
      float shoreFoam  = (1.0 - smoothstep(0.0, 1.0, shoreDepth)) * shorePulse * 0.65;
      color = mix(color, vec3(1.0, 1.0, 1.0), shoreFoam);

      float alpha = mix(0.60, 0.90, fresnel);
      alpha = max(alpha, whitecap * 0.95);
      alpha = max(alpha, shoreFoam * 0.9);
      gl_FragColor = vec4(color, alpha);
```

**Step 2: Visual check**

Reload http://localhost:3000. Walk or fly to the shore. You should see an animated white foam band at the waterline where land meets water. The foam should pulse/lap rhythmically. If the band is too wide, increase the divisor in `shoreDepth` (e.g., `/12.0`). If it's too narrow, decrease it (e.g., `/5.0`).

**Step 3: Commit**

```bash
git add game.js
git commit -m "feat: add animated shoreline foam at waterline"
```

---

### Task 5: Tune and final verification

**Files:**
- Modify: `game.js` (shader constants, wave parameters)

**Context:**
Now that all three visual layers (Gerstner shape, whitecaps, shoreline) are in place, do a pass to make sure everything looks good together. Check: (1) waves aren't so large they clip through terrain/boats abnormally, (2) foam isn't too aggressive, (3) boats and player still bob correctly.

**Step 1: Check boat bobbing**

Open the game. Fly near the boats on the water. They should bob naturally on the Gerstner waves. If boats appear to float too high or clip into waves, it's because JS `getWaveHeight()` (which only uses the vertical `A * sin(...)` component) is slightly off from the full Gerstner shape — this is acceptable and expected. No code change needed unless boats are clearly broken.

**Step 2: Check player swimming**

Walk into the ocean. The player should bob with the waves. If the player sinks below the wave surface consistently, the `WATER_LEVEL + wh - 2` offset in `updatePlayer()` may need adjustment (search for `waterSurface = WATER_LEVEL + wh - 2` and change `-2` to a smaller value).

**Step 3: Final visual sweep**

- Look at the water from above (fly high): large swells should be clearly visible
- Look at the water from the shore: crests should peak and foam should be at the top
- Look at the waterline: shoreline foam should be present
- Check the horizon: no visual artifacts (z-fighting, black patches)

**Step 4: Final commit**

```bash
git add game.js
git commit -m "feat: Gerstner waves with whitecap and shoreline foam"
```

---

## Summary of Changes

| Location | Change |
|----------|--------|
| `game.js:240-245` | Wave amplitudes increased (3.5→5.0, 2.0→3.0, 1.5→2.0, 1.0→1.5) |
| `game.js` vertexShader | 4 sine waves → 4 Gerstner waves with horizontal displacement + analytic normals + `vFoamMask` |
| `game.js` fragmentShader | Added `vFoamMask` varying + whitecap foam + shoreline foam |

## Key Numbers to Tweak if Needed

| Parameter | Location | Effect |
|-----------|----------|--------|
| `smoothstep(0.45, 0.70, vFoamMask)` | fragmentShader | More/less whitecap foam |
| `shorePulse * 0.65` | fragmentShader | Shoreline foam intensity |
| `/ 8.0` in shoreDepth | fragmentShader | Width of shoreline foam band |
| `amp: 5.0` etc | waves array | Wave height in physics |
| `steep: 0.60` etc | vertexShader | How sharp/peaked the crests are (0=sine, 1=maximum Gerstner) |

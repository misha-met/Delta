import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ───────────────────────────────────────────────────────────────────────────
// Procedural textures. Cheap to generate, avoid shipping binary assets, and
// tile cleanly because we control the pixel data directly.
// ───────────────────────────────────────────────────────────────────────────

// Real asphalt reads as a uniform dark charcoal with visible aggregate (tiny
// lighter chips embedded in bitumen) and a subtly darker racing line where
// tyres have polished the seal coat. We build that in three passes:
//  (a) near-uniform dark base with a faint low-frequency luminance variation
//      so tiling doesn't broadcast a grid pattern,
//  (b) aggregate specks of varying size/brightness — most tiny, a few larger,
//      pulling the reader's eye toward "stone in tar" rather than "noise",
//  (c) a soft darker band down the centre (UV-Y), suggesting the polished
//      racing line — keeps scale cues when the camera flies low.
// Real F1 asphalt reads as near-black charcoal with visible aggregate chips.
// Tuning notes:
//  - Base `#07070b`: under ACES tonemap + bright sun + IBL, anything lighter
//    than ~#10 lifts to a medium grey that's indistinguishable from concrete.
//    The base needs to be *very* dark so the lit surface still reads as
//    asphalt rather than paving.
//  - Aggregate count kept modest (600) so individual chips read at close
//    range but don't average into a mid-tone when the mipmap collapses at
//    distance — the old tuning (1800) washed the track out to grey.
//  - Specks themselves are dim too (luminance 22–46) — real aggregate isn't
//    white rocks, it's slightly-lighter stones embedded in bitumen.
function makeAsphaltTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // (a) Base — dark grey asphalt, kept bright enough to survive fog +
  // post-processing compression at distance.
  ctx.fillStyle = "#2a2f3a";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  // Tiny luminance jitter so the base isn't a dead flat colour.
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  // (b) Aggregate — scattered dim chips. Mostly sub-pixel.
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() < 0.9 ? (0.3 + Math.random() * 0.7) : (1.0 + Math.random() * 1.3);
    const l = 58 + Math.random() * 42;
    ctx.fillStyle = `rgba(${l},${l},${l + 2},${0.45 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // (c) Racing line wear + edge marbles.
  // Stronger center groove plus dirty off-line shoulders near UV edges.
  const rl = ctx.createLinearGradient(0, 0, size, 0);
  rl.addColorStop(0.00, "rgba(0,0,0,0.00)");
  rl.addColorStop(0.05, "rgba(0,0,0,0.17)");
  rl.addColorStop(0.12, "rgba(0,0,0,0.08)");
  rl.addColorStop(0.43, "rgba(0,0,0,0.18)");
  rl.addColorStop(0.50, "rgba(0,0,0,0.28)");
  rl.addColorStop(0.57, "rgba(0,0,0,0.18)");
  rl.addColorStop(0.88, "rgba(0,0,0,0.08)");
  rl.addColorStop(0.95, "rgba(0,0,0,0.17)");
  rl.addColorStop(1.00, "rgba(0,0,0,0.00)");
  ctx.fillStyle = rl;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRunoffAsphaltTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#333640";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.4 + Math.random() * 1.0;
    const l = 64 + Math.random() * 34;
    ctx.fillStyle = `rgba(${l},${l},${l + 2},${0.32 + Math.random() * 0.24})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const groove = ctx.createLinearGradient(0, 0, size, 0);
  groove.addColorStop(0.00, "rgba(0,0,0,0.00)");
  groove.addColorStop(0.07, "rgba(0,0,0,0.12)");
  groove.addColorStop(0.45, "rgba(0,0,0,0.07)");
  groove.addColorStop(0.50, "rgba(0,0,0,0.14)");
  groove.addColorStop(0.55, "rgba(0,0,0,0.07)");
  groove.addColorStop(0.93, "rgba(0,0,0,0.12)");
  groove.addColorStop(1.00, "rgba(0,0,0,0.00)");
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#5b874b";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] = Math.max(0, Math.min(255, d[i] + n * 0.4 + 5));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.7 + 8));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.35 + 3));
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 680; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 0.7 + Math.random() * 0.9;
    const h = 2.2 + Math.random() * 3.8;
    ctx.fillStyle = `rgba(72,130,62,${0.12 + Math.random() * 0.16})`;
    ctx.fillRect(x, y, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGravelTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b79d6d";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.9));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.65));
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.45 + Math.random() * 1.0;
    const shade = 130 + Math.random() * 45;
    ctx.fillStyle = `rgba(${shade},${shade - 10},${shade - 34},${0.25 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArmcoTexture() {
  const w = 128;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f4f6";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d61d1d";
  ctx.fillRect(0, 22, w, 18);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Procedural normal map for the asphalt — gives the surface real bump under
// directional lighting and IBL reflection. Built by generating a height field
// of low-frequency noise, blurring it, then computing per-pixel normals via
// central differences (cheap Sobel-equivalent).
function makeAsphaltNormalMap() {
  const size = 256;
  const heights = new Float32Array(size * size);
  // Layer two octaves of value noise for that "coarse with fine grain" look.
  for (let i = 0; i < heights.length; i++) heights[i] = Math.random();
  // Box-blur once to soften single-pixel spikes (which would flicker badly
  // with view distance).
  const blurred = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = (x + dx + size) % size;
          const yy = (y + dy + size) % size;
          sum += heights[yy * size + xx];
          count++;
        }
      }
      blurred[y * size + x] = sum / count;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  // Strength tuned so reflections shimmer without making the surface look
  // like coarse gravel.
  const STRENGTH = 0.55;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xL = (x - 1 + size) % size, xR = (x + 1) % size;
      const yU = (y - 1 + size) % size, yD = (y + 1) % size;
      const dx = (blurred[y * size + xR] - blurred[y * size + xL]) * STRENGTH;
      const dy = (blurred[yD * size + x] - blurred[yU * size + x]) * STRENGTH;
      // Tangent-space normal: pack into (R, G, B) with Z dominant (out of
      // surface). Length-normalise so the map is valid.
      let nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      d[idx + 0] = (nx * 0.5 + 0.5) * 255;
      d[idx + 1] = (ny * 0.5 + 0.5) * 255;
      d[idx + 2] = (nz * 0.5 + 0.5) * 255;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Neutral-grey noise texture for paved surroundings (ground, runoff). A
// midtone (~128) base lets the material's `color` preset actually read
// through — a dark base would be multiplied with the preset colour and the
// surface would collapse to near-black, which used to make the ground
// indistinguishable from the asphalt track. Low-amplitude noise keeps the
// surface from tiling into a visible weave at grazing angles.
function makeConcreteTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a8a90";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  // A handful of darker flecks — reads as grit without being structured.
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(40,40,48,${0.15 + Math.random() * 0.2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeKerbStripeTexture() {
  const w = 32;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const band = 8;
  for (let y = 0; y < h; y += band) {
    const isRed = ((y / band) | 0) % 2 === 0;
    ctx.fillStyle = isRed ? "#ff3a24" : "#f2f3f6";
    ctx.fillRect(0, y, w, band);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Module-scope texture cache. The procedural textures are deterministic and
// circuit-independent, so regenerating the canvas pixel data on every scene
// rebuild (geoVersion/qualityVersion/todKey change) was wasted work. We cache
// the produced THREE.CanvasTexture and return a lightweight Texture wrapping
// the same `image` (canvas) for each scene — that lets each consumer set its
// own `repeat` / `wrapS` / `colorSpace` without invalidating the GPU upload
// on the shared instance.
const TEX_CACHE = {
  asphalt: null, asphaltNormal: null, runoff: null, grass: null,
  gravel: null, armco: null, concrete: null, kerb: null,
};
function cachedTex(key, factory) {
  if (!TEX_CACHE[key]) TEX_CACHE[key] = factory();
  // Wrap the cached canvas in a fresh Texture so repeat/wrap can be tuned
  // per-mesh. The image data is shared so the GPU upload (the expensive part)
  // is reused across all scenes built since module load.
  const src = TEX_CACHE[key];
  const tex = new THREE.CanvasTexture(src.image);
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.anisotropy = src.anisotropy;
  tex.colorSpace = src.colorSpace;
  return tex;
}

// Module-scope PMREM environment cache. RoomEnvironment is a fixed neutral
// studio — keyed only on the renderer's existence, not on circuit/quality.
let _pmremEnv = null;
let _pmremRendererRef = null;
function getRoomEnvironment(renderer) {
  if (_pmremEnv && _pmremRendererRef === renderer) return _pmremEnv;
  if (_pmremEnv) _pmremEnv.dispose();
  const pmrem = new THREE.PMREMGenerator(renderer);
  _pmremEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  _pmremRendererRef = renderer;
  pmrem.dispose();
  return _pmremEnv;
}

// Procedural grid shader for the abstract reference plane below the track.
// The plane geometry covers `planeSize` metres and carries 0..1 UVs, so we
// reconstruct world-space metres in the shader as `uv * planeSize`. Lines are
// drawn by anti-aliased thresholds on `fract(coord / cell)`. A second, brighter
// line every `accentEvery` cells reads as a major gridline. Distance fade
// alpha-blends the whole grid into the void so the plane never shows a hard
// edge at any zoom — the camera's view of the world feels infinite without
// the grid actually being infinite.
function buildGridShaderMaterial({
  planeSize,
  cameraPos,
  color = 0x3c4a66,
  accentColor = 0x6c8bcc,
  cellSize = 30,
  accentEvery = 5,
  fadeStart = 0.18,
  fadeEnd = 0.85,
  baseAlpha = 0.55,
}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uPlaneSize: { value: planeSize },
        uCameraPos: { value: cameraPos.clone() },
        uColor: { value: new THREE.Color(color) },
        uAccentColor: { value: new THREE.Color(accentColor) },
        uCellSize: { value: cellSize },
        uAccentEvery: { value: accentEvery },
        uFadeStart: { value: fadeStart },
        uFadeEnd: { value: fadeEnd },
        uBaseAlpha: { value: baseAlpha },
      },
    ]),
    vertexShader: `
      varying vec3 vWorldPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform float uPlaneSize;
      uniform vec3 uCameraPos;
      uniform vec3 uColor;
      uniform vec3 uAccentColor;
      uniform float uCellSize;
      uniform float uAccentEvery;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      uniform float uBaseAlpha;
      #include <fog_pars_fragment>
      // Anti-aliased line via |x - 0.5| in cell coords, scaled by fwidth so
      // line thickness stays roughly constant in screen pixels regardless of
      // grazing-angle distortion.
      float gridLine(float coord, float widthPx) {
        float w = fwidth(coord) * widthPx;
        float d = abs(fract(coord) - 0.5);
        return 1.0 - smoothstep(0.5 - w, 0.5, d);
      }
      void main() {
        vec2 p = vWorldPos.xz;
        // Minor cells at every uCellSize metres.
        vec2 minorC = p / uCellSize;
        float minor = max(gridLine(minorC.x, 0.6), gridLine(minorC.y, 0.6));
        // Major cells every uAccentEvery * uCellSize metres.
        vec2 majorC = p / (uCellSize * uAccentEvery);
        float major = max(gridLine(majorC.x, 0.9), gridLine(majorC.y, 0.9));
        vec3 col = mix(uColor, uAccentColor, major);
        float lineAlpha = max(minor * 0.55, major);
        // Distance fade — linear in radius / planeSize half. Fully transparent
        // past uFadeEnd so the plane edge never shows.
        float dist = length(p.xy - uCameraPos.xz);
        float halfSize = uPlaneSize * 0.5;
        float r = dist / halfSize;
        float radial = 1.0 - smoothstep(uFadeStart, uFadeEnd, r);
        float a = lineAlpha * uBaseAlpha * radial;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }
    `,
  });
}

function clearRoomEnvironmentCache(renderer = null) {
  if (!_pmremEnv) return;
  if (renderer && _pmremRendererRef !== renderer) return;
  _pmremEnv.dispose();
  _pmremEnv = null;
  _pmremRendererRef = null;
}

export {
  makeAsphaltTexture,
  makeRunoffAsphaltTexture,
  makeGrassTexture,
  makeGravelTexture,
  makeArmcoTexture,
  makeAsphaltNormalMap,
  makeConcreteTexture,
  makeKerbStripeTexture,
  cachedTex,
  buildGridShaderMaterial,
  getRoomEnvironment,
  clearRoomEnvironmentCache,
};

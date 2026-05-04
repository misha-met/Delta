import * as THREE from "three";

// ───────────────────────────────────────────────────────────────────────────
// Atmosphere — void backdrop, grid plane material, time-of-day mood, rain.
// ───────────────────────────────────────────────────────────────────────────
//
// The 3D track view is intentionally abstract: tracks float through a dark
// vignetted void over a grid reference plane, like the SVG overhead view
// promoted into 3D. There is no terrain, no horizon, no sky — only fog, a
// gradient backdrop, the grid, the skirt, and the ribbon itself. Time-of-day
// presets still drive overall mood (cool day blue, warm dusk amber, deep
// night) but only via fog tone, ambient/key light colour and post-fx tuning.

// Time-of-day presets. F1 has day, twilight and night races, so we key
// fog colour, key/fill light colour and post-fx mood off the circuit name.
// Unknown circuits default to "day". `void.center/edge` define the gradient
// backdrop the camera sees through the fog: `center` is the colour roughly
// at eye-level looking outward (where the camera frames the action), `edge`
// is the colour at the dome's poles. With FogExp2 layered on top, only a
// soft circular wash of the gradient ever shows through.
const TOD_PRESETS = {
  day: {
    sky: {
      zenith: 0x2e6db5,
      horizon: 0xb8d4e8,
      ground: 0x7a8090,
      sunColor: 0xffe8b0,
      sunDisc: 2.2,
      hazeTint: 1.0,
      starStrength: 0.0,
      horizonGlow: 0xffd080,
      horizonGlowStrength: 0.28,
      cloudStrength: 0.55,
    },
    void: { center: 0x1a2d4a, edge: 0x0d1a2e },
    sun: { dir: [0.55, 0.65, -0.45], color: 0xfff0cc, intensity: 1.4 },
    // Cool sky-tinted fill from the opposite-camera side; lifts shadows so
    // car flanks read instead of going pure black under hemi alone.
    fill: { dir: [-0.6, 0.35, 0.5], color: 0x9ec4ff, intensity: 0.45 },
    // Cool back-rim from behind/above to separate cars from track surface.
    rim:  { dir: [-0.3, 0.55, 0.85], color: 0xcfe2ff, intensity: 0.55 },
    hemi: { sky: 0xbcd4ff, ground: 0x121620, intensity: 0.55 },
    fog: { color: 0x1a2d4a, fadeStart: 0.22, fadeEnd: 1.0 },
    runoff: { color: 0x3a3a42 },
    trackTint: 0xf2f3fa,
    grid: { color: 0x2a3650, accentColor: 0x5a7ec0, cellSize: 30, accentEvery: 5 },
    exposure: 0.98,
    bloom: { strength: 0.24, threshold: 0.95, radius: 0.55 },
    vignette: { base: 0.34, tint: 0x05070d },
    kerb: { emissive: 0x000000, emissiveIntensity: 0.0 },
    starStrength: 0.0,
  },
  dusk: {
    sky: {
      zenith: 0x121933,
      horizon: 0x703845,
      ground: 0x100f18,
      sunColor: 0xffb889,
      sunDisc: 3.4,
      hazeTint: 1.45,
      starStrength: 0.22,
      horizonGlow: 0xff9a66,
      horizonGlowStrength: 0.55,
      cloudStrength: 0.0,
    },
    void: { center: 0x130b1e, edge: 0x050309 },
    sun: { dir: [0.45, 0.55, -0.7], color: 0xffc194, intensity: 1.2 },
    // Cool magenta-blue fill against the warm low sun for classic dusk split.
    fill: { dir: [-0.5, 0.4, 0.65], color: 0x6e7aa8, intensity: 0.4 },
    // Warm rim picks up the horizon glow on the trailing edge of cars.
    rim:  { dir: [-0.6, 0.45, -0.5], color: 0xffa070, intensity: 0.7 },
    hemi: { sky: 0xa39abb, ground: 0x14101a, intensity: 0.35 },
    fog: { color: 0x100b18, fadeStart: 0.20, fadeEnd: 0.95 },
    runoff: { color: 0x2a2a31 },
    trackTint: 0xe8eaf2,
    grid: { color: 0x332542, accentColor: 0xb87860, cellSize: 30, accentEvery: 5 },
    exposure: 1.0,
    bloom: { strength: 0.32, threshold: 0.88, radius: 0.55 },
    vignette: { base: 0.42, tint: 0x07080e },
    kerb: { emissive: 0x0a0000, emissiveIntensity: 0.05 },
    starStrength: 0.25,
  },
  night: {
    sky: {
      zenith: 0x04060c,
      horizon: 0x14182a,
      ground: 0x04050a,
      sunColor: 0xffd9a8,
      sunDisc: 0.0,
      hazeTint: 1.0,
      starStrength: 1.0,
      horizonGlow: 0xffb070,
      horizonGlowStrength: 0.4,
      cloudStrength: 0.0,
    },
    void: { center: 0x050810, edge: 0x010207 },
    sun: { dir: [0.25, 0.95, -0.15], color: 0xe8ecff, intensity: 0.9 },
    // Cyan stadium-floodlight fill from the side, mimics secondary pylons.
    fill: { dir: [-0.7, 0.5, 0.35], color: 0x6e8cb4, intensity: 0.55 },
    // Warm sodium-vapor rim from behind — sells the "lit night race" feel.
    rim:  { dir: [-0.4, 0.6, -0.7], color: 0xffd0a0, intensity: 0.5 },
    hemi: { sky: 0x324164, ground: 0x070a12, intensity: 0.32 },
    fog: { color: 0x05060c, fadeStart: 0.20, fadeEnd: 0.95 },
    runoff: { color: 0x1f1f25 },
    trackTint: 0xd8dbe6,
    grid: { color: 0x161e38, accentColor: 0x3a5aa8, cellSize: 30, accentEvery: 5 },
    exposure: 1.05,
    bloom: { strength: 0.22, threshold: 0.9, radius: 0.5 },
    vignette: { base: 0.42, tint: 0x02030a },
    kerb: { emissive: 0x140000, emissiveIntensity: 0.12 },
    starStrength: 1.0,
  },
};

// Weather overlay — mutates the active TOD preset in-place so that "night +
// rain" doesn't need its own preset. Applied once after TOD lookup.
const WET_OVERLAY = {
  fogDensityMult: 1.18,
  fogTint: 0x222a36,
  runoffDarken: 0.76,
  trackDarken: 0.74,
  bloomStrengthAdd: 0.1,
  bloomThresholdDrop: 0.08,
};

function mulHex(hex, k) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * k)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

function mulHexLumaFloor(hex, k, minLuma = 0) {
  let r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * k)));
  let g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * k)));
  let b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * k)));
  if (minLuma > 0) {
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma <= 1e-3) {
      r = g = b = Math.round(Math.max(0, Math.min(255, minLuma)));
    } else if (luma < minLuma) {
      const s = minLuma / luma;
      r = Math.max(0, Math.min(255, Math.round(r * s)));
      g = Math.max(0, Math.min(255, Math.round(g * s)));
      b = Math.max(0, Math.min(255, Math.round(b * s)));
    }
  }
  return (r << 16) | (g << 8) | b;
}

function detectTimeOfDay(circuitName) {
  const name = (circuitName || "").toLowerCase();
  if (!name) return "day";
  // Known night races (lit by stadium lighting).
  if (/singapore|marina bay|jeddah|saudi|bahrain|sakhir|qatar|lusail|las vegas/.test(name)) {
    return "night";
  }
  // Twilight / late-afternoon races.
  if (/abu dhabi|yas marina/.test(name)) {
    return "dusk";
  }
  return "day";
}

// Void backdrop. A large inverted sphere with a radial-from-camera gradient
// shader, mimicking the SVG view's "darker at edges" vignette but in 3D.
// Unlike a sky dome it has no horizon line, no sun, and no clouds — exponential
// fog in the scene blends everything past mid-range into the dome's edge tone
// so the world feels open without committing to a sky. Render order is set
// so it draws first, behind everything else.
function buildVoidBackdrop(radius, preset) {
  const geom = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uCenter: { value: new THREE.Color(preset.void.center) },
      uEdge: { value: new THREE.Color(preset.void.edge) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uCenter;
      uniform vec3 uEdge;
      void main() {
        // Soft polar gradient: brightest near horizon (|y| ~ 0), darkest at
        // the zenith and nadir. Looks like infinite depth without a horizon.
        float t = abs(vDir.y);
        // Steeper curve: horizon band stays dark, poles snap to edge tone fast.
        float k = smoothstep(0.0, 0.55, t);
        k = k * k;
        gl_FragColor = vec4(mix(uCenter, uEdge, k), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function buildSkyDome(radius, sunDir, preset) {
  const geom = new THREE.SphereGeometry(radius, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(preset.sky.zenith) },
      uHorizon: { value: new THREE.Color(preset.sky.horizon) },
      uGround: { value: new THREE.Color(preset.sky.ground) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(preset.sky.sunColor) },
      uSunSize: { value: 0.9985 },
      uSunDisc: { value: preset.sky.sunDisc },
      uHazeTint: { value: preset.sky.hazeTint },
      uHorizonGlow: { value: new THREE.Color(preset.sky.horizonGlow || 0x000000) },
      uHorizonGlowStrength: { value: preset.sky.horizonGlowStrength || 0.0 },
      uCloudStrength: { value: preset.sky.cloudStrength ?? 0.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunSize;
      uniform float uSunDisc;
      uniform float uHazeTint;
      uniform vec3 uHorizonGlow;
      uniform float uHorizonGlowStrength;
      uniform float uCloudStrength;

      float hash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 43.21);
        return fract(p.x * p.y);
      }
      float smoothNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1,0)), u.x),
          mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x),
          u.y
        );
      }
      float clouds(vec3 d) {
        if (d.y < 0.04) return 0.0;
        vec2 uv = d.xz / (d.y + 0.15) * 1.4;
        float n = smoothNoise(uv * 2.2) * 0.62
                + smoothNoise(uv * 4.8) * 0.28
                + smoothNoise(uv * 9.5) * 0.10;
        float c = smoothstep(0.48, 0.72, n);
        float horizonFade = smoothstep(0.04, 0.20, d.y);
        return c * horizonFade;
      }

      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y, -1.0, 1.0);
        vec3 sky = (t > 0.0)
          ? mix(uHorizon, uZenith, smoothstep(0.0, 0.50, t))
          : mix(uHorizon, uGround, smoothstep(0.0, -0.25, t));
        float haze = exp(-abs(t) * 5.5);
        sky = mix(sky, uHorizon * uHazeTint, haze * 0.28);
        float glow = pow(max(0.0, 1.0 - abs(t)), 8.0);
        sky += uHorizonGlow * (glow * uHorizonGlowStrength);
        if (uCloudStrength > 0.001) {
          float c = clouds(d);
          float sunLit = max(0.0, dot(d, normalize(uSunDir))) * 0.3 + 0.7;
          vec3 cloudColor = mix(vec3(0.82, 0.86, 0.90), vec3(1.0, 0.98, 0.94) * sunLit, 0.5);
          sky = mix(sky, cloudColor, c * uCloudStrength);
        }
        if (uSunDisc > 0.001) {
          float sd = max(0.0, dot(d, normalize(uSunDir)));
          float disc = smoothstep(uSunSize, uSunSize + 0.0008, sd);
          float halo = pow(sd, 64.0) * 0.40 + pow(sd, 6.0) * 0.08;
          sky += uSunColor * (disc * uSunDisc + halo);
        }
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Procedural star field as a Points cloud on the upper hemisphere. Uniform
// spherical distribution (no grid banding), per-point size + brightness
// variation, and per-point twinkle phase animated in the shader. Cheap: ~1500
// points, one draw call, no depth write so it composes cleanly over the sky.
function buildStarField(radius, count = 1500, strength = 1.0) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform on the upper hemisphere: reject points with y < 0.05 so stars
    // never render inside the ground plane / below the horizon silhouette.
    let x = 0, y = 0, z = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len < 0.01 || len > 1) continue;
      x /= len; y /= len; z /= len;
    } while (y < 0.05);
    positions[i * 3 + 0] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;
    // Heavy-tailed size distribution so a handful of stars read as brighter.
    const r = Math.random();
    sizes[i] = 0.6 + r * r * 2.8;
    brightness[i] = 0.35 + Math.random() * 0.65;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute("aBrightness", new THREE.BufferAttribute(brightness, 1));
  geom.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: strength },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vBrightness;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // Scale with pixel ratio so stars look consistent across displays.
        gl_PointSize = aSize * uPixelRatio;
        // Twinkle: per-point phase + a slow global modulation.
        float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aPhase);
        vBrightness = aBrightness * tw;
      }
    `,
    fragmentShader: `
      uniform float uStrength;
      varying float vBrightness;
      void main() {
        // Round soft point with a tight core + gentle halo.
        vec2 uv = gl_PointCoord - 0.5;
        float r2 = dot(uv, uv);
        if (r2 > 0.25) discard;
        float core = smoothstep(0.25, 0.0, r2);
        float halo = smoothstep(0.25, 0.05, r2) * 0.35;
        float a = (core + halo) * vBrightness * uStrength;
        gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
      }
    `,
  });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  return pts;
}

const TRACKSIDE_WORLD_UP = new THREE.Vector3(0, 1, 0);
const TRACKSIDE_SIGN_TEX_CACHE = new Map();

function sampleTrackFrameAt(curve, u, point, tangent, right, up) {
  curve.getPointAt(u, point);
  curve.getTangentAt(u, tangent).normalize();
  right.crossVectors(tangent, TRACKSIDE_WORLD_UP);
  const len2 = right.lengthSq();
  if (len2 < 1e-10) right.set(1, 0, 0);
  else right.multiplyScalar(1 / Math.sqrt(len2));
  up.crossVectors(right, tangent).normalize();
  if (up.y < 0) {
    right.multiplyScalar(-1);
    up.multiplyScalar(-1);
  }
}

function getTracksideSignTexture(label, {
  bg = "#F4F4F6",
  fg = "#11131A",
  border = "#11131A",
  accent = null,
} = {}) {
  const key = `${label}|${bg}|${fg}|${border}|${accent || ""}`;
  if (TRACKSIDE_SIGN_TEX_CACHE.has(key)) return TRACKSIDE_SIGN_TEX_CACHE.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, canvas.width, 20);
  }
  ctx.strokeStyle = border;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = fg;
  ctx.font = `900 ${accent ? 78 : 92}px "Arial Black", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width * 0.5, canvas.height * (accent ? 0.58 : 0.54));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  TRACKSIDE_SIGN_TEX_CACHE.set(key, tex);
  return tex;
}

function makeTracksidePlacard(label, {
  width = 2.2,
  height = 1.5,
  postHeight = 2.8,
  postColor = 0x676d79,
  bg = "#F4F4F6",
  fg = "#11131A",
  border = "#11131A",
  accent = null,
} = {}) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({
    color: postColor,
    roughness: 0.82,
    metalness: 0.12,
  });
  const postGeom = new THREE.BoxGeometry(0.12, postHeight, 0.12);
  const leftPost = new THREE.Mesh(postGeom, postMat);
  const rightPost = new THREE.Mesh(postGeom, postMat);
  const postSpread = width * 0.28;
  leftPost.position.set(-postSpread, postHeight * 0.5, 0);
  rightPost.position.set(postSpread, postHeight * 0.5, 0);
  g.add(leftPost);
  g.add(rightPost);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x10141c,
      roughness: 0.78,
      metalness: 0.08,
    }),
  );
  back.position.set(0, postHeight - height * 0.2, 0);
  g.add(back);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.92, height * 0.86),
    new THREE.MeshBasicMaterial({
      map: getTracksideSignTexture(label, { bg, fg, border, accent }),
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  face.position.set(0, back.position.y, 0.045);
  g.add(face);
  g.userData.face = face;
  return g;
}

function makeMarshalPanel(color) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x5f6571,
    roughness: 0.82,
    metalness: 0.1,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.4, 0.11), postMat);
  post.position.y = 1.2;
  g.add(post);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.8, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0x0d1118,
      roughness: 0.72,
      metalness: 0.12,
    }),
  );
  box.position.set(0, 2.2, 0);
  g.add(box);

  const lamp = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.26),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  lamp.position.set(0, 2.2, 0.1);
  g.add(lamp);
  return g;
}

function buildRain(bbox) {
  const COUNT = 3000;
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const spanX = bbox.sx * 1.4, spanZ = bbox.sz * 1.4;
  const ceiling = Math.max(120, bbox.sy + 80);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3 + 0] = bbox.cx + (Math.random() - 0.5) * spanX;
    positions[i * 3 + 1] = bbox.cy + Math.random() * ceiling + 20;
    positions[i * 3 + 2] = bbox.cz + (Math.random() - 0.5) * spanZ;
    velocities[i * 3 + 0] = 0;
    velocities[i * 3 + 1] = -(60 + Math.random() * 40);
    velocities[i * 3 + 2] = 0;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xb8cfe4, size: 0.9, transparent: true, opacity: 0.7,
    depthWrite: false,
  });
  const pts = new THREE.Points(geom, mat);
  pts.userData = { velocities, bbox, count: COUNT, ceiling };
  pts.visible = false;
  return pts;
}

function advanceRain(rain, dt, windVec) {
  if (!rain.visible) return;
  const positions = rain.geometry.attributes.position.array;
  const vels = rain.userData.velocities;
  const bbox = rain.userData.bbox;
  const ceiling = rain.userData.ceiling;
  const spanX = bbox.sx * 1.4, spanZ = bbox.sz * 1.4;
  for (let i = 0; i < rain.userData.count; i++) {
    positions[i * 3 + 0] += (vels[i * 3 + 0] + windVec.x) * dt;
    positions[i * 3 + 1] += vels[i * 3 + 1] * dt;
    positions[i * 3 + 2] += (vels[i * 3 + 2] + windVec.z) * dt;
    if (positions[i * 3 + 1] < bbox.cy - 5) {
      positions[i * 3 + 0] = bbox.cx + (Math.random() - 0.5) * spanX;
      positions[i * 3 + 1] = bbox.cy + ceiling * 0.9 + Math.random() * 40;
      positions[i * 3 + 2] = bbox.cz + (Math.random() - 0.5) * spanZ;
    }
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

export {
  TOD_PRESETS,
  WET_OVERLAY,
  mulHex,
  mulHexLumaFloor,
  detectTimeOfDay,
  buildSkyDome,
  buildVoidBackdrop,
  buildStarField,
  sampleTrackFrameAt,
  makeTracksidePlacard,
  makeMarshalPanel,
  buildRain,
  advanceRain,
};

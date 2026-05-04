import * as THREE from "three";

// Track dimensions (metres). Shared with Track3D scene construction.
const TRACK_WIDTH = 14;
const RUNOFF_WIDTH = 32;
const KERB_WIDTH = 2.2;
const DRS_STRIPE_WIDTH = 1.8;
const Z_EXAGGERATION = 1.4;

function detectUnitScale(circuit) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of circuit) {
    const x = Number(p?.x), y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(ymin)) return 1;
  const diag = Math.hypot(xmax - xmin, ymax - ymin);
  if (diag > 500000) return 0.0001;
  if (diag > 2000)   return 0.1;
  return 1;
}

// FastF1 world (X east, Y north, Z up) → Three.js (Y up, -Z forward), in
// metres, with elevation baseline removed so the track sits near y=0.
function toThree(p, zBase, scale) {
  return new THREE.Vector3(
    p.x * scale,
    ((p.z || 0) * scale - zBase) * Z_EXAGGERATION,
    -p.y * scale,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Curve + ribbon geometry.
// ───────────────────────────────────────────────────────────────────────────

function buildCenterlineCurve(circuit, zBase, scale) {
  const pts = [];
  for (const raw of circuit) {
    const x = Number(raw?.x), y = Number(raw?.y), z = Number(raw?.z ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    pts.push(toThree({ x, y, z }, zBase, scale));
  }
  if (pts.length === 0) {
    pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  } else if (pts.length === 1) {
    pts.push(pts[0].clone().add(new THREE.Vector3(1, 0, 0)));
  }
  // A duplicate closing vertex makes Catmull-Rom kink — drop it if the
  // publisher appended one.
  if (pts.length >= 3 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-3) {
    pts.pop();
  }
  const closed = pts.length >= 3;
  const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal", 0.5);
  // Arc-length divisions drive the accuracy of `getPointAt`/`getTangentAt`,
  // which sample uniformly along the curve's arc length rather than its
  // parameter t. Default (200) is too coarse for tracks up to ~7 km — bump
  // to ~`pts.length` so kerb stripes / racing-line dashes stay evenly
  // spaced through tight hairpins and long straights alike.
  curve.arcLengthDivisions = Math.max(400, pts.length * 2);
  return curve;
}

// Per-curve frame cache. Each ribbon helper used to walk the curve from
// scratch — for ~12 ribbons × 2000 segments, that's ~24k getPointAt +
// getTangentAt calls during scene build, plus the "stable right" rolling
// frame computation duplicated each time. We sample once per (curve,
// segments) and reuse the Float32 arrays for every consumer.
//
// Returns interleaved buffers:
//   points:   [x0,y0,z0, x1,y1,z1, ...]                — `(N+1) * 3`
//   tangents: [tx,ty,tz, ...]                          — `(N+1) * 3`
//   rights:   [rx,ry,rz, ...] (in track plane, world-up biased) — `(N+1) * 3`
const _frameCache = new WeakMap(); // curve → Map<segments, frames>
function sampleCurveFrames(curve, segments) {
  let bySeg = _frameCache.get(curve);
  if (!bySeg) {
    bySeg = new Map();
    _frameCache.set(curve, bySeg);
  }
  const cached = bySeg.get(segments);
  if (cached) return cached;

  const N = segments + 1;
  const points = new Float32Array(N * 3);
  const tangents = new Float32Array(N * 3);
  const rights = new Float32Array(N * 3);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let havePrevRight = false;

  for (let i = 0; i < N; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tan);
    havePrevRight = updateStableRight(tan, up, right, prevRight, havePrevRight);
    points[i * 3 + 0] = p.x;
    points[i * 3 + 1] = p.y;
    points[i * 3 + 2] = p.z;
    tangents[i * 3 + 0] = tan.x;
    tangents[i * 3 + 1] = tan.y;
    tangents[i * 3 + 2] = tan.z;
    rights[i * 3 + 0] = right.x;
    rights[i * 3 + 1] = right.y;
    rights[i * 3 + 2] = right.z;
  }

  const frames = { points, tangents, rights, count: N };
  bySeg.set(segments, frames);
  return frames;
}

function updateStableRight(tan, up, right, prevRight, havePrevRight) {
  right.crossVectors(tan, up);
  const len2 = right.lengthSq();
  if (len2 < 1e-10) {
    if (havePrevRight) right.copy(prevRight);
    else right.set(1, 0, 0);
  } else {
    right.multiplyScalar(1 / Math.sqrt(len2));
    if (havePrevRight && right.dot(prevRight) < 0) right.multiplyScalar(-1);
  }
  prevRight.copy(right);
  return true;
}

// Clamp an XZ point so it never sits closer than `minClearance` to any sampled
// centerline frame point. This is a build-time guard for offset ribbons on
// tight/co-located sections where a simple normal-offset can fold inward.
function clampPointToMinClearanceXZ(x, z, fp, count, minClearance, fallbackX, fallbackZ, out) {
  let bestD2 = Infinity;
  let nearX = x;
  let nearZ = z;
  for (let j = 0; j < count; j++) {
    const cx = fp[j * 3 + 0];
    const cz = fp[j * 3 + 2];
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearX = cx;
      nearZ = cz;
    }
  }
  const minD2 = minClearance * minClearance;
  if (bestD2 >= minD2) {
    out.x = x;
    out.z = z;
    return;
  }
  let ox = x - nearX;
  let oz = z - nearZ;
  let len = Math.hypot(ox, oz);
  if (len < 1e-6) {
    ox = fallbackX;
    oz = fallbackZ;
    len = Math.hypot(ox, oz);
    if (len < 1e-6) {
      ox = 1;
      oz = 0;
      len = 1;
    }
  }
  const s = minClearance / len;
  out.x = nearX + ox * s;
  out.z = nearZ + oz * s;
}

// Ribbon of constant half-width along the curve. `yLift` puts layered ribbons
// (runoff, track, kerbs) on separate tiny y-planes to avoid z-fighting.
// `uvRepeat` controls how many times the texture tiles along the length.
//
// Uses arc-length-uniform sampling (`getPointAt`/`getTangentAt`) so segments
// represent equal real-world distance — kerb stripes stay evenly spaced
// through hairpins instead of bunching where the parametric `t` compresses.
function buildRibbonGeometry(curve, segments, halfWidth, yLift, uvRepeat = 80) {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let havePrevRight = false;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tan);
    havePrevRight = updateStableRight(tan, up, right, prevRight, havePrevRight);
    positions[i * 6 + 0] = p.x - right.x * halfWidth;
    positions[i * 6 + 1] = p.y + yLift;
    positions[i * 6 + 2] = p.z - right.z * halfWidth;
    positions[i * 6 + 3] = p.x + right.x * halfWidth;
    positions[i * 6 + 4] = p.y + yLift;
    positions[i * 6 + 5] = p.z + right.z * halfWidth;
    uvs[i * 4 + 0] = 0; uvs[i * 4 + 1] = t * uvRepeat;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = t * uvRepeat;
    if (i < segments) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function buildPartialEdgeLineGeometry(curve, segments, uStart, uEnd, offset, width, yLift, uvRepeat = 1) {
  const span = uEnd >= uStart ? (uEnd - uStart) : (1 - uStart + uEnd);
  const partSegs = Math.max(4, Math.floor(segments * span));
  const positions = new Float32Array((partSegs + 1) * 2 * 3);
  const uvs = new Float32Array((partSegs + 1) * 2 * 2);
  const indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let havePrevRight = false;
  const half = width * 0.5;
  for (let i = 0; i <= partSegs; i++) {
    const t = i / partSegs;
    const u = (uStart + t * span) % 1;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tan);
    havePrevRight = updateStableRight(tan, up, right, prevRight, havePrevRight);
    const inner = offset - half;
    const outer = offset + half;
    positions[i * 6 + 0] = p.x + right.x * inner;
    positions[i * 6 + 1] = p.y + yLift;
    positions[i * 6 + 2] = p.z + right.z * inner;
    positions[i * 6 + 3] = p.x + right.x * outer;
    positions[i * 6 + 4] = p.y + yLift;
    positions[i * 6 + 5] = p.z + right.z * outer;
    uvs[i * 4 + 0] = 0; uvs[i * 4 + 1] = t * uvRepeat;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = t * uvRepeat;
    if (i < partSegs) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function buildVerticalRibbonGeometry(curve, segments, offset, width, yLift, height, uvRepeat = 1) {
  const positions = new Float32Array((segments + 1) * 4 * 3);
  const uvs = new Float32Array((segments + 1) * 4 * 2);
  const indices = [];
  const half = width * 0.5;
  const frames = sampleCurveFrames(curve, segments);
  const fp = frames.points, fr = frames.rights;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = fp[i * 3], py = fp[i * 3 + 1], pz = fp[i * 3 + 2];
    const rx = fr[i * 3], rz = fr[i * 3 + 2];
    const inner = offset - half;
    const outer = offset + half;
    const base = i * 12;
    positions[base + 0] = px + rx * inner;
    positions[base + 1] = py + yLift;
    positions[base + 2] = pz + rz * inner;
    positions[base + 3] = px + rx * outer;
    positions[base + 4] = py + yLift;
    positions[base + 5] = pz + rz * outer;
    positions[base + 6] = px + rx * inner;
    positions[base + 7] = py + yLift + height;
    positions[base + 8] = pz + rz * inner;
    positions[base + 9] = px + rx * outer;
    positions[base + 10] = py + yLift + height;
    positions[base + 11] = pz + rz * outer;

    const uvBase = i * 8;
    uvs[uvBase + 0] = 0; uvs[uvBase + 1] = t * uvRepeat;
    uvs[uvBase + 2] = 1; uvs[uvBase + 3] = t * uvRepeat;
    uvs[uvBase + 4] = 0; uvs[uvBase + 5] = t * uvRepeat;
    uvs[uvBase + 6] = 1; uvs[uvBase + 7] = t * uvRepeat;
    if (i < segments) {
      const a = i * 4;
      const b = (i + 1) * 4;
      indices.push(a + 0, b + 0, a + 2, a + 2, b + 0, b + 2);
      indices.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
      indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function buildCornerRanges(curve, sampleCount = 720) {
  const tangents = new Array(sampleCount + 1);
  for (let i = 0; i <= sampleCount; i++) {
    tangents[i] = curve.getTangentAt(i / sampleCount).clone().normalize();
  }
  const values = [];
  let maxAbs = 0;
  for (let i = 0; i < sampleCount; i++) {
    const a = tangents[i];
    const b = tangents[(i + 1) % sampleCount];
    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    const angle = Math.acos(dot);
    const sign = Math.sign(a.clone().cross(b).y || 0);
    const signedCurvature = angle * (sign === 0 ? 1 : sign);
    values.push(signedCurvature);
    const absK = Math.abs(signedCurvature);
    if (absK > maxAbs) maxAbs = absK;
  }
  const threshold = Math.max(0.008, maxAbs * 0.35);
  const active = values.map((v) => Math.abs(v) >= threshold);
  const ranges = [];
  let i = 0;
  while (i < sampleCount) {
    if (!active[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < sampleCount && active[i]) i++;
    const end = i - 1;
    if (end - start + 1 < 6) continue;
    let apex = start;
    for (let j = start + 1; j <= end; j++) {
      if (Math.abs(values[j]) > Math.abs(values[apex])) apex = j;
    }
    ranges.push({
      startU: start / sampleCount,
      endU: (end + 1) / sampleCount,
      apexU: apex / sampleCount,
      sign: Math.sign(values[apex]) || 1,
    });
  }
  if (ranges.length >= 2 && active[0] && active[sampleCount - 1]) {
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    ranges[0] = {
      startU: last.startU,
      endU: first.endU,
      apexU: Math.abs(last.sign) >= Math.abs(first.sign) ? last.apexU : first.apexU,
      sign: Math.abs(last.sign) >= Math.abs(first.sign) ? last.sign : first.sign,
    };
    ranges.pop();
  }
  return ranges;
}

// Extruded ribbon — a top surface + outer side walls (no bottom cap, it's
// never seen). Gives the track real vertical thickness so it physically sits
// above the ground plane and cannot z-fight under any camera angle. The top
// face carries UVs for the asphalt albedo; side walls use a flat UV so the
// raw asphalt colour shows on the edge chamfer without tile seams.
//
// Vertex layout per ring (4 verts): 0 top-left, 1 top-right, 2 bot-left,
// 3 bot-right. Side faces are stitched between consecutive rings.
function buildExtrudedRibbonGeometry(curve, segments, halfWidth, baseY, thickness, uvRepeat = 80) {
  const vertsPerRing = 4;
  const positions = new Float32Array((segments + 1) * vertsPerRing * 3);
  const uvs = new Float32Array((segments + 1) * vertsPerRing * 2);
  const indices = [];
  const frames = sampleCurveFrames(curve, segments);
  const fp = frames.points, fr = frames.rights;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = fp[i * 3], py = fp[i * 3 + 1], pz = fp[i * 3 + 2];
    const rx = fr[i * 3], rz = fr[i * 3 + 2];
    const yTop = py + baseY + thickness;
    const yBot = py + baseY;
    const base = i * vertsPerRing * 3;
    // top-left
    positions[base + 0] = px - rx * halfWidth;
    positions[base + 1] = yTop;
    positions[base + 2] = pz - rz * halfWidth;
    // top-right
    positions[base + 3] = px + rx * halfWidth;
    positions[base + 4] = yTop;
    positions[base + 5] = pz + rz * halfWidth;
    // bot-left
    positions[base + 6] = px - rx * halfWidth;
    positions[base + 7] = yBot;
    positions[base + 8] = pz - rz * halfWidth;
    // bot-right
    positions[base + 9]  = px + rx * halfWidth;
    positions[base + 10] = yBot;
    positions[base + 11] = pz + rz * halfWidth;
    // UVs: top face uses (0..1, t*repeat). Side walls reuse u=0/1 plus the
    // same length coord so texturing is continuous.
    const uvBase = i * vertsPerRing * 2;
    uvs[uvBase + 0] = 0; uvs[uvBase + 1] = t * uvRepeat; // top-left
    uvs[uvBase + 2] = 1; uvs[uvBase + 3] = t * uvRepeat; // top-right
    uvs[uvBase + 4] = 0; uvs[uvBase + 5] = t * uvRepeat; // bot-left
    uvs[uvBase + 6] = 1; uvs[uvBase + 7] = t * uvRepeat; // bot-right
    if (i < segments) {
      const a = i * vertsPerRing;
      const b = (i + 1) * vertsPerRing;
      // Top face (winding so normal points +Y).
      indices.push(a + 0, a + 1, b + 0, a + 1, b + 1, b + 0);
      // Left side wall (normal points -right).
      indices.push(a + 2, a + 0, b + 2, a + 0, b + 0, b + 2);
      // Right side wall (normal points +right).
      indices.push(a + 3, b + 3, a + 1, a + 1, b + 3, b + 1);
      // Bottom face (winding reversed so normal points -Y).
      indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Thin painted edge line (like white track boundaries) — a slab offset from
// the centerline by `offset` with a small `width`. Used for both edge
// stripes and for the runoff parallel strips. `uvRepeat` controls how many
// times a mapped texture tiles along the length.
function buildEdgeLineGeometry(curve, segments, offset, width, yLift, uvRepeat = 1, minClearance = null) {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];
  const half = width * 0.5;
  const frames = sampleCurveFrames(curve, segments);
  const fp = frames.points, fr = frames.rights;
  const hasMinClearance = Number.isFinite(minClearance) && minClearance > 0;
  const clampedInner = { x: 0, z: 0 };
  const clampedOuter = { x: 0, z: 0 };
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = fp[i * 3], py = fp[i * 3 + 1], pz = fp[i * 3 + 2];
    const rx = fr[i * 3], rz = fr[i * 3 + 2];
    const inner = offset - half, outer = offset + half;
    let innerX = px + rx * inner;
    let innerZ = pz + rz * inner;
    let outerX = px + rx * outer;
    let outerZ = pz + rz * outer;
    if (hasMinClearance) {
      clampPointToMinClearanceXZ(
        innerX, innerZ, fp, frames.count, minClearance, rx, rz, clampedInner,
      );
      clampPointToMinClearanceXZ(
        outerX, outerZ, fp, frames.count, minClearance, rx, rz, clampedOuter,
      );
      innerX = clampedInner.x; innerZ = clampedInner.z;
      outerX = clampedOuter.x; outerZ = clampedOuter.z;
    }
    positions[i * 6 + 0] = innerX;
    positions[i * 6 + 1] = py + yLift;
    positions[i * 6 + 2] = innerZ;
    positions[i * 6 + 3] = outerX;
    positions[i * 6 + 4] = py + yLift;
    positions[i * 6 + 5] = outerZ;
    uvs[i * 4 + 0] = 0; uvs[i * 4 + 1] = t * uvRepeat;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = t * uvRepeat;
    if (i < segments) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Raised, extruded kerbs with a top face + outer fascia (the inner face is
// hidden against the track surface, the underside never sees the camera).
// Colour stripes are painted by duplicating vertices at each colour boundary
// so the bands are crisp instead of gradient-interpolated.
//
// At ~2000 segments around a 5 km track, STRIPE_SEGS=2 ≈ 5 m per stripe —
// matches real F1 kerbing.
function buildKerbGeometry(curve, segments, innerOffset, outerOffset, side, kerbHeight, baseYOffset = 0.05) {
  const STRIPE_SEGS = 2;
  const red = new THREE.Color(0xff1e00);
  const white = new THREE.Color(0xf4f4f8);
  const positions = [];
  const colors = [];
  const indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let havePrevRight = false;
  // Per ring at curve-step i we emit 3 vertices:
  //   0: bottom-outer (sits on track surface, hidden by ribbon)
  //   1: top-inner    (top edge nearest the racing surface)
  //   2: top-outer    (top edge nearest the runoff)
  // Stripe boundaries split the ring so each band has its own pair.
  let lastBand = -1;
  const pushRing = (t, band) => {
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tan);
    havePrevRight = updateStableRight(tan, up, right, prevRight, havePrevRight);
    const inner = side * innerOffset;
    const outer = side * outerOffset;
    const baseY = p.y + baseYOffset;
    const topY = p.y + baseYOffset + kerbHeight;
    positions.push(
      p.x + right.x * outer, baseY, p.z + right.z * outer,
      p.x + right.x * inner, topY,  p.z + right.z * inner,
      p.x + right.x * outer, topY,  p.z + right.z * outer,
    );
    const c = (band % 2 === 0) ? red : white;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  };
  let ringCount = 0;
  for (let i = 0; i <= segments; i++) {
    const band = Math.floor(i / STRIPE_SEGS);
    const t = i / segments;
    if (band !== lastBand && i > 0) {
      // Insert a duplicate ring at the same t so the colour change is hard.
      pushRing(t, lastBand);
      ringCount++;
      // Stitch quads from previous ring (ringCount - 2) to this duplicate
      // (ringCount - 1).
      const a0 = (ringCount - 2) * 3;
      const a1 = (ringCount - 1) * 3;
      // top face quad: a0+1, a0+2, a1+1, a1+2
      indices.push(a0 + 1, a0 + 2, a1 + 1, a1 + 1, a0 + 2, a1 + 2);
      // outer face quad: a0+0, a0+2, a1+0, a1+2
      indices.push(a0 + 0, a0 + 2, a1 + 0, a1 + 0, a0 + 2, a1 + 2);
    }
    pushRing(t, band);
    ringCount++;
    if (i > 0 && (band === lastBand || lastBand === -1)) {
      const a0 = (ringCount - 2) * 3;
      const a1 = (ringCount - 1) * 3;
      indices.push(a0 + 1, a0 + 2, a1 + 1, a1 + 1, a0 + 2, a1 + 2);
      indices.push(a0 + 0, a0 + 2, a1 + 0, a1 + 0, a0 + 2, a1 + 2);
    }
    lastBand = band;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Bright green DRS zone stripe on the outer kerb edge. Index range is given
// relative to the original CIRCUIT array; we project it onto the curve's
// normalised [0, 1] parameter and build a short ribbon across that span.
function buildDRSZoneMesh(curve, segments, circuitLen, zone, side) {
  const n = Math.max(1, circuitLen - 1);
  const uStart = Math.max(0, Math.min(1, zone.startIdx / n));
  const uEnd = Math.max(0, Math.min(1, zone.endIdx / n));
  const span = uEnd >= uStart ? (uEnd - uStart) : (1 - uStart + uEnd); // allow wrap
  const zoneSegs = Math.max(12, Math.floor(span * segments));
  const positions = new Float32Array((zoneSegs + 1) * 2 * 3);
  const indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const prevRight = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let havePrevRight = false;
  const inner = side * (TRACK_WIDTH + KERB_WIDTH + 0.4);
  const outer = side * (TRACK_WIDTH + KERB_WIDTH + 0.4 + DRS_STRIPE_WIDTH);
  for (let i = 0; i <= zoneSegs; i++) {
    const tu = i / zoneSegs;
    const u = (uStart + tu * span) % 1;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tan);
    havePrevRight = updateStableRight(tan, up, right, prevRight, havePrevRight);
    positions[i * 6 + 0] = p.x + right.x * inner;
    positions[i * 6 + 1] = p.y + 0.42;
    positions[i * 6 + 2] = p.z + right.z * inner;
    positions[i * 6 + 3] = p.x + right.x * outer;
    positions[i * 6 + 4] = p.y + 0.42;
    positions[i * 6 + 5] = p.z + right.z * outer;
    if (i < zoneSegs) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x18ff74, transparent: true, opacity: 0.55,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 3;
  return mesh;
}

// A short coloured bar laid across the track at the start of a sector. Sits
// at y=0.11, just above the track surface.
function buildSectorGate(curve, circuitLen, idx, color) {
  const n = Math.max(1, circuitLen - 1);
  const u = Math.max(0, Math.min(1, idx / n));
  const p = curve.getPointAt(u);
  const tan = new THREE.Vector3();
  curve.getTangentAt(u, tan);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(tan, up).normalize();
  const halfW = TRACK_WIDTH + KERB_WIDTH;
  const depth = 0.9;
  const positions = new Float32Array([
    p.x + right.x * -halfW - tan.x * depth * 0.5, p.y + 0.40, p.z + right.z * -halfW - tan.z * depth * 0.5,
    p.x + right.x *  halfW - tan.x * depth * 0.5, p.y + 0.40, p.z + right.z *  halfW - tan.z * depth * 0.5,
    p.x + right.x * -halfW + tan.x * depth * 0.5, p.y + 0.40, p.z + right.z * -halfW + tan.z * depth * 0.5,
    p.x + right.x *  halfW + tan.x * depth * 0.5, p.y + 0.40, p.z + right.z *  halfW + tan.z * depth * 0.5,
  ]);
  const indices = [0, 2, 1, 1, 2, 3];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  let gateColor = 0xf4f4f8;
  if (typeof color === "string") {
    const c = color.trim().toLowerCase();
    if (c === "purple") gateColor = 0xb78cff;
    else if (c === "green") gateColor = 0x18ff74;
    else if (c === "yellow") gateColor = 0xffd84a;
    else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) {
      const hex = c.slice(1);
      gateColor = Number.parseInt(
        hex.length === 3 ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : hex,
        16,
      );
    }
  } else if (typeof color === "number") {
    gateColor = color;
  }
  const mat = new THREE.MeshBasicMaterial({
    color: gateColor, transparent: true, opacity: 0.52,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 3;
  return mesh;
}

function buildStartFinishMesh(curve, halfWidth) {
  const p = curve.getPoint(0);
  const tan = new THREE.Vector3();
  curve.getTangent(0, tan);
  // Thin axis along tangent, long axis spans the track width.
  const planeGeom = new THREE.PlaneGeometry(5, halfWidth * 2, 2, 8);
  planeGeom.rotateX(-Math.PI / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 8; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#6d7382";
    ctx.fillRect(0, i * 4, 8, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.72, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(planeGeom, mat);
  mesh.position.set(p.x, p.y + 0.41, p.z);
  mesh.rotation.y = Math.atan2(-tan.z, tan.x);
  mesh.renderOrder = 3;
  return mesh;
}

function buildRacingLineMesh(curve, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const p = curve.getPointAt(i / segments);
    pts.push(new THREE.Vector3(p.x, p.y + 0.39, p.z));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({
    color: 0xd7deef, dashSize: 10, gapSize: 16, transparent: true, opacity: 0.12,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  line.renderOrder = 3;
  return line;
}

// Flat reference plane at a fixed world-space Y. Carries UVs scaled in metres
// so a procedural grid shader can draw lines with a known cell size without
// needing to know the plane's size. The plane never bends to follow track
// elevation — that's the whole point of the abstract direction: tracks float
// over a void; the grid is just a motion / scale reference.
function buildGridPlane(center, extent, baseY) {
  const size = extent * 8;
  const geom = new THREE.PlaneGeometry(size, size, 1, 1);
  geom.rotateX(-Math.PI / 2);
  // UVs are 0..1 across the plane; multiplying by `size` in the shader gives
  // metres directly, so cell size is tunable without rebuilding geometry.
  geom.translate(center.x, baseY, center.z);
  geom.userData = { size };
  return geom;
}

// Skirt: a thin extruded wall hanging straight down from the ribbon's outer
// edges to `depth` metres below the track surface. Inherits the ribbon's
// elevation per-vertex, so on banked or climbing sections it tilts and rises
// with the ribbon for free. Only the two outer side walls are emitted — the
// top is hidden by the ribbon and the bottom is never seen.
//
// `halfWidth` should match the track ribbon's outer edge (TRACK_WIDTH +
// KERB_WIDTH if you want the skirt to fall outside the kerbs, or TRACK_WIDTH
// to tuck it under). `topYOffset` lifts the top edge so it sits flush with
// the bottom of the extruded ribbon.
function buildRibbonSkirt(curve, segments, halfWidth, topYOffset, depth) {
  const positions = new Float32Array((segments + 1) * 4 * 3);
  const uvs = new Float32Array((segments + 1) * 4 * 2);
  const indices = [];
  const frames = sampleCurveFrames(curve, segments);
  const fp = frames.points, fr = frames.rights;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = fp[i * 3], py = fp[i * 3 + 1], pz = fp[i * 3 + 2];
    const rx = fr[i * 3], rz = fr[i * 3 + 2];
    const yTop = py + topYOffset;
    const yBot = yTop - depth;
    const base = i * 12;
    // 0: inner top, 1: outer top, 2: inner bot, 3: outer bot
    positions[base + 0] = px - rx * halfWidth;
    positions[base + 1] = yTop;
    positions[base + 2] = pz - rz * halfWidth;
    positions[base + 3] = px + rx * halfWidth;
    positions[base + 4] = yTop;
    positions[base + 5] = pz + rz * halfWidth;
    positions[base + 6] = px - rx * halfWidth;
    positions[base + 7] = yBot;
    positions[base + 8] = pz - rz * halfWidth;
    positions[base + 9]  = px + rx * halfWidth;
    positions[base + 10] = yBot;
    positions[base + 11] = pz + rz * halfWidth;
    // V is vertical position along the wall (0 at top, 1 at bottom) so the
    // material can fade or gradient bake without sampling y in the shader.
    const uvBase = i * 8;
    uvs[uvBase + 0] = t; uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = t; uvs[uvBase + 3] = 0;
    uvs[uvBase + 4] = t; uvs[uvBase + 5] = 1;
    uvs[uvBase + 6] = t; uvs[uvBase + 7] = 1;
    if (i < segments) {
      const a = i * 4, b = (i + 1) * 4;
      // Left wall (normal points -right): inner top → inner bot.
      indices.push(a + 0, a + 2, b + 0, a + 2, b + 2, b + 0);
      // Right wall (normal points +right): outer top → outer bot.
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      // Bottom cap (normal points -Y): inner bot → outer bot.
      indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    }
  }
  // Per-vertex colours: lighter at top, darker at bottom. Sells the "track is
  // sitting on something" illusion without modelling that something.
  const colors = new Float32Array((segments + 1) * 4 * 3);
  for (let i = 0; i <= segments; i++) {
    const base = i * 12;
    // top (lighter, 0.32) — sits flush with the ribbon edge in shadow
    colors[base + 0] = 0.32; colors[base + 1] = 0.34; colors[base + 2] = 0.40;
    colors[base + 3] = 0.32; colors[base + 4] = 0.34; colors[base + 5] = 0.40;
    // bottom (darker, ~0.06) — fades into the void
    colors[base + 6] = 0.06; colors[base + 7] = 0.07; colors[base + 8] = 0.10;
    colors[base + 9] = 0.06; colors[base + 10] = 0.07; colors[base + 11] = 0.10;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export {
  TRACK_WIDTH,
  RUNOFF_WIDTH,
  KERB_WIDTH,
  DRS_STRIPE_WIDTH,
  detectUnitScale,
  buildCenterlineCurve,
  buildRibbonGeometry,
  buildPartialEdgeLineGeometry,
  buildVerticalRibbonGeometry,
  buildCornerRanges,
  buildExtrudedRibbonGeometry,
  buildEdgeLineGeometry,
  buildKerbGeometry,
  buildDRSZoneMesh,
  buildSectorGate,
  buildStartFinishMesh,
  buildRacingLineMesh,
  buildGridPlane,
  buildRibbonSkirt,
};

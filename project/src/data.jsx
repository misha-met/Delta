// Live data shim — populates window.DELTA from the backend.
// Async bootstrap fetches CIRCUIT/TEAMS/DRIVERS without blocking paint.
// Fallbacks are installed immediately so components can destructure safely;
// real data mutates the same objects in-place once fetched.

const BASE = `${location.protocol}//${location.host}`;

async function asyncFetch(path) {
  try {
    const r = await fetch(BASE + path);
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

// --- Compound int → DELTA key mapping ---
const COMPOUND_MAP = { 0: "S", 1: "M", 2: "H", 3: "I", 4: "W" };

// --- TEAMS (mutable — colors updated from WS snapshot) ---
const TEAMS = {};
const DRIVERS = [];

// --- CIRCUIT / SECTORS (const arrays, mutated in-place) ---
// Each point: { x, y, z }. FastF1 hands us decimetre units (1/10 m); we leave
// CIRCUIT in raw units because IsoTrack rescales via SVG viewBox, and expose
// UNIT_SCALE so views that need metres (Track3D, HUD length readouts) can
// convert.
const CIRCUIT = [{ x: 0, y: 0, z: 0 }];
const SECTORS = [
  { idx: 0, color: "#FF1E00", name: "S1" },
  { idx: 0, color: "#FFD93A", name: "S2" },
  { idx: 0, color: "#00D9FF", name: "S3" },
];
// Populated from geometry snapshot. Each zone: { startIdx, endIdx }.
const DRS_ZONES = [];
// Scalar applied to CIRCUIT coords / total_length_m to convert to metres.
// 0.1 for FastF1 decimetres (the common case), 1 if already metres, 0.0001
// for legacy 1/10 mm exports. Set by _recomputeUnitScale on snapshot.
let UNIT_SCALE = 1;
let GEOMETRY_VERSION = 0;

// Infer the multiplier needed to convert CIRCUIT coords to metres. FastF1
// position data is in 1/10 m (decimetres), which gives a ~5 km track a
// diagonal extent in the tens of thousands. Some legacy exports are in
// 1/10 mm or already in metres.
function _detectUnitScale(circuit) {
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

function _publishGeometryUpdate() {
  GEOMETRY_VERSION += 1;
  const detail = { version: GEOMETRY_VERSION };
  window.dispatchEvent(new CustomEvent("delta:geometry-version", { detail }));
  window.dispatchEvent(new CustomEvent("apex:geometry-version", { detail }));
}

function _installGeometry(geo) {
  if (!geo) return false;
  const cx = geo.centerline?.x || [];
  const cy = geo.centerline?.y || [];
  if (cx.length <= 1) return false;

  const cz = geo.centerline?.z || null;
  CIRCUIT.splice(0, CIRCUIT.length, ...cx.map((x, i) => ({
    x, y: cy[i] || 0, z: cz ? (cz[i] || 0) : 0,
  })));
  UNIT_SCALE = _detectUnitScale(CIRCUIT);
  DRS_ZONES.splice(0, DRS_ZONES.length,
    ...(geo.drs_zones || []).map((z) => ({
      startIdx: z.start_idx, endIdx: z.end_idx,
    }))
  );

  const totalLength = geo.total_length_m || 1;
  const n = CIRCUIT.length;
  const boundaries = geo.sector_boundaries_m || [];
  const sectorColors = ["#FF1E00", "#FFD93A", "#00D9FF"];

  if (boundaries.length >= 2) {
    SECTORS.splice(0, SECTORS.length,
      { idx: 0, color: sectorColors[0], name: "S1" },
      ...boundaries.slice(0, 2).map((m, i) => ({
        idx: Math.round((m / totalLength) * (n - 1)) % n,
        color: sectorColors[i + 1] || "#FFFFFF",
        name: `S${i + 2}`,
      })),
    );
  } else if (n > 1) {
    SECTORS.splice(0, SECTORS.length,
      { idx: 0, color: "#FF1E00", name: "S1" },
      { idx: Math.floor(n / 3), color: "#FFD93A", name: "S2" },
      { idx: Math.floor(2 * n / 3), color: "#00D9FF", name: "S3" },
    );
  }

  _publishGeometryUpdate();
  return true;
}

// --- Populate from summary / geometry (async, non-blocking) ---
let _dataResolved;
const DELTA_DATA_READY = new Promise((resolve) => { _dataResolved = resolve; });

async function _initDELTA() {
  const [_summary, _geometry] = await Promise.all([
    asyncFetch("/api/session/summary"),
    asyncFetch("/api/session/geometry"),
  ]);

  if (_summary && _summary.drivers) {
    const teamsSeen = {};
    for (const d of _summary.drivers) {
      const teamKey = d.team || "Unknown";
      if (!teamsSeen[teamKey]) {
        teamsSeen[teamKey] = true;
        TEAMS[teamKey] = { name: teamKey, color: d.team_color || "#FF1E00", sub: "#8A0A00" };
      }
      DRIVERS.push({
        code: d.code,
        num: d.number || 0,
        name: d.full_name || d.code,
        team: teamKey,
        country: d.country || "",
      });
    }
  }

  _installGeometry(_geometry);

  // Fallbacks (only fill if still empty after fetch)
  if (CIRCUIT.length === 0) CIRCUIT.push({ x: 0, y: 0 });
  if (DRIVERS.length === 0) {
    DRIVERS.push({ code: "???", num: 0, name: "Loading...", team: "Loading", country: "" });
    TEAMS["Loading"] = { name: "Loading", color: "#FF1E00", sub: "#8A0A00" };
  }
  if (SECTORS.length === 0) {
    SECTORS.push(
      { idx: 0, color: "#FF1E00", name: "S1" },
      { idx: Math.floor(CIRCUIT.length / 3), color: "#FFD93A", name: "S2" },
      { idx: Math.floor(2 * CIRCUIT.length / 3), color: "#00D9FF", name: "S3" },
    );
  }

  _refreshDriverCache();
  _dataResolved();
}

_initDELTA();


const COMPOUNDS = {
  S:  { label: "SOFT",   color: "#FF3A3A" },
  M:  { label: "MEDIUM", color: "#FFD93A" },
  H:  { label: "HARD",   color: "#F4F4F4" },
  I:  { label: "INTER",  color: "#3AE87A" },
  W:  { label: "WET",    color: "#3A9BFF" },
};

// --- Live frame storage (written by live_state.jsx) ---
window.__LIVE_FRAME = null;

// --- Snapshot installer (called from live_state.jsx on WS snapshot) ---
function _installSnapshot(snap) {
  if (!snap) return;
  const meta = snap.driver_meta || {};
  // Clear sentinel "???" entry on first real snapshot
  if (Object.keys(meta).length > 0) {
    const sentinelIdx = DRIVERS.findIndex(d => d.code === "???");
    if (sentinelIdx !== -1) DRIVERS.splice(sentinelIdx, 1);
    delete TEAMS["Loading"];
  }
  for (const [code, info] of Object.entries(meta)) {
    const teamKey = info.team;
    const teamColor = info.team_color || "#FF1E00";
    if (TEAMS[teamKey]) {
      TEAMS[teamKey].color = teamColor;
    }
    if (!TEAMS[teamKey] && teamKey) {
      TEAMS[teamKey] = { name: teamKey, color: teamColor, sub: "#8A0A00" };
    }
  }
  // Update driver details from snapshot meta
  for (const [code, info] of Object.entries(meta)) {
    const existing = DRIVERS.find(d => d.code === code);
    if (existing) {
      if (info.full_name) existing.name = info.full_name;
      if (info.country) existing.country = info.country;
    } else {
      DRIVERS.push({
        code: info.code || code,
        num: info.number || 0,
        name: info.full_name || code,
        team: info.team || "Unknown",
        country: info.country || "",
      });
    }
  }
  _refreshDriverCache();
  // Rebuild geometry from snapshot if present (mutate in-place)
  _installGeometry(snap.geometry);
}

function _normalizedFraction(s, fallback = 0) {
  const fracRaw = Number(s?.fraction);
  if (Number.isFinite(fracRaw)) {
    return ((fracRaw % 1) + 1) % 1;
  }
  const relRaw = Number(s?.rel_dist);
  if (Number.isFinite(relRaw) && relRaw >= 0 && relRaw <= 1.01) {
    return Math.min(1, relRaw);
  }
  return fallback;
}

// --- computeStandings: transform live frame standings to component format ---
function computeStandings(t, lap, totalLaps) {
  const f = window.__LIVE_FRAME;
  if (!f?.standings) return [];
  const n = CIRCUIT.length;
  return f.standings.map((s) => {
    const d = _driverFor(s.code);
    const perLap = _normalizedFraction(s, 0);
    const trackIdx = n > 1
      ? Math.min(n - 1, Math.max(0, Math.round(perLap * (n - 1))))
      : 0;
    return {
      pos: s.pos,
      driver: d,
      gap: s.gap_s ?? 0,
      interval: s.interval_s ?? 0,
      trackIdx,
      compound: COMPOUND_MAP[s.compound_int] || "M",
      tyreAge: s.tyre_age_laps ?? 0,
      lastLap: s.last_lap_s ?? 0,
      bestLap: s.best_lap_s ?? 0,
      lastS1: s.last_s1_s ?? null,
      lastS2: s.last_s2_s ?? null,
      lastS3: s.last_s3_s ?? null,
      pbLap: s.personal_best_lap_s ?? null,
      pbS1: s.personal_best_s1_s ?? null,
      pbS2: s.personal_best_s2_s ?? null,
      pbS3: s.personal_best_s3_s ?? null,
      stint: s.stint ?? 1,
      status: s.status || "RUN",
      pit: s.in_pit || false,
      inDRS: s.in_drs || false,
      speedKph: s.speed_kph ?? 0,
      fraction: perLap,
      labelStatus: s.label_status ?? null,
      statusReason: s.status_reason ?? null,
    };
  }).sort((a, b) => a.pos - b.pos);
}

// --- telemetryFor: extract driver telemetry from live frame ---
function telemetryFor(driverCode, t) {
  const f = window.__LIVE_FRAME;
  if (!f?.standings) return { speed: 0, throttle: 0, brake: 0, gear: 1, rpm: 0, drs: false };
  const s = f.standings.find((x) => x.code === driverCode);
  if (!s) return { speed: 0, throttle: 0, brake: 0, gear: 1, rpm: 0, drs: false };
  return {
    speed: Math.round(s.speed_kph || 0),
    throttle: Math.round(s.throttle_pct || 0),
    brake: Math.round(s.brake_pct || 0),
    gear: s.gear || 1,
    rpm: Math.round(s.rpm || 0),
    drs: s.in_drs || false,
  };
}

// --- Telemetry accumulator: fallback for laps not yet served by the backend ---
// The backend endpoint /api/session/lap_telemetry/{code}/{lap} is the source of
// truth for any completed lap. This bucket only fills in the live/current lap
// (and dry-runs before the endpoint is hit), so CompareTraces has something to
// show instantly without waiting on a round-trip.
window.__LAP_TELEMETRY = {};  // { driverCode: { lapNum: [{fraction, speed, throttle, brake, gear, rpm}, ...] } }

// --- Server-fetched lap traces cache: { "CODE:LAP": {fraction[], speed[], ...} } ---
window.__LAP_TRACE_CACHE = {};
window.__LAP_TRACE_INFLIGHT = {};

function _lapKey(code, lap) { return code + ":" + lap; }

async function fetchLapTrace(code, lap) {
  if (!code || !Number.isFinite(lap) || lap < 1) return null;
  const key = _lapKey(code, lap);
  if (window.__LAP_TRACE_CACHE[key]) return window.__LAP_TRACE_CACHE[key];
  if (window.__LAP_TRACE_INFLIGHT[key]) return window.__LAP_TRACE_INFLIGHT[key];
  const p = (async () => {
    try {
      const data = await window.DELTA_CLIENT.get(`/api/session/lap_telemetry/${encodeURIComponent(code)}/${lap}`);
      if (data && Array.isArray(data.fraction) && data.fraction.length >= 2) {
        window.__LAP_TRACE_CACHE[key] = data;
        return data;
      }
    } catch {}
    return null;
  })();
  window.__LAP_TRACE_INFLIGHT[key] = p;
  try { return await p; } finally { delete window.__LAP_TRACE_INFLIGHT[key]; }
}

function getCachedLapTrace(code, lap) {
  return window.__LAP_TRACE_CACHE[_lapKey(code, lap)] || null;
}

function clearLapTelemetry() {
  window.__LAP_TELEMETRY = {};
  window.__LAP_TRACE_CACHE = {};
  window.__LAP_TRACE_INFLIGHT = {};
}

function _accumulateFrame(frame) {
  if (!frame?.standings) return;
  for (const s of frame.standings) {
    const code = s.code;
    const lap = Number(s.lap);
    if (!Number.isFinite(lap)) continue;

    const frac = _normalizedFraction(s, null);
    if (frac == null) continue;

    if (!window.__LAP_TELEMETRY[code]) window.__LAP_TELEMETRY[code] = {};
    if (!window.__LAP_TELEMETRY[code][lap]) window.__LAP_TELEMETRY[code][lap] = [];

    const bucket = window.__LAP_TELEMETRY[code][lap];
    // Dedupe against nearest neighbour via binary search, not just the last
    // sample — handles seeks and out-of-order arrivals. Insert in sorted order.
    const sample = {
      fraction: frac,
      speed: s.speed_kph ?? 0,
      throttle: s.throttle_pct ?? 0,
      brake: s.brake_pct ?? 0,
      gear: s.gear ?? 1,
      rpm: s.rpm ?? 0,
    };
    let lo = 0, hi = bucket.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bucket[mid].fraction < frac) lo = mid + 1; else hi = mid;
    }
    const prev = bucket[lo - 1];
    const next = bucket[lo];
    if (prev && Math.abs(frac - prev.fraction) < 0.001) continue;
    if (next && Math.abs(next.fraction - frac) < 0.001) continue;
    bucket.splice(lo, 0, sample);
  }
}

// Resample a sorted list of {fraction, value} samples to N uniform points.
function _resampleTrace(sortedFrac, sortedVal, N) {
  const n = sortedFrac.length;
  if (n < 2) return [];
  const firstFrac = Math.max(0, sortedFrac[0]);
  const lastFrac = Math.min(1, sortedFrac[n - 1]);
  if (!(lastFrac > firstFrac)) return [];
  const out = new Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const targetFrac = firstFrac + (i / (N - 1)) * (lastFrac - firstFrac);
    while (j < n - 2 && sortedFrac[j + 1] < targetFrac) j += 1;
    const fLo = sortedFrac[j], fHi = sortedFrac[Math.min(j + 1, n - 1)];
    const vLo = sortedVal[j], vHi = sortedVal[Math.min(j + 1, n - 1)];
    const span = fHi - fLo;
    const t = span > 0 ? (targetFrac - fLo) / span : 0;
    out[i] = { fraction: targetFrac, value: vLo + t * (vHi - vLo) };
  }
  return out;
}

// Prefer server-cached lap trace; fall back to the live accumulator bucket.
// Returns [] if nothing is available yet. Callers should useMemo this.
function lapTrace(driverCode, lap, channel = "speed") {
  const N = 120;
  const cached = getCachedLapTrace(driverCode, lap);
  if (cached && cached.fraction.length >= 2) {
    const chArr = cached[channel];
    if (!chArr) return [];
    // Server arrays are already in time order, which on a normal lap is also
    // fraction-ascending. Pit/anomaly laps may wrap; sort if we detect regress.
    let monotone = true;
    for (let i = 1; i < cached.fraction.length; i++) {
      if (cached.fraction[i] < cached.fraction[i - 1]) { monotone = false; break; }
    }
    let fArr = cached.fraction, vArr = chArr;
    if (!monotone) {
      const idx = cached.fraction.map((_, i) => i).sort((a, b) => cached.fraction[a] - cached.fraction[b]);
      fArr = idx.map((i) => cached.fraction[i]);
      vArr = idx.map((i) => chArr[i]);
    }
    return _resampleTrace(fArr, vArr, N);
  }
  const lapData = window.__LAP_TELEMETRY?.[driverCode]?.[lap];
  if (!lapData || lapData.length < 2) return [];
  // Bucket is kept sorted by _accumulateFrame's binary insert; no resort needed.
  const fArr = new Array(lapData.length);
  const vArr = new Array(lapData.length);
  for (let i = 0; i < lapData.length; i++) {
    fArr[i] = lapData[i].fraction;
    vArr[i] = lapData[i][channel];
  }
  return _resampleTrace(fArr, vArr, N);
}

function getSessionBest() {
  return window.__LIVE_SNAPSHOT?.session_best || {};
}
function getStints(code) {
  return window.__LIVE_SNAPSHOT?.stints?.[code] || [];
}
function getPitStops(code) {
  return window.__LIVE_SNAPSHOT?.pit_stops?.[code] || [];
}

// --- Interpolation buffer for smooth temporal motion ---
const RENDER_DELAY_MS = 80;
const MAX_EXTRAPOLATE_MS = 150;
const LIVE_BUFFER_MAX = 6;

window.__LIVE_BUFFER = {
  frames: [],
  push(msg) {
    msg._recvT = performance.now();
    this.frames.push(msg);
    if (this.frames.length > LIVE_BUFFER_MAX) this.frames.shift();
  },
  clear() {
    this.frames.length = 0;
  },
};

function lerpWrap(f0, f1, t) {
  let d = f1 - f0;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  return (((f0 + d * t) % 1) + 1) % 1;
}

// Cache: code → driver entry. Rebuilt on snapshot when DRIVERS changes.
let _driverByCode = new Map();
function _refreshDriverCache() {
  _driverByCode.clear();
  for (const d of DRIVERS) _driverByCode.set(d.code, d);
}

function _driverFor(code) {
  let d = _driverByCode.get(code);
  if (d) return d;
  // Cache miss — DRIVERS may have grown since last refresh. Try once.
  _refreshDriverCache();
  d = _driverByCode.get(code);
  if (d) return d;
  // Sentinel for unknown codes; cache so we don't keep re-allocating.
  d = { code, num: 0, name: code, team: "Unknown", country: "" };
  _driverByCode.set(code, d);
  return d;
}

function sampleStandingsAt(tRender) {
  const buf = window.__LIVE_BUFFER.frames;
  if (buf.length < 1) return null;
  if (buf.length === 1) {
    return enrichStandingsWithDrivers(buf[0].standings || []);
  }
  const recv0 = buf[0]._recvT;
  const recvN = buf[buf.length - 1]._recvT;
  if (recv0 === recvN || tRender < recv0) {
    return enrichStandingsWithDrivers(buf[0].standings || []);
  }
  if (tRender >= recvN) {
    return enrichStandingsWithDrivers(buf[buf.length - 1].standings || []);
  }

  let lo = 0, hi = buf.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (buf[mid]._recvT <= tRender) lo = mid + 1;
    else hi = mid;
  }
  lo = Math.max(0, lo - 1);
  const i0 = lo, i1 = Math.min(lo + 1, buf.length - 1);
  if (i0 === i1) {
    return enrichStandingsWithDrivers(buf[i0].standings || []);
  }

  const f0 = buf[i0];
  const f1 = buf[i1];
  const t0 = f0._recvT;
  const t1 = f1._recvT;
  const alpha = (tRender - t0) / (t1 - t0);
  const inv = 1 - alpha;

  const s0 = f0.standings || [];
  const s1 = f1.standings || [];

  // Index s1 once so we avoid an O(n^2) lookup pass. We use s0 as the primary
  // ordering (positions are stable enough between adjacent frames) and only
  // fall back to s1 entries that don't appear in s0. Map + Set are reused
  // across frames; .clear() is O(n) and beats reallocating each frame.
  _s1ByCode.clear();
  _seen.clear();
  for (let i = 0; i < s1.length; i++) _s1ByCode.set(s1[i].code, s1[i]);
  const result = new Array(s0.length);
  let outIdx = 0;
  for (let i = 0; i < s0.length; i++) {
    const ss0 = s0[i];
    const code = ss0.code;
    _seen.add(code);
    const ss1 = _s1ByCode.get(code);
    if (!ss1) { result[outIdx++] = enrichInto(_scratchFor(code), ss0); continue; }
    const f0Frac = _normalizedFraction(ss0, 0);
    const f1Frac = _normalizedFraction(ss1, 0);
    result[outIdx++] = enrichInterpolatedInto(_scratchFor(code), ss0, ss1, alpha, inv,
      lerpWrap(f0Frac, f1Frac, alpha));
  }
  // Add s1-only entries (rare: a driver that appeared in the newer frame).
  for (let i = 0; i < s1.length; i++) {
    const ss1 = s1[i];
    if (!_seen.has(ss1.code)) result[outIdx++] = enrichInto(_scratchFor(ss1.code), ss1);
  }
  result.length = outIdx;
  result.sort(_byPos);
  return result;
}

const _s1ByCode = new Map();
const _seen = new Set();

function _byPos(a, b) { return (a.pos || 0) - (b.pos || 0); }

// Per-driver scratch object cache. sampleStandingsAt is called once per render
// frame and previously allocated ~20 fresh enriched objects + spread copies
// per call (1200+ allocations/sec at 60 fps). Reusing one scratch per driver
// across frames makes the hot path allocation-free and eliminates the periodic
// GC micro-pauses that read as visual judder.
//
// Safe because the only consumer (Track3D.animate) reads the returned array
// inline within a single frame and never holds references across frames.
const _scratchByCode = new Map();
function _scratchFor(code) {
  let sc = _scratchByCode.get(code);
  if (!sc) { sc = {}; _scratchByCode.set(code, sc); }
  return sc;
}

// Mutate `dst` in place to mirror `s` plus the enriched fields. Returns dst.
function enrichInto(dst, s) {
  Object.assign(dst, s);
  dst.driver = s.driver || _driverFor(s.code);
  dst.speedKph = s.speedKph ?? s.speed_kph ?? 0;
  dst.compound = s.compound ?? COMPOUND_MAP[s.compound_int] ?? "M";
  dst.tyreAge = s.tyreAge ?? s.tyre_age_laps ?? 0;
  dst.status = s.status || "RUN";
  dst.pos = s.pos ?? 0;
  dst.fraction = _normalizedFraction(s, 0);
  dst.labelStatus = s.labelStatus ?? s.label_status ?? null;
  dst.statusReason = s.statusReason ?? s.status_reason ?? null;
  return dst;
}

function enrichInterpolatedInto(dst, ss0, ss1, alpha, inv, interpFrac) {
  Object.assign(dst, ss0);
  dst.driver = ss0.driver || _driverFor(ss0.code);
  const sp = (ss0.speed_kph || 0) * inv + (ss1.speed_kph || 0) * alpha;
  dst.speedKph = sp;
  dst.speed_kph = sp;
  dst.compound = ss0.compound ?? COMPOUND_MAP[ss0.compound_int] ?? "M";
  dst.tyreAge = ss0.tyreAge ?? ss0.tyre_age_laps ?? 0;
  dst.status = ss0.status || "RUN";
  dst.pos = ss0.pos ?? 0;
  dst.fraction = interpFrac;
  dst.labelStatus = ss0.labelStatus ?? ss0.label_status ?? null;
  dst.statusReason = ss0.statusReason ?? ss0.status_reason ?? null;
  return dst;
}

function enrichStandingsWithDrivers(standings) {
  if (!standings || standings.length === 0) return [];
  const out = new Array(standings.length);
  for (let i = 0; i < standings.length; i++) {
    const s = standings[i];
    out[i] = enrichInto(_scratchFor(s.code), s);
  }
  return out;
}

window.DELTA = {
  TEAMS, DRIVERS, COMPOUNDS, CIRCUIT, SECTORS, DRS_ZONES,
  get UNIT_SCALE() { return UNIT_SCALE; },
  get geometryVersion() { return GEOMETRY_VERSION; },
  computeStandings, telemetryFor, lapTrace,
  fetchLapTrace, getCachedLapTrace, clearLapTelemetry,
  _installSnapshot, _accumulateFrame,
  getSessionBest, getStints, getPitStops,
  sampleStandingsAt,
  INTERPOLATE: true,
  // ms of render-side delay applied to the live buffer so we always interpolate
  // between two received frames instead of clamping to the latest one when a
  // frame lands late. Higher = smoother but more lagged. Tunable at runtime.
  RENDER_DELAY_MS: 80,
};
window.APEX = window.DELTA;
window.DELTA_DATA_READY = DELTA_DATA_READY;
window.APEX_DATA_READY = DELTA_DATA_READY;

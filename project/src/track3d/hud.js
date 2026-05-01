import * as THREE from "three";
import { TRACK3D_WHEEL_HUD_TUNE } from "./constants.js";

// ───────────────────────────────────────────────────────────────────────────
// Steering-wheel live HUD — renders an F1-style dashboard onto a CanvasTexture
// applied to the cockpit steering wheel mesh. One instance per Track3D
// component; the material is migrated between cars when the pinned driver
// changes (see attachWheelHud / detachWheelHud below).
// ───────────────────────────────────────────────────────────────────────────

const WHEEL_HUD_W = 1024;
const WHEEL_HUD_H = 512;

// Shift-light strip: classic F1 progression — green (revs in band), amber
// (approaching shift), red (shift now), then blue flash at the rev limiter.
const SHIFT_LIGHTS = [
  { from: 0.55, color: "#1eff6a" },
  { from: 0.62, color: "#1eff6a" },
  { from: 0.69, color: "#1eff6a" },
  { from: 0.74, color: "#1eff6a" },
  { from: 0.78, color: "#ffd93a" },
  { from: 0.82, color: "#ffd93a" },
  { from: 0.86, color: "#ffb800" },
  { from: 0.89, color: "#ff1e00" },
  { from: 0.92, color: "#ff1e00" },
  { from: 0.95, color: "#ff1e00" },
];
const REV_LIMIT_RPM = 13500; // rough F1 V6 hybrid rev band ceiling

const TYRE_COLORS = {
  S: "#ff1e00", M: "#ffd93a", H: "#ffffff", I: "#1eff6a", W: "#00d9ff",
};
const TYRE_TEXT = { S: "SOFT", M: "MED", H: "HARD", I: "INTER", W: "WET" };

function buildWheelHud() {
  const canvas = document.createElement("canvas");
  canvas.width = WHEEL_HUD_W;
  canvas.height = WHEEL_HUD_H;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // The HUD is rendered onto a PlaneGeometry quad (not the GLTF wheel mesh
  // directly), so standard UV convention applies — leave flipY at its
  // default true.
  // Mirror the canvas via texture repeat/offset so the geometry pose stays
  // simple. With repeat = -1 / offset = 1 on a given axis, that axis is
  // mirrored. The values are applied on every attach (see attachWheelHud)
  // so live debug-panel toggles take effect immediately.

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: TRACK3D_WHEEL_HUD_TUNE.emissiveIntensity,
    roughness: 0.45,
    metalness: 0.05,
    transparent: false,
  });

  // First paint: placeholder to ensure the texture has a non-empty initial
  // upload. The real data fill happens once the pinned driver is known.
  paintWheelHudPlaceholder(ctx);
  texture.needsUpdate = true;

  // Re-paint once JetBrains Mono is loaded — first placeholder may have used
  // the system fallback. After this resolves, all subsequent repaints use
  // the correct font.
  const fontReady = (typeof document !== "undefined" && document.fonts)
    ? document.fonts.load('bold 64px "JetBrains Mono"')
        .then(() => { paintWheelHudPlaceholder(ctx); texture.needsUpdate = true; })
        .catch(() => {})
    : Promise.resolve();

  let lastKey = "";

  const repaint = (data) => {
    if (!data) return false;
    // Cheap dirty-check key — avoids redrawing identical frames.
    const key = `${data.gear}|${Math.round(data.speed)}|${Math.floor((data.rpm || 0) / 100)}|${data.drs}|${data.tyre}|${data.tyreLaps}|${data.flagState}|${data.pos}|${data.lap}|${data.totalLaps}|${data.lastLap}|${data.lastLapMode}|${data.lapTag}|${data.inPit ? 1 : 0}|${data.teamColor}|${data.code}`;
    if (key === lastKey) return false;
    lastKey = key;
    paintWheelHud(ctx, data);
    texture.needsUpdate = true;
    return true;
  };

  const dispose = () => {
    texture.dispose();
    material.dispose();
  };

  return { canvas, ctx, texture, material, repaint, dispose, fontReady };
}

function paintWheelHudPlaceholder(ctx) {
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, WHEEL_HUD_W, WHEEL_HUD_H);
  ctx.fillStyle = "rgba(180,180,200,0.35)";
  ctx.font = 'bold 28px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DELTA • PITWALL", WHEEL_HUD_W / 2, WHEEL_HUD_H / 2);
}

function paintWheelHud(ctx, d) {
  const W = WHEEL_HUD_W;
  const H = WHEEL_HUD_H;

  // Background — deep cockpit black, slight team-tint vignette in corners.
  ctx.fillStyle = "#03040a";
  ctx.fillRect(0, 0, W, H);

  // Subtle outer team-colour border to frame the screen.
  const team = d.teamColor || "#FF1E00";
  ctx.strokeStyle = team;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.55;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.globalAlpha = 1;

  // Inner panel border (theme.borderRaw equivalent)
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  // Pit limiter override — when the car is in the pit lane, replace the
  // entire screen with a high-contrast LIMITER state. Real F1 wheels do this.
  if (d.inPit) {
    paintLimiter(ctx, W, H);
    return;
  }

  // ─── Shift light strip across the very top ─────────────────────────────
  paintShiftLights(ctx, W, H, d.rpm || 0);

  // ─── Flanking flag indicators (yellow / red) ───────────────────────────
  paintFlagLights(ctx, W, H, d.flagState);

  // ─── Top status row: POS, LAP X/Y, FLAG ───────────────────────────────
  const topY = 70;
  const posBoxX = 50;
  const posBoxY = topY;
  const posBoxW = 150;
  const posBoxH = 70;
  // POS chip — team coloured
  ctx.fillStyle = team;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(posBoxX, posBoxY, posBoxW, posBoxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = team;
  ctx.lineWidth = 2;
  ctx.strokeRect(posBoxX, posBoxY, posBoxW, posBoxH);
  ctx.fillStyle = "rgba(180,180,200,0.55)";
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("POS", posBoxX + 12, posBoxY + 22);
  ctx.fillStyle = "#f6f6fa";
  ctx.font = 'bold 48px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  const posStr = d.pos != null ? String(d.pos).padStart(2, "0") : "--";
  ctx.fillText(posStr, posBoxX + posBoxW - 14, posBoxY + 60);

  // Driver code — small, top centre above gear
  ctx.fillStyle = team;
  ctx.font = 'bold 30px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText(d.code || "---", W / 2, topY + 32);
  ctx.fillStyle = "rgba(180,180,200,0.7)";
  ctx.font = 'bold 16px "JetBrains Mono", monospace';
  ctx.fillText(`LAP ${d.lap || "-"} / ${d.totalLaps || "-"}`, W / 2, topY + 58);

  // FLAG pill — top right
  const flagX = W - 50 - 150;
  const flagY = topY;
  paintFlagPill(ctx, flagX, flagY, 150, 70, d.flagState);

  // ─── Centre hero: GIANT gear digit ────────────────────────────────────
  const gearCX = W / 2;
  const gearCY = 260;
  ctx.font = 'bold 200px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Glow under the gear digit at high revs.
  const revFrac = Math.max(0, Math.min(1, (d.rpm || 0) / REV_LIMIT_RPM));
  if (revFrac > 0.85) {
    ctx.shadowColor = "#ff1e00";
    ctx.shadowBlur = 48;
  }
  let gearStr;
  if (d.gear == null || d.gear === 0) gearStr = "N";
  else gearStr = String(d.gear);
  ctx.fillStyle = revFrac > 0.92 ? "#ff1e00" : "#f6f6fa";
  ctx.fillText(gearStr, gearCX, gearCY);
  ctx.shadowBlur = 0;

  // ─── Speed reading — below gear ───────────────────────────────────────
  const speed = Math.max(0, Math.round(d.speed || 0));
  ctx.fillStyle = "#f6f6fa";
  ctx.font = 'bold 56px "JetBrains Mono", monospace';
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(speed).padStart(3, "0"), gearCX, 388);
  ctx.fillStyle = "rgba(180,180,200,0.55)";
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  ctx.fillText("KPH", gearCX, 410);

  // ─── Left vertical bar: BRAKE (red) ──────────────────────────────────
  // Labels above the bars (instead of below) so they're never clipped by
  // the inner border and stay visible even when the bar is full.
  paintVerticalBar(ctx, {
    x: 50, y: 175, w: 36, h: 235,
    fillFrac: Math.max(0, Math.min(100, d.brake || 0)) / 100,
    color: "#ff1e00", label: "BRK", labelAbove: true,
  });

  // ─── Right vertical bar: THROTTLE (green) ────────────────────────────
  paintVerticalBar(ctx, {
    x: W - 50 - 36, y: 175, w: 36, h: 235,
    fillFrac: Math.max(0, Math.min(100, d.throttle || 0)) / 100,
    color: "#1eff6a", label: "THR", labelAbove: true,
  });

  // ─── Bottom row: tyre chip · MOM pill · last lap time ─────────────────
  const botY = H - 78;

  // Tyre compound chip (theme tyre colours)
  const tyreCol = TYRE_COLORS[d.tyre] || "#ffd93a";
  const tyreLabel = TYRE_TEXT[d.tyre] || "—";
  paintChip(ctx, {
    x: 110, y: botY, w: 200, h: 50,
    label: `${tyreLabel} · ${d.tyreLaps != null ? d.tyreLaps + "L" : "—"}`,
    color: tyreCol,
    fontSize: 22,
  });

  // MOM (DRS) pill — center. Wider than the others, bigger font, and a
  // dimmer-but-still-readable inactive state so the label never disappears.
  const drsActive = d.drs === "OPEN" || d.drs === true;
  paintChip(ctx, {
    x: W / 2 - 80, y: botY, w: 160, h: 50,
    label: "MOM",
    color: drsActive ? "#00d9ff" : "rgba(0,217,255,0.55)",
    filled: drsActive,
    fontSize: 26,
  });

  // Last lap time — right. Falls back to BEST when no completed lap yet
  // (lap 1 of the race). Color codes for session-best / personal-best.
  const lapText = d.lastLap || "--:--.---";
  const lapMode = d.lastLapMode || "LAST";
  let lapColor = "#f6f6fa";
  if (d.lapTag === "session_best") lapColor = "#c15aff";
  else if (d.lapTag === "pb") lapColor = "#1eff6a";
  paintChip(ctx, {
    x: W - 110 - 240, y: botY, w: 240, h: 50,
    label: `${lapMode} ${lapText}`,
    color: lapColor,
    fontSize: 22,
  });
}

function paintShiftLights(ctx, W, H, rpm) {
  const stripY = 32;
  const stripH = 22;
  const padding = 60;
  const inner = W - padding * 2;
  const gap = 4;
  const n = SHIFT_LIGHTS.length;
  const ledW = (inner - gap * (n - 1)) / n;
  const frac = Math.max(0, Math.min(1, rpm / REV_LIMIT_RPM));
  // At redline (>0.95) flash the whole strip blue at 8 Hz — the limiter cue.
  const limiterFlash = frac > 0.95 && (Math.floor(performance.now() / 70) % 2 === 0);
  for (let i = 0; i < n; i++) {
    const x = padding + i * (ledW + gap);
    const seg = SHIFT_LIGHTS[i];
    const lit = frac >= seg.from;
    if (limiterFlash) {
      ctx.fillStyle = "#00d9ff";
    } else if (lit) {
      ctx.fillStyle = seg.color;
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
    }
    if (lit && !limiterFlash) {
      ctx.shadowColor = seg.color;
      ctx.shadowBlur = 16;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fillRect(x, stripY, ledW, stripH);
  }
  ctx.shadowBlur = 0;
}

function paintFlagLights(ctx, W, H, flagState) {
  // Small square indicators flanking the central display — fire on yellow/red.
  // Server emits lowercase tokens (green | yellow | red | sc | vsc); upcased
  // here so SAFETY_CAR/VIRTUAL_SC still match if a future producer changes.
  const f = (flagState || "").toUpperCase();
  let color = null;
  if (f === "YELLOW" || f === "SC" || f === "VSC" || f === "SAFETY_CAR" || f === "VIRTUAL_SC") color = "#ffd93a";
  else if (f === "RED") color = "#ff1e00";
  if (!color) return;
  const flash = Math.floor(performance.now() / 250) % 2 === 0;
  if (!flash) return;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillRect(28, H / 2 - 18, 16, 36);
  ctx.fillRect(W - 44, H / 2 - 18, 16, 36);
  ctx.shadowBlur = 0;
}

function paintFlagPill(ctx, x, y, w, h, flagState) {
  // Server emits lowercase tokens (green | yellow | red | sc | vsc); upcased
  // here so SAFETY_CAR/VIRTUAL_SC still match if a future producer changes.
  const f = (flagState || "GREEN").toUpperCase();
  let color = "rgba(30,255,106,0.7)";
  let label = "GREEN";
  if (f === "YELLOW") { color = "#ffd93a"; label = "YELLOW"; }
  else if (f === "RED") { color = "#ff1e00"; label = "RED"; }
  else if (f === "SC" || f === "SAFETY_CAR") { color = "#ffb800"; label = "SC"; }
  else if (f === "VSC" || f === "VIRTUAL_SC") { color = "#ffb800"; label = "VSC"; }
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "rgba(180,180,200,0.55)";
  ctx.font = 'bold 13px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("FLAG", x + 12, y + 22);
  ctx.fillStyle = color;
  ctx.font = 'bold 32px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText(label, x + w - 14, y + 56);
}

function paintVerticalBar(ctx, { x, y, w, h, fillFrac, color, label, labelAbove }) {
  // Track
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x, y, w, h);
  // Fill (bottom-up)
  const fh = h * Math.max(0, Math.min(1, fillFrac));
  ctx.fillStyle = color;
  if (fillFrac > 0.05) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.fillRect(x, y + (h - fh), w, fh);
  ctx.shadowBlur = 0;
  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  // Label
  ctx.fillStyle = "rgba(180,180,200,0.7)";
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (labelAbove) {
    ctx.fillText(label, x + w / 2, y - 8);
  } else {
    ctx.fillText(label, x + w / 2, y + h + 22);
  }
}

function paintChip(ctx, { x, y, w, h, label, color, filled, fontSize }) {
  if (filled) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#0b0b11";
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.font = `bold ${fontSize || 22}px "JetBrains Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
}

// Build the live tune panel for the wheel HUD. Toggle with W. The panel
// mutates TRACK3D_WHEEL_HUD_TUNE in place; `reapply` is called whenever a
// control changes so the on-screen quad updates immediately.
function buildWheelHudDebugPanel(mount, reapply) {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "absolute", top: "12px", right: "12px",
    display: "none",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "11px",
    color: "#e6e6ef",
    padding: "10px 12px",
    background: "rgba(11,11,17,0.92)",
    border: "1px solid rgba(255,30,0,0.35)",
    borderRadius: "4px",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    pointerEvents: "auto",
    zIndex: 6,
    width: "260px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
  });
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:800;letter-spacing:0.18em;color:#ff1e00;">WHEEL HUD TUNE</div>
      <div data-act="close" style="cursor:pointer;color:rgba(180,180,200,0.6);padding:0 4px;">×</div>
    </div>
    <div style="font-size:9px;color:rgba(180,180,200,0.55);letter-spacing:0.14em;margin-bottom:8px;">PRESS W TO TOGGLE</div>
    <div data-rows></div>
    <div style="display:flex;gap:6px;margin-top:10px;">
      <button data-act="copy" style="flex:1;font-family:inherit;font-size:10px;background:#1a1a26;color:#e6e6ef;border:1px solid rgba(255,255,255,0.15);padding:6px;cursor:pointer;letter-spacing:0.08em;">COPY VALUES</button>
      <button data-act="reset" style="flex:1;font-family:inherit;font-size:10px;background:#1a1a26;color:#e6e6ef;border:1px solid rgba(255,255,255,0.15);padding:6px;cursor:pointer;letter-spacing:0.08em;">RESET</button>
    </div>
    <div data-status style="font-size:9px;color:rgba(180,180,200,0.55);letter-spacing:0.10em;margin-top:6px;min-height:12px;"></div>
  `;
  mount.appendChild(panel);

  const rowsEl = panel.querySelector("[data-rows]");
  const statusEl = panel.querySelector("[data-status]");

  const rows = [
    { key: "shiftFaceX",        kind: "slider", min: -0.5, max: 0.5, step: 0.005 },
    { key: "shiftFaceY",        kind: "slider", min: -0.5, max: 0.5, step: 0.005 },
    { key: "sizeFaceX",         kind: "slider", min: 0.05, max: 1.0, step: 0.01 },
    { key: "sizeFaceY",         kind: "slider", min: 0.05, max: 1.0, step: 0.01 },
    { key: "sizeMultiplier",    kind: "slider", min: 0.2,  max: 2.5, step: 0.01 },
    { key: "emissiveIntensity", kind: "slider", min: 0.0,  max: 2.0, step: 0.01 },
    { key: "faceSign",          kind: "toggle", on: 1,    off: -1 },
    { key: "flipU",             kind: "toggle", on: true, off: false },
    { key: "flipV",             kind: "toggle", on: true, off: false },
  ];

  // Snapshot of initial defaults — used by RESET.
  const defaults = {};
  for (const r of rows) defaults[r.key] = TRACK3D_WHEEL_HUD_TUNE[r.key];

  const refs = {};
  for (const r of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:5px;";
    if (r.kind === "slider") {
      row.innerHTML = `
        <div style="width:108px;font-size:10px;color:rgba(180,180,200,0.7);letter-spacing:0.06em;">${r.key}</div>
        <input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${TRACK3D_WHEEL_HUD_TUNE[r.key]}" style="flex:1;accent-color:#ff1e00;">
        <div data-val style="width:48px;text-align:right;font-size:10px;color:#f6f6fa;font-variant-numeric:tabular-nums;">${TRACK3D_WHEEL_HUD_TUNE[r.key].toFixed(3)}</div>
      `;
      const input = row.querySelector("input");
      const valEl = row.querySelector("[data-val]");
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        TRACK3D_WHEEL_HUD_TUNE[r.key] = v;
        valEl.textContent = v.toFixed(3);
        reapply();
      });
      refs[r.key] = { row, input, valEl };
    } else {
      row.innerHTML = `
        <div style="width:108px;font-size:10px;color:rgba(180,180,200,0.7);letter-spacing:0.06em;">${r.key}</div>
        <div data-btn style="flex:1;text-align:center;font-size:10px;background:#1a1a26;border:1px solid rgba(255,255,255,0.15);padding:4px;cursor:pointer;letter-spacing:0.08em;">${String(TRACK3D_WHEEL_HUD_TUNE[r.key])}</div>
      `;
      const btn = row.querySelector("[data-btn]");
      btn.addEventListener("click", () => {
        const cur = TRACK3D_WHEEL_HUD_TUNE[r.key];
        const next = (cur === r.on) ? r.off : r.on;
        TRACK3D_WHEEL_HUD_TUNE[r.key] = next;
        btn.textContent = String(next);
        reapply();
      });
      refs[r.key] = { row, btn };
    }
    rowsEl.appendChild(row);
  }

  panel.querySelector("[data-act=close]").addEventListener("click", () => {
    panel.style.display = "none";
  });

  panel.querySelector("[data-act=copy]").addEventListener("click", () => {
    const lines = [];
    lines.push("const TRACK3D_WHEEL_HUD_TUNE = {");
    for (const r of rows) {
      const v = TRACK3D_WHEEL_HUD_TUNE[r.key];
      const fmt = (typeof v === "number") ? v.toFixed(3) : String(v);
      lines.push(`  ${r.key}: ${fmt},`);
    }
    lines.push("};");
    const text = lines.join("\n");
    navigator.clipboard?.writeText(text).then(
      () => { statusEl.textContent = "COPIED · paste into track3d/constants.js"; },
      () => { statusEl.textContent = "COPY FAILED · see console"; console.log(text); }
    );
    setTimeout(() => { statusEl.textContent = ""; }, 2400);
  });

  panel.querySelector("[data-act=reset]").addEventListener("click", () => {
    for (const r of rows) {
      const v = defaults[r.key];
      TRACK3D_WHEEL_HUD_TUNE[r.key] = v;
      const ref = refs[r.key];
      if (r.kind === "slider") {
        ref.input.value = v;
        ref.valEl.textContent = v.toFixed(3);
      } else {
        ref.btn.textContent = String(v);
      }
    }
    reapply();
    statusEl.textContent = "RESET";
    setTimeout(() => { statusEl.textContent = ""; }, 1200);
  });

  const toggle = () => {
    panel.style.display = (panel.style.display === "none") ? "block" : "none";
  };

  return { root: panel, toggle };
}

function paintLimiter(ctx, W, H) {
  // Flash the whole screen between yellow and dark every 250 ms.
  const phase = Math.floor(performance.now() / 250) % 2 === 0;
  ctx.fillStyle = phase ? "#ffb800" : "#1a1004";
  ctx.fillRect(20, 20, W - 40, H - 40);
  ctx.fillStyle = phase ? "#0b0b11" : "#ffb800";
  ctx.font = 'bold 160px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PIT", W / 2, H / 2 - 50);
  ctx.font = 'bold 56px "JetBrains Mono", monospace';
  ctx.fillText("LIMITER", W / 2, H / 2 + 80);
}

// ───────────────────────────────────────────────────────────────────────────
// POV HUD — shown only when cameraMode === "follow". Displays speed, gear,
// throttle/brake bars, DRS and compound for the pinned driver.
// ───────────────────────────────────────────────────────────────────────────

function buildPovHud(mount) {
  let hidden = false;

  // Tiny pill shown when HUD is hidden — click to restore.
  const pill = document.createElement("div");
  Object.assign(pill.style, {
    position: "absolute", right: "12px", bottom: "44px",
    display: "none",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "9px", fontWeight: 800, letterSpacing: "0.18em",
    color: "rgba(180,180,200,0.7)",
    padding: "4px 10px",
    background: "linear-gradient(135deg, rgba(11,11,17,0.6) 0%, rgba(20,22,34,0.5) 50%, rgba(11,11,17,0.6) 100%)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderTopColor: "rgba(255,255,255,0.12)",
    borderRadius: "4px",
    backdropFilter: "blur(12px) saturate(1.4)",
    WebkitBackdropFilter: "blur(12px) saturate(1.4)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
    cursor: "pointer", pointerEvents: "auto",
    zIndex: 4, userSelect: "none",
  });
  pill.textContent = "SHOW HUD [H]";
  pill.addEventListener("click", () => { hidden = false; syncVisibility(); });
  mount.appendChild(pill);

  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "absolute", left: "50%", bottom: "54px",
    transform: "translateX(-50%)",
    display: "none",
    fontFamily: "JetBrains Mono, monospace",
    color: "#f4f4f8",
    padding: "10px 16px",
    background: "linear-gradient(135deg, rgba(11,11,17,0.65) 0%, rgba(20,22,34,0.55) 50%, rgba(11,11,17,0.65) 100%)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderTopColor: "rgba(255,255,255,0.12)",
    borderRadius: "8px",
    backdropFilter: "blur(16px) saturate(1.4)",
    WebkitBackdropFilter: "blur(16px) saturate(1.4)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,30,0,0.2)",
    pointerEvents: "none",
    zIndex: 4,
    minWidth: "360px",
    textAlign: "center",
  });
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:18px;">
      <div style="text-align:left;">
        <div style="font-size:9px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;">CODE</div>
        <div data-hud="code" style="font-size:18px;font-weight:800;letter-spacing:0.04em;">—</div>
      </div>
      <div>
        <div style="font-size:9px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;">SPEED</div>
        <div style="display:flex;align-items:baseline;gap:6px;justify-content:center;">
          <div data-hud="speed" style="font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;">000</div>
          <div style="font-size:10px;color:rgba(180,180,200,0.6);letter-spacing:0.14em;">KPH</div>
        </div>
      </div>
      <div>
        <div style="font-size:9px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;">GEAR</div>
        <div data-hud="gear" style="font-size:30px;font-weight:800;color:#ff1e00;font-variant-numeric:tabular-nums;">—</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;min-width:120px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="font-size:8px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;width:24px;">THR</div>
          <div style="height:6px;background:rgba(255,255,255,0.08);flex:1;">
            <div data-hud="thr" style="height:100%;background:#1eff6a;width:0%;transition:width 60ms linear;"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="font-size:8px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;width:24px;">BRK</div>
          <div style="height:6px;background:rgba(255,255,255,0.08);flex:1;">
            <div data-hud="brk" style="height:100%;background:#ff1e00;width:0%;transition:width 60ms linear;"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="font-size:8px;color:rgba(180,180,200,0.55);letter-spacing:0.18em;width:24px;">RPM</div>
          <div style="height:6px;background:rgba(255,255,255,0.08);flex:1;">
            <div data-hud="rpm" style="height:100%;background:linear-gradient(90deg,#1eff6a 0%,#ffb400 60%,#ff1e00 100%);width:0%;transition:width 60ms linear;"></div>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div data-hud="drs" style="
          font-size:10px;font-weight:800;letter-spacing:0.18em;
          padding:2px 7px;
          background:rgba(0,217,255,0.08);
          color:rgba(0,217,255,0.35);
          border:1px solid rgba(0,217,255,0.2);
        ">DRS</div>
        <div data-hud="tyre" style="
          font-size:10px;font-weight:800;letter-spacing:0.18em;
          padding:2px 7px;
          background:rgba(255,217,58,0.1);
          color:#ffd93a;
          border:1px solid rgba(255,217,58,0.3);
        ">—</div>
      </div>
      <div data-hud="hide" style="
        font-size:8px;font-weight:700;letter-spacing:0.14em;
        padding:2px 6px;
        color:rgba(180,180,200,0.4);
        border:1px solid rgba(255,255,255,0.06);
        border-radius:3px;
        cursor:pointer;
        pointer-events:auto;
        user-select:none;
      " title="Hide HUD [H]">HIDE</div>
    </div>
  `;
  mount.appendChild(root);

  // Toggle logic
  const syncVisibility = () => {
    if (hidden) {
      root.style.display = "none";
      pill.style.display = "block";
    } else {
      root.style.display = "block";
      pill.style.display = "none";
    }
  };
  const hideBtn = root.querySelector("[data-hud=hide]");
  if (hideBtn) hideBtn.addEventListener("click", () => { hidden = true; syncVisibility(); });

  const q = (sel) => root.querySelector(sel);
  return {
    root,
    pill,
    code: q("[data-hud=code]"),
    speed: q("[data-hud=speed]"),
    gear: q("[data-hud=gear]"),
    thr: q("[data-hud=thr]"),
    brk: q("[data-hud=brk]"),
    rpm: q("[data-hud=rpm]"),
    drs: q("[data-hud=drs]"),
    tyre: q("[data-hud=tyre]"),
    isHidden: () => hidden,
    toggle: () => { hidden = !hidden; syncVisibility(); },
    show: () => { hidden = false; syncVisibility(); },
    hide: () => { hidden = true; syncVisibility(); },
  };
}

function updatePovHud(hud, standing, compoundInfo) {
  if (!standing) { hud.root.style.display = "none"; hud.pill.style.display = "none"; return; }
  if (hud.isHidden()) { hud.root.style.display = "none"; hud.pill.style.display = "block"; return; }
  hud.root.style.display = "block";
  hud.pill.style.display = "none";
  hud.code.textContent = standing.driver.code;
  hud.speed.textContent = String(Math.round(standing.speedKph || 0)).padStart(3, "0");
  // Read telemetry directly off the (enriched) standing object — it preserves
  // the raw frame fields, so we skip an extra `.find()` per frame.
  const gear = standing.gear ?? null;
  const throttlePct = standing.throttle_pct ?? 0;
  const brakePct = standing.brake_pct ?? 0;
  const rpm = standing.rpm ?? 0;
  const drsOn = !!standing.in_drs;
  hud.gear.textContent = standing.status === "PIT" ? "P" : (gear == null ? "—" : String(gear));
  hud.thr.style.width = `${Math.max(0, Math.min(100, throttlePct))}%`;
  hud.brk.style.width = `${Math.max(0, Math.min(100, brakePct))}%`;
  if (hud.rpm) {
    const rpmNorm = Math.max(0, Math.min(100, (rpm - 4000) / 110));
    hud.rpm.style.width = `${rpmNorm}%`;
  }
  hud.drs.style.background = drsOn ? "rgba(0,217,255,0.3)" : "rgba(0,217,255,0.08)";
  hud.drs.style.color = drsOn ? "#00d9ff" : "rgba(0,217,255,0.35)";
  hud.drs.style.borderColor = drsOn ? "#00d9ff" : "rgba(0,217,255,0.2)";
  if (compoundInfo) {
    hud.tyre.textContent = `${compoundInfo.label} · ${standing.tyreAge}L`;
    hud.tyre.style.background = `${compoundInfo.color}22`;
    hud.tyre.style.color = compoundInfo.color;
    hud.tyre.style.borderColor = `${compoundInfo.color}66`;
  }
}

export {
  buildWheelHud,
  buildWheelHudDebugPanel,
  buildPovHud,
  updatePovHud,
};

// Top bar, timeline, controls, tweaks.

const { SECTORS } = window.DELTA;

function TopBar({ session, lap, totalLaps, clock, weather, flagState, safetyCar, extras, leading }) {
  const T = window.THEME;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: 16,
      padding: "10px 18px",
      background: "linear-gradient(180deg, rgba(11,11,17,0.98), rgba(11,11,17,0.9))",
      borderBottom: T.borderHot,
      fontFamily: T.mono,
      alignItems: "center",
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {leading}
        {/* Logo mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 18 L8 4 L14 4 L10 12 L20 12 L18 18 Z" fill={T.hot}/>
          </svg>
          <div>
            <div style={{ fontSize: T.fs.sm, fontWeight: 800, color: T.text, letterSpacing: T.ls.wide }}>DELTA · PITWALL</div>
            <div style={{ fontSize: 8, color: T.textDim, letterSpacing: T.ls.wide }}>RACE ENGINEER CONSOLE</div>
          </div>
        </div>
        <Divider/>
        <MetaItem label="EVENT" value={session.event}/>
        <MetaItem label="SESSION" value={session.name}/>
        <MetaItem label="CIRCUIT" value={session.circuit}/>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 18 }}>
        <FlagBadge state={flagState} safetyCar={safetyCar}/>
        <BigMeta label="LAP" value={`${String(lap).padStart(2, "0")}/${totalLaps}`} accent={T.hot}/>
        <BigMeta label="RACE TIME" value={clock}/>
        <BigMeta label="AIR" value={`${weather.air}°`}/>
        <BigMeta label="TRACK" value={`${weather.track}°`}/>
        <BigMeta label="HUM" value={`${weather.hum}%`}/>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {extras}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }}/>;
}

function MetaItem({ label, value }) {
  const T = window.THEME;
  return (
    <div style={{ lineHeight: 1.1 }}>
      <div style={{ fontSize: 8, color: T.textFaint, letterSpacing: T.ls.wide }}>{label}</div>
      <div style={{ fontSize: T.fs.sm, color: T.text, fontWeight: 600, letterSpacing: T.ls.body }}>{value}</div>
    </div>
  );
}

function BigMeta({ label, value, accent }) {
  const T = window.THEME;
  return (
    <div style={{ textAlign: "center", lineHeight: 1.05 }}>
      <div style={{ fontSize: 8, color: T.textDim, letterSpacing: T.ls.caps }}>{label}</div>
      <div style={{ fontSize: T.fs.lg, color: accent || T.textStrong, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: T.ls.tight }}>{value}</div>
    </div>
  );
}

function LiveDot() {
  const T = window.THEME;
  return (
    <div style={{ position: "relative", width: 8, height: 8 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: T.good }}/>
      <div style={{ position: "absolute", inset: -3, borderRadius: 7, background: T.good, opacity: 0.3, animation: "deltaPulse 1.6s infinite" }}/>
    </div>
  );
}

function FlagBadge({ state, safetyCar }) {
  const T = window.THEME;
  let label = "GREEN", bg = T.good, fg = "#0B0B11";
  if (state === "vsc") { label = "VIRTUAL SC"; bg = T.caution; }
  else if (safetyCar || state === "sc") { label = "SAFETY CAR"; bg = T.caution; }
  else if (state === "yellow") { label = "YELLOW"; bg = T.warn; }
  else if (state === "red") { label = "RED FLAG"; bg = T.hot; fg = "#FFFFFF"; }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{
        padding: "4px 10px",
        background: bg, color: fg,
        fontSize: T.fs.sm, fontWeight: 800,
        letterSpacing: T.ls.wide,
        fontFamily: T.mono,
      }}>
        {label}
      </div>
      {state === "yellow" && safetyCar && (
        <div style={{
          padding: "4px 10px",
          background: T.caution, color: "#0B0B11",
          fontSize: T.fs.sm, fontWeight: 800,
          letterSpacing: T.ls.wide,
          fontFamily: T.mono,
        }}>
          SC
        </div>
      )}
    </div>
  );
}

// Bottom timeline
function Timeline({ t, setT, playing, setPlaying, speed, setSpeed, lap, totalLaps, safetyCarEvents }) {
  const T = window.THEME;
  const trackRef = React.useRef(null);
  const [drag, setDrag] = React.useState(false);
  const [scrubT, setScrubT] = React.useState(null);
  const scrubRef = React.useRef(null);
  const lastSeekRef = React.useRef(0);
  const pendingSeekRef = React.useRef(null);
  const seekTimerRef = React.useRef(null);
  const setTRef = React.useRef(setT);
  React.useEffect(() => { setTRef.current = setT; }, [setT]);

  const SCRUB_THROTTLE_MS = 60;

  const flushSeek = () => {
    if (pendingSeekRef.current === null) return;
    const v = pendingSeekRef.current;
    pendingSeekRef.current = null;
    lastSeekRef.current = performance.now();
    setTRef.current(v);
  };

  const requestSeek = (val) => {
    pendingSeekRef.current = val;
    const now = performance.now();
    const wait = SCRUB_THROTTLE_MS - (now - lastSeekRef.current);
    if (wait <= 0) {
      flushSeek();
    } else if (seekTimerRef.current == null) {
      seekTimerRef.current = setTimeout(() => {
        seekTimerRef.current = null;
        flushSeek();
      }, wait);
    }
  };

  const from = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const start = (clientX) => {
    const val = from(clientX);
    setDrag(true);
    setScrubT(val);
    scrubRef.current = val;
    requestSeek(val);
  };

  const move = (clientX) => {
    const val = from(clientX);
    setScrubT(val);
    scrubRef.current = val;
    requestSeek(val);
  };

  const end = () => {
    if (seekTimerRef.current != null) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    if (scrubRef.current !== null) {
      pendingSeekRef.current = scrubRef.current;
      flushSeek();
    }
    setScrubT(null);
    scrubRef.current = null;
    setDrag(false);
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMove = (e) => move(e.clientX);
    const onUp = () => end();
    const onTouchMove = (e) => move(e.touches[0].clientX);
    const onTouchEnd = () => end();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [drag]);

  const displayT = scrubT !== null ? scrubT : t;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: 18, alignItems: "center",
      padding: "10px 18px",
      background: "linear-gradient(180deg, rgba(11,11,17,0.85), rgba(11,11,17,0.98))",
      borderTop: T.border,
      fontFamily: T.mono,
    }}>
      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TransportBtn onClick={() => setT(Math.max(0, t - 0.02))} title="Rewind">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2v8M11 2L4 6l7 4V2z" fill={T.text}/></svg>
        </TransportBtn>
        <TransportBtn primary onClick={() => setPlaying(!playing)} title="Play/Pause">
          {playing
            ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="2" width="2.2" height="8" fill="#FFFFFF"/><rect x="6.8" y="2" width="2.2" height="8" fill="#FFFFFF"/></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2l7 4-7 4V2z" fill="#FFFFFF"/></svg>
          }
        </TransportBtn>
        <TransportBtn onClick={() => setT(Math.min(1, t + 0.02))} title="Forward">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M10 2v8M1 2l7 4-7 4V2z" fill={T.text}/></svg>
        </TransportBtn>
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 6px" }}/>
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} style={{
            padding: "4px 8px",
            fontFamily: T.mono,
            fontSize: T.fs.sm, fontWeight: 700, letterSpacing: T.ls.label,
            background: speed === s ? T.hot : "transparent",
            color: speed === s ? "#FFFFFF" : T.textMuted,
            border: `1px solid ${speed === s ? T.hot : "rgba(255,255,255,0.08)"}`,
            cursor: "pointer",
          }}>{s}x</button>
        ))}
      </div>

      {/* Scrub */}
      <div
        ref={trackRef}
        onMouseDown={(e) => start(e.clientX)}
        onTouchStart={(e) => start(e.touches[0].clientX)}
        style={{
          position: "relative",
          height: 42,
          cursor: "pointer",
          display: "flex", alignItems: "center",
        }}>
        {/* Lap ticks */}
        <div style={{ position: "absolute", inset: "0 0 auto 0", top: 6, height: 2, background: "rgba(255,255,255,0.04)" }}/>
        <div style={{ position: "absolute", inset: "auto 0 6px 0", height: 14, background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}/>
        {(() => { const safeTotalLaps = Math.max(totalLaps, 1); return Array.from({ length: safeTotalLaps + 1 }).map((_, i) => {
          const pct = (i / safeTotalLaps) * 100;
          const major = i % 10 === 0;
          return (
            <div key={i} style={{
              position: "absolute", left: `${pct}%`, bottom: 6,
              width: 1, height: major ? 14 : 7,
              background: major ? "rgba(230,230,239,0.35)" : "rgba(230,230,239,0.12)",
            }}/>
          );
        }); })()}
        {(() => { const safeTotalLaps = Math.max(totalLaps, 1); return Array.from({ length: Math.floor(safeTotalLaps / 10) + 1 }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", left: `${(i * 10 / safeTotalLaps) * 100}%`,
            top: 0, fontSize: 8, color: T.textDim,
            transform: "translateX(-50%)",
            letterSpacing: T.ls.label,
          }}>L{i * 10 || 1}</div>
        )); })()}
        {/* SC zones */}
        {safetyCarEvents.map((e, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${e.start * 100}%`,
            width: `${(e.end - e.start) * 100}%`,
            top: 18, bottom: 8,
            background: "rgba(255,184,0,0.22)",
            borderLeft: `2px solid ${T.caution}`,
            borderRight: `2px solid ${T.caution}`,
          }}>
            <div style={{
              position: "absolute", top: -11, left: 0,
              background: T.caution, color: "#0B0B11",
              fontSize: 7, fontWeight: 800, letterSpacing: T.ls.caps,
              padding: "1px 4px",
            }}>SC</div>
          </div>
        ))}
        {/* Progress fill */}
        <div style={{
          position: "absolute", left: 0, top: 6,
          width: `${displayT * 100}%`, height: 2,
          background: T.hot,
          boxShadow: `0 0 6px ${T.hot}`,
        }}/>
        {/* Playhead */}
        <div style={{
          position: "absolute", left: `${displayT * 100}%`, top: 0, bottom: 0,
          width: 2, background: T.hot,
          boxShadow: `0 0 8px ${T.hot}`,
          transform: "translateX(-1px)",
        }}>
          <div style={{
            position: "absolute", top: -4, left: -5,
            width: 12, height: 6,
            background: T.hot,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}/>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: T.fs.sm }}>
        <div style={{ color: T.textMuted, letterSpacing: T.ls.label }}>LAP</div>
        <div style={{ color: T.textStrong, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: T.fs.lg }}>
          {String(lap).padStart(2, "0")}/{totalLaps}
        </div>
      </div>
    </div>
  );
}

function TransportBtn({ children, onClick, title, primary }) {
  const T = window.THEME;
  const [h, setH] = React.useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        width: primary ? 32 : 26, height: 26,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: primary ? (h ? "#FF3A1E" : T.hot) : (h ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)"),
        border: primary ? `1px solid ${T.hot}` : "1px solid rgba(255,255,255,0.08)",
        color: "#FFFFFF", cursor: "pointer", padding: 0,
      }}>
      {children}
    </button>
  );
}

// Camera controls
function CameraControls({
  rotateX,
  setRotateX,
  rotateZ,
  setRotateZ,
  zoom,
  setZoom,
  showLabels,
  setShowLabels,
  viewMode,
  setViewMode,
  collapsed,
  setCollapsed,
  miniMapVisible,
  setMiniMapVisible,
}) {
  const T = window.THEME;
  const [quality, setQuality] = React.useState(() => window.DELTA?.QUALITY || "high");
  const isTop = viewMode === "top";
  if (collapsed) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: 6,
        background: T.surface2,
        border: T.border,
        padding: 6,
        fontFamily: T.mono,
        fontSize: T.fs.xs,
      }}>
        <button onClick={() => setCollapsed(false)} style={{
          padding: "4px 8px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "rgba(230,230,239,0.78)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: T.fs.xs,
          fontWeight: 700,
          letterSpacing: T.ls.caps,
        }}>
          CAMERA <span style={{ opacity: 0.5 }}>[C]</span>
        </button>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      background: T.surface2,
      border: T.border,
      padding: 10,
      fontFamily: T.mono,
      fontSize: T.fs.xs,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ color: T.textDim, letterSpacing: T.ls.caps }}>CAMERA</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {setCollapsed && (
            <button onClick={() => setCollapsed(true)} style={{
              padding: "2px 6px", background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(180,180,200,0.7)", cursor: "pointer",
              fontFamily: "inherit", fontSize: 8, letterSpacing: T.ls.caps,
            }}>HIDE <span style={{ opacity: 0.55 }}>[C]</span></button>
          )}
          <button onClick={() => { setRotateX(62); setRotateZ(-18); setZoom(1); }} style={{
            padding: "2px 6px", background: "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(180,180,200,0.7)", cursor: "pointer",
            fontFamily: "inherit", fontSize: 8, letterSpacing: T.ls.caps,
          }}>RESET</button>
        </div>
      </div>
      {/* View mode toggle — segmented GL / SVG / CHASE / POV / TOP */}
      {setViewMode && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 2 }}>
          {[
            { k: "webgl",  label: "GL" },
            { k: "iso",    label: "SVG" },
            { k: "follow", label: "CHASE" },
            { k: "pov",    label: "POV" },
            { k: "top",    label: "TOP" },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setViewMode(k)} style={{
              padding: "4px 2px",
              background: viewMode === k ? T.hot : "transparent",
              color: viewMode === k ? "#FFFFFF" : "rgba(230,230,239,0.7)",
              border: `1px solid ${viewMode === k ? T.hot : "rgba(255,255,255,0.1)"}`,
              cursor: "pointer",
              fontFamily: "inherit", fontSize: T.fs.xs, fontWeight: 700, letterSpacing: T.ls.caps,
            }}>{label}</button>
          ))}
        </div>
      )}
      {/* Tilt/Rot/Zoom only meaningful for the legacy SVG view. */}
      {viewMode === "iso" || viewMode === "top" ? (<>
        <Slider label="TILT" value={rotateX} onChange={setRotateX} min={0} max={85} suffix="°" disabled={isTop}/>
        <Slider label="ROT"  value={rotateZ} onChange={setRotateZ} min={-180} max={180} suffix="°"/>
        <Slider label="ZOOM" value={zoom*100} onChange={(v) => setZoom(v/100)} min={50} max={400} suffix="%"/>
      </>) : null}
      {(viewMode === "webgl" || viewMode === "follow" || viewMode === "pov") && (
        <div style={{ display: "grid", gridTemplateColumns: "50px 1fr", gap: 6, alignItems: "center" }}>
          <div style={{ color: T.textDim, letterSpacing: T.ls.label }}>QUALITY</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {["low", "med", "high"].map((q) => (
              <button key={q} onClick={() => {
                window.DELTA.setQuality?.(q);
                setQuality(q);
              }} style={{
                padding: "4px 2px",
                background: quality === q ? T.hot : "transparent",
                color: quality === q ? "#FFFFFF" : "rgba(230,230,239,0.7)",
                border: `1px solid ${quality === q ? T.hot : "rgba(255,255,255,0.1)"}`,
                cursor: "pointer",
                fontFamily: "inherit", fontSize: T.fs.xs, fontWeight: 700, letterSpacing: T.ls.caps,
              }}>{q.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "4px 0" }}/>
      <Toggle label="LABELS"       on={showLabels}   onChange={setShowLabels} hotkey="L"/>
      {setMiniMapVisible && (
        <Toggle label="FIELD MAP" on={!!miniMapVisible} onChange={setMiniMapVisible} hotkey="N"/>
      )}
    </div>
  );
}

function Slider({ label, value, onChange, min, max, suffix = "", disabled = false }) {
  const T = window.THEME;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 38px", gap: 6, alignItems: "center", opacity: disabled ? 0.35 : 1 }}>
      <div style={{ color: T.textDim, letterSpacing: T.ls.label }}>{label}</div>
      <input type="range" min={min} max={max} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: T.hot, height: 2 }}/>
      <div style={{ color: T.text, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{Math.round(value)}{suffix}</div>
    </div>
  );
}

function Toggle({ label, on, onChange, hotkey }) {
  const T = window.THEME;
  return (
    <button onClick={() => onChange(!on)} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "4px 2px",
      background: "transparent", border: "none",
      color: on ? T.text : T.textDim,
      fontFamily: "inherit", fontSize: T.fs.xs,
      letterSpacing: T.ls.label,
      cursor: "pointer", width: "100%",
    }}>
      <span>{label} {hotkey && <span style={{ opacity: 0.5 }}>[{hotkey}]</span>}</span>
      <span style={{
        width: 22, height: 10, background: on ? T.hot : "rgba(255,255,255,0.08)",
        position: "relative",
        boxShadow: on ? "0 0 6px rgba(255,30,0,0.6)" : "none",
      }}>
        <span style={{
          position: "absolute", top: 1, left: on ? 13 : 1,
          width: 8, height: 8, background: "#FFFFFF",
          transition: "left 120ms",
        }}/>
      </span>
    </button>
  );
}

window.TopBar = TopBar;
window.Timeline = Timeline;
window.CameraControls = CameraControls;

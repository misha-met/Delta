// Top-level app — stitches it all together.

const { CIRCUIT, computeStandings, telemetryFor } = window.DELTA;
const { buildHotkeyHandler } = window.DELTA_HOTKEY;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#FF1E00",
  "density": "engineer",
  "tiltDefault": 62,
  "rotateDefault": -18
}/*EDITMODE-END*/;

function fmtRcTime(secs) {
  if (secs == null) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(6,"0")}`;
}

function App() {
  // Live data from WS
  const { frame, rc, playback, snapshot, trackStatuses } = window.LIVE.useLive();

  // Server-authoritative state
  // t must be 0–1 fraction for Timeline scrub bar; backend sends total_frames
  const totalFrames = frame?.total_frames ?? snapshot?.total_frames ?? 1;
  const t = frame?.frame_index != null ? frame.frame_index / Math.max(totalFrames - 1, 1) : 0;
  const tSeconds = frame?.t_seconds ?? frame?.t ?? 0;
  const totalLaps = frame?.total_laps ?? snapshot?.total_laps ?? 1;
  const lap = frame?.lap ?? 1;
  const clock = frame?.clock ?? "00:00:00";
  const flagState = frame?.flag_state ?? "green";
  const weatherRaw = frame?.weather ?? {};
  const weather = {
    air: Math.round(weatherRaw.air_temp ?? 0),
    track: Math.round(weatherRaw.track_temp ?? 0),
    hum: Math.round(weatherRaw.humidity ?? 0),
    rainState: weatherRaw.rain_state || "DRY",
    windSpeed: weatherRaw.wind_speed ?? 0,
    windDirection: weatherRaw.wind_direction ?? 0,
  };
  const isPaused = playback?.is_paused ?? true;
  const speed = playback?.speed ?? 1;

  // Session info from snapshot
  const ev = snapshot?.event;
  const SESSION = {
    event: ev ? `${ev.year} · R${ev.round} · ${ev.event_name}` : "LOADING...",
    name: "RACE",
    circuit: ev ? [ev.circuit_name, snapshot?.geometry?.total_length_m ? ((snapshot.geometry.total_length_m * window.DELTA.UNIT_SCALE) / 1000).toFixed(3) + "KM" : ""].filter(Boolean).join(" · ") : "",
  };

  // Selections
  const [pinned, setPinned] = React.useState(null);
  const [secondary, setSecondary] = React.useState(null);

  const isOutOfPlayStanding = React.useCallback((s) => {
    const badge = String(s?.labelStatus || "").trim().toUpperCase();
    return s?.status === "OUT" || badge === "RET" || badge === "ACC";
  }, []);

  // Camera
  const [rotateX, setRotateX] = React.useState(TWEAK_DEFAULTS.tiltDefault);
  const [rotateZ, setRotateZ] = React.useState(TWEAK_DEFAULTS.rotateDefault);
  const [zoom, setZoom] = React.useState(1);
  const [cameraControlsCollapsed, setCameraControlsCollapsed] = React.useState(false);

  // View mode: "webgl" (Three.js 3D), "follow" (WebGL chase cam), "iso" (legacy SVG 3D),
  // or "top" (2D top-down). Persist across reloads. Default = webgl.
  const [viewMode, setViewModeRaw] = React.useState(() => {
    try { return localStorage.getItem("delta.viewMode") || localStorage.getItem("apex.viewMode") || "webgl"; } catch { return "webgl"; }
  });
  const setViewMode = React.useCallback((mode) => {
    setViewModeRaw(mode);
    // POV/CHASE have no use for TILT/ROT/ZOOM — collapse the panel to clear the view.
    // Switching away from those modes restores the panel.
    if (mode === "pov" || mode === "follow") {
      setCameraControlsCollapsed(true);
    } else {
      setCameraControlsCollapsed(false);
    }
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem("delta.viewMode", viewMode); } catch {}
  }, [viewMode]);
  // Sync initial collapse state on first load.
  React.useEffect(() => {
    if (viewMode === "pov" || viewMode === "follow") setCameraControlsCollapsed(true);
  }, []);

  // Toggles
  const [showLabels, setShowLabels] = React.useState(true);
  const [miniMapVisible, setMiniMapVisible] = React.useState(() => {
    try {
      const stored = localStorage.getItem("delta.miniMapVisible");
      return stored != null ? stored === "1" : localStorage.getItem("apex.miniMapVisible") === "1";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try { localStorage.setItem("delta.miniMapVisible", miniMapVisible ? "1" : "0"); } catch {}
  }, [miniMapVisible]);
  const [compareChannel, setCompareChannel] = React.useState("speed");
  const [geometryVersion, setGeometryVersion] = React.useState(() => window.DELTA?.geometryVersion || 0);

  React.useEffect(() => {
    const onGeometryVersion = (e) => {
      setGeometryVersion(e.detail?.version ?? (window.DELTA?.geometryVersion || 0));
    };
    window.addEventListener("delta:geometry-version", onGeometryVersion);
    return () => window.removeEventListener("delta:geometry-version", onGeometryVersion);
  }, []);

  // Arc-length cache for CIRCUIT so safety-car mapping doesn't rebuild O(n)
  // cumulative lengths every render.
  const circuitArc = React.useMemo(() => {
    const n = CIRCUIT.length;
    const cumLen = new Float64Array(n);
    let totalLen = 0;
    for (let i = 1; i < n; i++) {
      const dx = CIRCUIT[i].x - CIRCUIT[i - 1].x;
      const dy = CIRCUIT[i].y - CIRCUIT[i - 1].y;
      totalLen += Math.sqrt(dx * dx + dy * dy);
      cumLen[i] = totalLen;
    }
    return { cumLen, totalLen };
  }, [geometryVersion, snapshot?.geometry]);

  // Tweaks
  const [tweaksOn, setTweaksOn] = React.useState(false);
  const [accent, setAccent] = React.useState(TWEAK_DEFAULTS.accent);

  // Playback controls → POST to server
  const togglePlay = () => {
    if (isPaused) window.DELTA_CLIENT.post("/api/playback/play");
    else window.DELTA_CLIENT.post("/api/playback/pause");
  };
  const setSpeedRemote = (s) => {
    window.DELTA_CLIENT.post("/api/playback/speed", { speed: s });
  };
  const seekRemote = (tVal) => {
    window.DELTA_CLIENT.post("/api/playback/seek", { t: tVal });
  };

  // Refs for stable hotkey handler (avoids re-subscribing every frame)
  const tRef = React.useRef(t);
  const speedRef = React.useRef(speed);
  const isPausedRef = React.useRef(isPaused);
  React.useEffect(() => { tRef.current = t; }, [t]);
  React.useEffect(() => { speedRef.current = speed; }, [speed]);
  React.useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // Hotkeys — listener registered once, reads from refs
  React.useEffect(() => {
    const onKey = buildHotkeyHandler(
      { t: tRef, speed: speedRef, isPaused: isPausedRef },
      window.DELTA_CLIENT.post.bind(window.DELTA_CLIENT),
      togglePlay,
      seekRemote,
      setSpeedRemote,
      setShowLabels,
      setViewMode,
      () => setCameraControlsCollapsed((v) => !v),
      () => { if (window.DELTA_HUD_TOGGLE?.current) window.DELTA_HUD_TOGGLE.current(); },
      () => setMiniMapVisible((v) => !v),
    );
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tweaks protocol
  React.useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "__activate_edit_mode")   setTweaksOn(true);
      if (e.data.type === "__deactivate_edit_mode") setTweaksOn(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Compute race state from live frame using backend ordering/positions.
  const standings = React.useMemo(() => computeStandings(t, lap, totalLaps), [frame]);

  // Auto-pin first active driver when selection is empty.
  React.useEffect(() => {
    if (pinned || standings.length === 0) return;
    const firstActive = standings.find((s) => !isOutOfPlayStanding(s));
    if (firstActive) setPinned(firstActive.driver.code);
  }, [standings, pinned, isOutOfPlayStanding]);

  // Keep pin/secondary attached to active, selectable drivers only.
  React.useEffect(() => {
    if (!standings.length) return;
    const byCode = new Map(standings.map((s) => [s.driver.code, s]));
    const firstActive = standings.find((s) => !isOutOfPlayStanding(s))?.driver.code ?? null;

    if (pinned) {
      const ps = byCode.get(pinned);
      if (!ps || isOutOfPlayStanding(ps)) {
        setPinned(firstActive);
      }
    }
    if (secondary) {
      const ss = byCode.get(secondary);
      if (!ss || isOutOfPlayStanding(ss) || secondary === pinned) {
        setSecondary(null);
      }
    }
  }, [standings, pinned, secondary, isOutOfPlayStanding]);
  const bestLapCode = standings.length > 0
    ? standings.reduce((a, b) => {
      const av = a.bestLap > 0 ? a.bestLap : Infinity;
      const bv = b.bestLap > 0 ? b.bestLap : Infinity;
      return av <= bv ? a : b;
    }).driver.code
    : null;

  // Playhead within lap: use pinned driver's true fraction from backend,
  // which correctly handles SC/pit laps (unlike t * totalLaps % 1).
  const tWithinLap = React.useMemo(() => {
    if (pinned) {
      const entry = standings.find(s => s.driver.code === pinned);
      if (entry?.fraction != null) return entry.fraction % 1;
    }
    return totalLaps > 0 ? (t * totalLaps) % 1 : 0;
  }, [standings, pinned, t, totalLaps]);

  // Safety car events for Timeline: convert track_statuses to {start, end} fractions
  const SC_LABELS = new Set(["sc", "vsc", "red"]);
  const totalDurationS = snapshot?.total_duration_s || 0;
  const safetyCarEvents = React.useMemo(() => {
    if (!trackStatuses?.length || totalDurationS <= 0) return [];
    return trackStatuses
      .filter((e) => SC_LABELS.has(e.status))
      .map((e) => ({
        start: e.start_time / totalDurationS,
        end: (e.end_time ?? totalDurationS) / totalDurationS,
      }));
  }, [trackStatuses, totalDurationS]);

  // Safety car from live frame — project world coords to arc-length fraction (0-1)
  let safetyCar = null;
  const scData = frame?.safety_car;
  if (scData) {
    const n = CIRCUIT.length;
    // Find nearest CIRCUIT index by XY distance.
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = CIRCUIT[i].x - (scData.x || 0);
      const dy = CIRCUIT[i].y - (scData.y || 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; bestIdx = i; }
    }
    // Convert index to arc-length fraction using cumulative chord lengths so
    // Track3D's arc-length-parameterised curve (getPointAt) gets the right u.
    let fraction = 0;
    if (n > 1) {
      fraction = circuitArc.totalLen > 0 ? circuitArc.cumLen[bestIdx] / circuitArc.totalLen : 0;
    }
    safetyCar = { trackIdx: bestIdx, fraction, phase: scData.phase || "on_track", alpha: scData.alpha ?? 1, pulse: tSeconds * 60 };
  }

  // Race control feed from WS
  const FEED = (rc || []).map((m) => {
    const cat = (m.category || "").toUpperCase();
    const flag = (m.flag || "").toUpperCase();
    let tag = "INFO";
    if (cat.includes("FLAG") || flag.includes("YELLOW") || flag.includes("RED") || flag.includes("BLACK")) tag = "FLAG";
    if (cat.includes("SAFETY") || flag.includes("SC")) tag = "SC";
    if (cat.includes("DRS")) tag = "DRS";
    return {
      time: fmtRcTime(m.time),
      tag,
      msg: m.message || "",
    };
  });

  const primaryData = telemetryFor(pinned, t);
  const secondaryData = secondary ? telemetryFor(secondary, t) : null;

  const onPick = (code) => {
    const selected = standings.find((s) => s.driver.code === code);
    if (!selected || isOutOfPlayStanding(selected)) return;
    if (code === pinned) { setPinned(secondary); setSecondary(null); }
    else setPinned(code);
  };
  const onShiftPick = (code) => {
    const selected = standings.find((s) => s.driver.code === code);
    if (!selected || isOutOfPlayStanding(selected)) return;
    if (code === pinned) return;
    if (code === secondary) setSecondary(null);
    else setSecondary(code);
  };

  // Panel layout (collapse / hide / maximize) — Tier 1.
  const layout = window.useLayout();
  const registry = window.PANEL_REGISTRY;

  // Panel body renderers — keyed by panel id. Used both for slotted render
  // and for MaximizedOverlay. Keeps props wiring in one place.
  const panelBodies = {
    leaderboard: (
      <Leaderboard
        standings={standings}
        pinned={pinned}
        secondary={secondary}
        onPick={onPick}
        onShiftPick={onShiftPick}
        bestLapCode={bestLapCode}
      />
    ),
    strategy: <StrategyStrip standings={standings} totalLaps={totalLaps} lap={lap} tWithinLap={tWithinLap}/>,
    compare: <CompareTraces pinned={pinned} secondary={secondary} lap={lap} channel={compareChannel} setChannel={setCompareChannel} tWithinLap={tWithinLap}/>,
    sectors: <SectorTimes pinned={pinned} secondary={secondary} lap={lap} standings={standings}/>,
    feed: <RaceFeed events={FEED}/>,
    driverCard: <DriverCard code={pinned} data={primaryData} accent={window.THEME.hot} standings={standings}/>,
    driverCard2: secondary
      ? <DriverCard code={secondary} data={secondaryData} accent={window.THEME.cool} secondary standings={standings}/>
      : <div style={{
          padding: 14, height: "100%",
          border: "1px dashed rgba(0,217,255,0.2)",
          fontFamily: window.THEME.mono,
          fontSize: window.THEME.fs.xs, color: "rgba(180,180,200,0.45)",
          letterSpacing: window.THEME.ls.caps, textAlign: "center",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>SHIFT + CLICK DRIVER TO COMPARE</div>,
    gap: <GapViz standings={standings} pinned={pinned}/>,
    gapHistory: <window.GapHistory pinned={pinned} secondary={secondary} onPick={onPick} onShiftPick={onShiftPick} lap={lap} tWithinLap={tWithinLap}/>,
    track: (
      <div className="scanline" style={{
        width: "100%", height: "100%", position: "relative",
        background: "linear-gradient(180deg, #0E0E16, #05050A)",
        border: window.THEME.border,
        overflow: "hidden",
      }}>
        {/* Flag state overlay — yellow wash during SC/VSC/yellow, red pulse during red flag */}
        {(() => {
          const cls = flagState === "red" ? "red"
            : (safetyCar || flagState === "sc") ? "sc"
            : flagState === "vsc" ? "vsc"
            : flagState === "yellow" ? "yellow"
            : null;
          return cls ? <div className={`delta-flag-layer ${cls}`}/> : null;
        })()}
        {/* Corner HUD (top-left) */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          display: "flex", flexDirection: "column", gap: 2,
          fontFamily: "JetBrains Mono, monospace",
          zIndex: 3,
          padding: "8px 12px 6px",
          background: "linear-gradient(135deg, rgba(11,11,17,0.55) 0%, rgba(20,22,34,0.45) 50%, rgba(11,11,17,0.55) 100%)",
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "6px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}>
          <div style={{ fontSize: 9, color: "rgba(180,180,200,0.55)", letterSpacing: "0.2em" }}>
            CIRCUIT VIEW · {
              viewMode === "top" ? "TOP" :
              viewMode === "follow" ? "CHASE" :
              viewMode === "pov" ? "POV" :
              viewMode === "webgl" ? "WEBGL" : "SVG 3D"
            }
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#F6F6FA", letterSpacing: "-0.02em" }}>
              {ev?.circuit_name?.toUpperCase() || "CIRCUIT"}
            </div>
            <div style={{ fontSize: 9, color: "#FF1E00", letterSpacing: "0.18em", padding: "2px 5px", border: "1px solid #FF1E00" }}>
              CW
            </div>
          </div>
          <div style={{ fontSize: 10, color: "rgba(180,180,200,0.55)", letterSpacing: "0.1em" }}>
            {snapshot?.geometry?.total_length_m ? `${((snapshot.geometry.total_length_m * window.DELTA.UNIT_SCALE) / 1000).toFixed(3)}KM` : ""}
          </div>
        </div>

        {/* Top-right HUD */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          display: "flex", flexDirection: "column", gap: 8,
          zIndex: 3,
        }}>
          <CameraControls
            rotateX={rotateX} setRotateX={setRotateX}
            rotateZ={rotateZ} setRotateZ={setRotateZ}
            zoom={zoom} setZoom={setZoom}
            showLabels={showLabels} setShowLabels={setShowLabels}
            viewMode={viewMode} setViewMode={setViewMode}
            collapsed={cameraControlsCollapsed}
            setCollapsed={setCameraControlsCollapsed}
            miniMapVisible={miniMapVisible}
            setMiniMapVisible={
              layout.maximized === "track"
              && (viewMode === "webgl" || viewMode === "follow" || viewMode === "pov")
                ? setMiniMapVisible : null
            }
          />
          {miniMapVisible
            && (viewMode === "webgl" || viewMode === "follow" || viewMode === "pov") && (
            <window.MiniMap
              standings={standings}
              pinned={pinned}
              secondary={secondary}
              onPickDriver={(code, e) => {
                if (e && e.shiftKey) onShiftPick(code);
                else onPick(code);
              }}
            />
          )}
        </div>

        {/* Corner ticks */}
        {["tl","tr","bl","br"].map((p) => (
          <div key={p} style={{
            position: "absolute", width: 16, height: 16, zIndex: 3,
            borderColor: "rgba(255,30,0,0.5)",
            borderStyle: "solid", borderWidth: 0,
            ...(p === "tl" ? { top: 4, left: 4,  borderTopWidth: 1, borderLeftWidth: 1 } :
               p === "tr" ? { top: 4, right: 4, borderTopWidth: 1, borderRightWidth: 1 } :
               p === "bl" ? { bottom: 4, left: 4, borderBottomWidth: 1, borderLeftWidth: 1 } :
                            { bottom: 4, right: 4, borderBottomWidth: 1, borderRightWidth: 1 }),
          }}/>
        ))}

        {(viewMode === "webgl" || viewMode === "follow" || viewMode === "pov") ? (
          <window.Track3D
            standings={standings}
            pinned={pinned}
            secondary={secondary}
            onPickDriver={(code, e) => {
              if (e && e.shiftKey) onShiftPick(code);
              else onPick(code);
            }}
            showLabels={showLabels}
            cameraMode={
              viewMode === "follow" ? "follow" :
              viewMode === "pov" ? "pov" : "orbit"
            }
            weather={weather}
            circuitName={ev?.circuit_name || ev?.event_name || ""}
            safetyCar={safetyCar}
          />
        ) : (
          <IsoTrack
            standings={standings}
            safetyCar={safetyCar}
            pinned={pinned}
            secondary={secondary}
            onPickDriver={(code, e) => {
              if (e && e.shiftKey) onShiftPick(code);
              else onPick(code);
            }}
            showLabels={showLabels}
            rotateX={rotateX}
            rotateZ={rotateZ}
            zoom={zoom}
            viewMode={viewMode}
          />
        )}

        {/* Bottom HUD: selected driver pip + compare toggle */}
        {pinned && (
          <div style={{
            position: "absolute", bottom: 12, left: 12,
            fontFamily: "JetBrains Mono, monospace",
            display: "flex", alignItems: "center", gap: 10,
            padding: "6px 10px",
            background: "linear-gradient(135deg, rgba(11,11,17,0.6) 0%, rgba(20,22,34,0.5) 50%, rgba(11,11,17,0.6) 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderTopColor: "rgba(255,255,255,0.12)",
            borderRadius: "6px",
            backdropFilter: "blur(12px) saturate(1.4)",
            WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(255,30,0,0.2)",
            zIndex: 3,
          }}>
            <div style={{ width: 6, height: 6, background: "#FF1E00", boxShadow: "0 0 6px #FF1E00" }}/>
            <div style={{ fontSize: 10, color: "rgba(180,180,200,0.6)", letterSpacing: "0.14em" }}>PINNED</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#F6F6FA" }}>{pinned}</div>
            {secondary && (
              <React.Fragment>
                <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.1)" }}/>
                <div style={{ width: 6, height: 6, background: "#00D9FF", boxShadow: "0 0 6px #00D9FF" }}/>
                <div style={{ fontSize: 10, color: "rgba(180,180,200,0.6)", letterSpacing: "0.14em" }}>COMPARE</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#F6F6FA" }}>{secondary}</div>
              </React.Fragment>
            )}
            <div style={{ fontSize: 9, color: "rgba(180,180,200,0.45)", letterSpacing: "0.1em", paddingLeft: 10 }}>
              CLICK · PIN ·  SHIFT+CLICK · COMPARE
            </div>
          </div>
        )}

        {/* Bottom HUD: scan indicator */}
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9, color: "rgba(180,180,200,0.55)",
          letterSpacing: "0.14em", zIndex: 3,
          display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
          padding: "6px 10px",
          background: "linear-gradient(135deg, rgba(11,11,17,0.55) 0%, rgba(20,22,34,0.45) 50%, rgba(11,11,17,0.55) 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTopColor: "rgba(255,255,255,0.12)",
          borderRadius: "6px",
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}>
          <div>TELEMETRY · 240Hz</div>
          <div style={{ color: "#1EFF6A" }}>● LIVE · SECTOR {t < 0.33 ? 1 : t < 0.66 ? 2 : 3}</div>
        </div>
      </div>
    ),
  };
  const panelTitle = (id) => (registry.find((p) => p.id === id)?.title) || id;
  const visible = (id) => layout.getState(id).visible;

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <TopBar
        session={SESSION}
        lap={lap} totalLaps={totalLaps}
        clock={clock}
        weather={weather}
        flagState={flagState}
        safetyCar={!!safetyCar}
        leading={
          window.DELTA_CHANGE_RACE ? (
            <button onClick={() => window.DELTA_CHANGE_RACE && window.DELTA_CHANGE_RACE()} style={{
              padding: "5px 9px",
              background: "rgba(255,30,0,0.08)",
              border: "1px solid rgba(255,30,0,0.45)",
              color: window.THEME.textStrong,
              fontFamily: window.THEME.mono, fontSize: window.THEME.fs.xs,
              fontWeight: 700, letterSpacing: window.THEME.ls.caps,
              cursor: "pointer",
            }} title="Pick a different race">
              ← CHANGE RACE
            </button>
          ) : null
        }
        extras={<window.PanelsMenu layout={layout} registry={registry}/>}
      />

      {/* Main layout — position:relative so MaximizedOverlay can fill it */}
      <div style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `${visible("leaderboard") ? "320px" : "0"} 1fr ${(visible("driverCard") || visible("driverCard2") || visible("gap")) ? "360px" : "0"}`,
        gap: 10, padding: 10,
        minHeight: 0,
      }}>
        {/* Left: leaderboard */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <window.PanelSlot id="leaderboard" title={panelTitle("leaderboard")} layout={layout}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
            buttonStyle={{ top: 6, right: 6 }}>
            {panelBodies.leaderboard}
          </window.PanelSlot>
        </div>

        {/* Center: track + bottom panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          {/* Track — PanelSlot with buttons anchored top-right but offset to clear CameraControls */}
          <window.PanelSlot id="track" title={panelTitle("track")} layout={layout}
            style={{ flex: 1, minHeight: 0, display: "flex" }}
            buttonStyle={{ top: 14, right: 180 }}>
            {panelBodies.track}
          </window.PanelSlot>

          {/* Bottom strip: strategy + compare + feed */}
          {(visible("strategy") || visible("compare") || visible("sectors") || visible("feed")) && (
            <div style={{
              display: "grid",
              gridTemplateColumns: `${visible("strategy") ? "1.2fr" : "0"} ${(visible("compare") || visible("sectors")) ? "1.4fr" : "0"} ${visible("feed") ? "1fr" : "0"}`,
              gap: 10,
              height: 260,
              minHeight: 0,
            }}>
              <window.PanelSlot id="strategy" title={panelTitle("strategy")} layout={layout}
                style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                {panelBodies.strategy}
              </window.PanelSlot>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
                <window.PanelSlot id="compare" title={panelTitle("compare")} layout={layout}
                  style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  {panelBodies.compare}
                </window.PanelSlot>
                <window.PanelSlot id="sectors" title={panelTitle("sectors")} layout={layout}
                  style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                  {panelBodies.sectors}
                </window.PanelSlot>
              </div>
              <window.PanelSlot id="feed" title={panelTitle("feed")} layout={layout}
                style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                {panelBodies.feed}
              </window.PanelSlot>
            </div>
          )}
        </div>

        {/* Right: driver panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
          <window.PanelSlot id="driverCard" title={panelTitle("driverCard")} layout={layout}>
            {panelBodies.driverCard}
          </window.PanelSlot>
          <window.PanelSlot id="driverCard2" title={panelTitle("driverCard2")} layout={layout}>
            {panelBodies.driverCard2}
          </window.PanelSlot>
          <window.PanelSlot id="gap" title={panelTitle("gap")} layout={layout}>
            {panelBodies.gap}
          </window.PanelSlot>
          <window.PanelSlot id="gapHistory" title={panelTitle("gapHistory")} layout={layout}>
            {panelBodies.gapHistory}
          </window.PanelSlot>
        </div>

        {/* Maximize overlay — sized to the main grid area */}
        {layout.maximized && (
          <window.MaximizedOverlay layout={layout} title={panelTitle(layout.maximized)}>
            {panelBodies[layout.maximized]}
          </window.MaximizedOverlay>
        )}
      </div>

      <Timeline
        t={t} setT={seekRemote}
        playing={!isPaused} setPlaying={togglePlay}
        speed={speed} setSpeed={setSpeedRemote}
        lap={lap} totalLaps={totalLaps}
        safetyCarEvents={safetyCarEvents}
      />

      {tweaksOn && <TweaksPanel accent={accent} setAccent={setAccent} rotateX={rotateX} setRotateX={setRotateX} rotateZ={rotateZ} setRotateZ={setRotateZ} zoom={zoom} setZoom={setZoom}/>}
    </div>
  );
}

function TweaksPanel({ accent, setAccent, rotateX, setRotateX, rotateZ, setRotateZ, zoom, setZoom }) {
  const presets = [
    { name: "BROADCAST", rx: 62, rz: -18, z: 1 },
    { name: "TOP DOWN",  rx: 0,  rz: 0,   z: 1 },
    { name: "LOW ANGLE", rx: 78, rz: -25, z: 1.15 },
    { name: "PADDOCK",   rx: 70, rz: 45,  z: 0.9 },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 86, right: 14,
      width: 260,
      background: "linear-gradient(180deg, rgba(20,20,30,0.96), rgba(11,11,17,0.98))",
      border: "1px solid rgba(255,30,0,0.4)",
      padding: 12,
      fontFamily: "JetBrains Mono, monospace",
      zIndex: 50,
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#F6F6FA", letterSpacing: "0.2em", marginBottom: 10 }}>
        TWEAKS
      </div>
      <div style={{ fontSize: 8, color: "rgba(180,180,200,0.55)", letterSpacing: "0.14em", marginBottom: 6 }}>CAMERA PRESETS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 12 }}>
        {presets.map((p) => (
          <button key={p.name} onClick={() => { setRotateX(p.rx); setRotateZ(p.rz); setZoom(p.z); }} style={{
            padding: "6px 4px", background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#E6E6EF", cursor: "pointer",
            fontFamily: "inherit", fontSize: 9, letterSpacing: "0.14em", fontWeight: 700,
          }}>{p.name}</button>
        ))}
      </div>
      <div style={{ fontSize: 8, color: "rgba(180,180,200,0.55)", letterSpacing: "0.14em", marginBottom: 6 }}>ACCENT</div>
      <div style={{ display: "flex", gap: 4 }}>
        {["#FF1E00", "#FF8A1E", "#C15AFF", "#1EFF6A"].map((c) => (
          <button key={c} onClick={() => setAccent(c)} style={{
            width: 28, height: 22, background: c, border: accent === c ? "2px solid #FFFFFF" : "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer", padding: 0,
          }}/>
        ))}
      </div>
    </div>
  );
}

// Pre-gate: when no session is loaded yet, show RacePicker. As soon as a
// load begins (or one is already in flight / ready), hand off to the
// existing LOADING_GATE → App pipeline. Polls /api/session/status until
// status becomes anything other than "idle" / "error".
function AppRoot() {
  const [phase, setPhase] = React.useState("checking"); // "checking" | "picker" | "app"
  const phaseRef = React.useRef(phase);
  React.useEffect(() => { phaseRef.current = phase; }, [phase]);

  React.useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      try {
        const s = await window.DELTA_CLIENT.get("/api/session/status");
        if (!alive) return;
        const st = s?.status;
        if (st === "loading" || st === "ready") setPhase("app");
        else if (phaseRef.current !== "app") setPhase("picker");
      } catch {
        if (alive && phaseRef.current !== "app") setPhase("picker");
      }
      if (alive && phaseRef.current !== "app") timer = setTimeout(tick, 1500);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  // Keep hook order stable across phase changes; only expose the global helper
  // while the main app is mounted.
  React.useEffect(() => {
    if (phase !== "app") {
      window.DELTA_CHANGE_RACE = null;
      window.APEX_CHANGE_RACE = null;
      return undefined;
    }
    const changeRace = () => setPhase("picker");
    window.DELTA_CHANGE_RACE = changeRace;
    window.APEX_CHANGE_RACE = changeRace;
    return () => {
      window.DELTA_CHANGE_RACE = null;
      window.APEX_CHANGE_RACE = null;
    };
  }, [phase]);

  if (phase === "checking") return null;
  if (phase === "picker") {
    return (
      <window.RacePicker onLoadStarted={() => setPhase("app")}/>
    );
  }

  return (
    <window.LOADING_GATE>
      <App />
    </window.LOADING_GATE>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <window.LIVE.LiveProvider>
    <AppRoot/>
  </window.LIVE.LiveProvider>
);

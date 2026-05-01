// Right-side panels: tyre strategy, pit predictor, ghost radar, etc.

const { TEAMS, COMPOUNDS, DRIVERS, getStints, getPitStops } = window.DELTA;
const FALLBACK_TEAM_COLOR = "#9AA3B2";
const FALLBACK_COMPOUND_COLOR = "#FFD93A";

function isOutOfPlayStanding(s) {
  const badge = String(s?.labelStatus || "").trim().toUpperCase();
  return s?.status === "OUT" || badge === "RET" || badge === "ACC";
}

// Map fastf1 compound strings → DELTA keys
const COMPOUND_KEY = {
  SOFT: "S", MEDIUM: "M", HARD: "H",
  INTERMEDIATE: "I", WET: "W", UNKNOWN: "M",
};

// Stint strategy strip for top-10 drivers — uses real stint & pit stop data
function StrategyStrip({ standings, totalLaps, lap }) {
  const T = window.THEME;
  const top = standings.slice(0, 10);
  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
      overflow: "hidden",
    }}>
      <PanelHeader title="TYRE STRATEGY" meta={`LAP ${lap}/${totalLaps}`}/>
      <div style={{ padding: "6px 10px", fontFamily: T.mono }}>
        {top.map((s) => {
          const team = TEAMS[s.driver.team] || {
            name: s.driver.team || "Unknown",
            color: FALLBACK_TEAM_COLOR,
          };
          const rawStints = getStints(s.driver.code);
          const pitStops = getPitStops(s.driver.code);
          // Convert real stints → { start, end, c } for rendering
          const stops = rawStints.length > 0
            ? rawStints.map((st) => ({
                start: st.start_lap - 1,   // 0-indexed for bar positioning
                end: st.end_lap,
                c: COMPOUND_KEY[st.compound] || "M",
              }))
            : [{ start: 0, end: totalLaps, c: "M" }]; // fallback
          return (
            <div key={s.driver.code} style={{
              display: "grid", gridTemplateColumns: "28px 36px 1fr",
              gap: 8, alignItems: "center",
              padding: "3px 0",
              fontSize: T.fs.xs,
            }}>
              <div style={{ color: T.textDim, fontVariantNumeric: "tabular-nums" }}>
                P{String(s.pos).padStart(2, "0")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 2, height: 10, background: team.color }}/>
                <div style={{ color: T.text, fontWeight: 700, letterSpacing: T.ls.body }}>{s.driver.code}</div>
              </div>
              <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.04)" }}>
                {stops.map((stint, i) => {
                  const sx = (stint.start / totalLaps) * 100;
                  const sw = ((stint.end - stint.start) / totalLaps) * 100;
                  return (
                    <div key={i} style={{
                      position: "absolute", left: `${sx}%`, width: `${sw}%`, top: 0, bottom: 0,
                      background: COMPOUNDS[stint.c]?.color || COMPOUNDS.M?.color || FALLBACK_COMPOUND_COLOR,
                      opacity: stint.end < lap ? 0.55 : stint.start > lap ? 0.25 : 0.85,
                      borderRight: "1px solid rgba(11,11,17,0.7)",
                    }}/>
                  );
                })}
                {/* Pit stop markers */}
                {pitStops.map((ps, i) => (
                  <div key={`pit-${i}`} style={{
                    position: "absolute",
                    left: `${(ps.lap / totalLaps) * 100}%`,
                    top: -3, bottom: -3, width: 2,
                    background: T.caution,
                    borderRadius: 1,
                    zIndex: 2,
                  }}/>
                ))}
                {/* Current lap marker */}
                <div style={{
                  position: "absolute", left: `${(lap / totalLaps) * 100}%`,
                  top: -2, bottom: -2, width: 1, background: "#FFFFFF",
                  zIndex: 3,
                }}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact gap-to-leader visualizer (spider)
function GapViz({ standings, pinned }) {
  const T = window.THEME;
  const running = React.useMemo(
    () => standings.filter((s) => !isOutOfPlayStanding(s)),
    [standings],
  );
  const top = running.slice(0, 10);
  const maxGap = Math.max(...top.map((s) => s.gap ?? 0), 1);
  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
    }}>
      <PanelHeader title="GAP TO LEADER"/>
      <div style={{ padding: "6px 10px", fontFamily: T.mono }}>
        {top.map((s) => {
          const team = TEAMS[s.driver.team] || {
            name: s.driver.team || "Unknown",
            color: FALLBACK_TEAM_COLOR,
          };
          const gap = s.gap ?? 0;
          const pct = (gap / maxGap) * 100;
          const isPinned = pinned === s.driver.code;
          return (
            <div key={s.driver.code} style={{
              display: "grid", gridTemplateColumns: "40px 1fr 58px",
              gap: 6, alignItems: "center", fontSize: T.fs.xs,
              padding: "2.5px 0",
            }}>
              <div style={{ color: isPinned ? T.hot : T.text, fontWeight: 700 }}>
                {s.driver.code}
              </div>
              <div style={{ position: "relative", height: 3, background: "rgba(255,255,255,0.04)" }}>
                <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "100%", background: team.color }}/>
              </div>
              <div style={{ color: "rgba(230,230,239,0.8)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {s.pos === 1 ? "LEADER" : `+${gap.toFixed(2)}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Spaghetti chart: every driver as a thin colored line, x = lap, y = gap to leader.
// Pit stops appear as small dots; SC/VSC/red bands as faint vertical washes.
function GapHistory({ pinned, secondary, onPick, onShiftPick, lap }) {
  const T = window.THEME;
  const [data, setData] = React.useState(null);
  const [loadErr, setLoadErr] = React.useState(null);
  const [hoverCode, setHoverCode] = React.useState(null);
  const [hoverPos, setHoverPos] = React.useState(null); // { x, y, lap, gap }
  const containerRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 360, h: 220 });

  // Retry on failure with backoff — session may not be loaded yet when this
  // panel first mounts, and the endpoint 404s until it is.
  React.useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer = null;
    const tryFetch = () => {
      if (cancelled) return;
      window.DELTA_CLIENT.get("/api/session/gap_to_leader")
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setLoadErr(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setLoadErr(String(err?.message || err));
          attempt++;
          const delay = Math.min(8000, 1000 * (2 ** Math.min(attempt, 3)));
          timer = setTimeout(tryFetch, delay);
        });
    };
    tryFetch();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Track container size so the SVG fills the panel.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ w: Math.max(160, cr.width), h: Math.max(140, cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 30, padR = 10, padT = 8, padB = 22;
  const W = size.w;
  const H = size.h;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = Math.max(10, H - padT - padB);

  // Compute a y scale that ignores extreme outliers (lapped + retired tails)
  // by clipping at the 95th percentile of finite gaps.
  const { totalLaps, lines, yMax, yTicks, xTicks } = React.useMemo(() => {
    if (!data || !data.drivers || !data.total_laps) {
      return { totalLaps: 0, lines: [], yMax: 1, yTicks: [], xTicks: [] };
    }
    const tl = data.total_laps;
    const all = [];
    for (const drv of data.drivers) {
      for (const g of drv.gaps) if (g != null && isFinite(g)) all.push(g);
    }
    all.sort((a, b) => a - b);
    let cap = 1;
    if (all.length) {
      const p95 = all[Math.min(all.length - 1, Math.floor(all.length * 0.95))];
      cap = Math.max(10, Math.ceil(p95 / 10) * 10);
    }
    const lns = data.drivers.map((drv) => {
      const code = drv.code;
      const dEntry = (window.DELTA.DRIVERS || []).find((x) => x.code === code);
      const team = dEntry ? window.DELTA.TEAMS[dEntry.team] : null;
      const color = team?.color || FALLBACK_TEAM_COLOR;
      const pts = [];
      for (let i = 0; i < drv.gaps.length; i++) {
        const g = drv.gaps[i];
        if (g == null) { pts.push(null); continue; }
        const x = padL + (innerW * (i + 1)) / Math.max(1, tl);
        const yClipped = Math.min(g, cap);
        const y = padT + (innerH * yClipped) / cap;
        pts.push({ x, y, lap: i + 1, gap: g });
      }
      const pitDots = (drv.pit_laps || []).map((lapNo) => {
        const idx = lapNo - 1;
        return idx >= 0 && idx < pts.length ? pts[idx] : null;
      }).filter(Boolean);
      return { code, color, pts, pitDots };
    });
    // y ticks
    const tickStep = cap <= 30 ? 5 : cap <= 60 ? 10 : cap <= 120 ? 20 : 30;
    const yt = [];
    for (let v = 0; v <= cap; v += tickStep) yt.push(v);
    // x ticks every ~5 laps
    const xStep = tl <= 20 ? 5 : tl <= 60 ? 10 : 20;
    const xt = [];
    for (let v = xStep; v <= tl; v += xStep) xt.push(v);
    return { totalLaps: tl, lines: lns, yMax: cap, yTicks: yt, xTicks: xt };
  }, [data, innerW, innerH]);

  function buildPath(pts) {
    let d = "";
    let started = false;
    for (const p of pts) {
      if (p == null) { started = false; continue; }
      d += (started ? "L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1);
      started = true;
    }
    return d;
  }

  const orderedLines = React.useMemo(() => {
    // Render dimmed lines first, then highlighted on top.
    const dim = [], hot = [];
    for (const ln of lines) {
      if (ln.code === pinned || ln.code === secondary || ln.code === hoverCode) hot.push(ln);
      else dim.push(ln);
    }
    return [...dim, ...hot];
  }, [lines, pinned, secondary, hoverCode]);

  const onMouseMove = React.useCallback((e) => {
    if (!totalLaps) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < padL || mx > W - padR || my < padT || my > H - padB) {
      setHoverCode(null); setHoverPos(null); return;
    }
    // Find nearest line by Euclidean distance to its segment polyline.
    let bestCode = null, bestPt = null, bestD2 = 64; // 8px radius
    for (const ln of lines) {
      for (const p of ln.pts) {
        if (!p) continue;
        const dx = p.x - mx, dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestCode = ln.code; bestPt = p; }
      }
    }
    setHoverCode(bestCode);
    setHoverPos(bestPt ? { x: bestPt.x, y: bestPt.y, lap: bestPt.lap, gap: bestPt.gap } : null);
  }, [lines, totalLaps, W, H]);

  const onMouseLeave = React.useCallback(() => {
    setHoverCode(null); setHoverPos(null);
  }, []);

  const onClick = React.useCallback((e) => {
    if (!hoverCode) return;
    if (e.shiftKey && onShiftPick) onShiftPick(hoverCode);
    else if (onPick) onPick(hoverCode);
  }, [hoverCode, onPick, onShiftPick]);

  // Current-lap marker
  const lapX = totalLaps > 0
    ? padL + (innerW * Math.max(0, Math.min(totalLaps, lap || 0))) / totalLaps
    : null;

  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
      display: "flex", flexDirection: "column",
      minHeight: 220,
    }}>
      <PanelHeader title="GAP HISTORY" meta={totalLaps ? `${lines.length} DRIVERS · ${totalLaps} L` : ""}/>
      <div ref={containerRef} style={{ flex: 1, position: "relative", padding: 6 }}>
        {!data && (
          <div style={{ padding: 14, fontFamily: T.mono, fontSize: T.fs.xs, color: T.textDim, letterSpacing: T.ls.caps }}>
            {loadErr ? `RETRYING… (${loadErr})` : "LOADING…"}
          </div>
        )}
        {data && totalLaps > 0 && (
          <svg
            width={W} height={H}
            style={{ display: "block", cursor: hoverCode ? "pointer" : "default" }}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
          >
            {/* SC / VSC / red bands */}
            {(data.sc_bands || []).map((band, i) => {
              const x0 = padL + (innerW * Math.max(0, band.start_lap)) / totalLaps;
              const x1 = padL + (innerW * Math.min(totalLaps, band.end_lap)) / totalLaps;
              const w = Math.max(1, x1 - x0);
              const fill =
                band.status === "red" ? "rgba(255,30,0,0.10)"
                : band.status === "sc" ? "rgba(255,217,58,0.10)"
                : band.status === "vsc" ? "rgba(255,217,58,0.06)"
                : "rgba(255,217,58,0.04)";
              return <rect key={`sc-${i}`} x={x0} y={padT} width={w} height={innerH} fill={fill}/>;
            })}

            {/* Y gridlines + labels */}
            {yTicks.map((v) => {
              const y = padT + (innerH * v) / yMax;
              return (
                <g key={`y-${v}`}>
                  <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1}/>
                  <text x={padL - 4} y={y + 3} fill={T.textDim}
                        fontFamily={T.mono} fontSize={9} textAnchor="end">
                    {v === 0 ? "0" : `+${v}`}
                  </text>
                </g>
              );
            })}

            {/* X tick labels */}
            {xTicks.map((v) => {
              const x = padL + (innerW * v) / totalLaps;
              return (
                <text key={`x-${v}`} x={x} y={H - 6} fill={T.textDim}
                      fontFamily={T.mono} fontSize={9} textAnchor="middle">
                  L{v}
                </text>
              );
            })}

            {/* Current-lap marker */}
            {lapX != null && (
              <line x1={lapX} x2={lapX} y1={padT} y2={H - padB}
                    stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2,3"/>
            )}

            {/* Driver lines */}
            {orderedLines.map((ln) => {
              const isHot = ln.code === pinned || ln.code === secondary || ln.code === hoverCode;
              const stroke = ln.code === pinned ? T.hot
                : ln.code === secondary ? T.cool
                : ln.color;
              const opacity = isHot ? 1 : (hoverCode || pinned || secondary ? 0.18 : 0.55);
              const width = isHot ? 1.8 : 1;
              return (
                <g key={ln.code}>
                  <path d={buildPath(ln.pts)} fill="none" stroke={stroke}
                        strokeOpacity={opacity} strokeWidth={width}
                        strokeLinejoin="round" strokeLinecap="round"/>
                  {isHot && ln.pitDots.map((p, i) => (
                    <circle key={`p-${i}`} cx={p.x} cy={p.y} r={2.5}
                            fill={T.caution} stroke="rgba(0,0,0,0.6)" strokeWidth={0.5}/>
                  ))}
                </g>
              );
            })}

            {/* Hover marker + tooltip */}
            {hoverPos && hoverCode && (
              <g pointerEvents="none">
                <circle cx={hoverPos.x} cy={hoverPos.y} r={3.5}
                        fill="#FFFFFF" stroke="rgba(0,0,0,0.8)" strokeWidth={0.5}/>
                <g transform={`translate(${Math.min(hoverPos.x + 8, W - 90)}, ${Math.max(hoverPos.y - 22, padT)})`}>
                  <rect width={82} height={28} fill="rgba(11,11,17,0.92)" stroke="rgba(255,255,255,0.15)"/>
                  <text x={6} y={11} fill={T.text} fontFamily={T.mono} fontSize={10} fontWeight={700}>
                    {hoverCode}
                  </text>
                  <text x={6} y={23} fill={T.textDim} fontFamily={T.mono} fontSize={9}>
                    L{hoverPos.lap} · +{hoverPos.gap.toFixed(2)}s
                  </text>
                </g>
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

// Event feed / race control messages
function RaceFeed({ events }) {
  const T = window.THEME;
  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
      display: "flex", flexDirection: "column",
      minHeight: 0, flex: 1,
    }}>
      <PanelHeader title="RACE CONTROL" meta={`${events.length} MSGS`}/>
      <div style={{ overflow: "auto", flex: 1, fontFamily: T.mono, fontSize: T.fs.sm }}>
        {events.map((e, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "54px 42px 1fr",
            gap: 8, padding: "6px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.03)",
            alignItems: "start",
          }}>
            <div style={{ color: T.textDim, fontSize: T.fs.xs, fontVariantNumeric: "tabular-nums" }}>
              {e.time}
            </div>
            <div style={{
              fontSize: 8, letterSpacing: T.ls.caps, fontWeight: 700,
              padding: "1px 4px",
              color: e.tag === "SC" ? "#0B0B11" : e.tag === "FLAG" ? "#0B0B11" : T.text,
              background: e.tag === "SC" ? T.caution : e.tag === "FLAG" ? T.warn : e.tag === "INFO" ? "rgba(255,255,255,0.06)" : "rgba(255,30,0,0.3)",
              textAlign: "center",
              alignSelf: "start",
            }}>
              {e.tag}
            </div>
            <div style={{ color: T.text, fontSize: T.fs.sm, lineHeight: 1.35, letterSpacing: T.ls.tight }}>
              {e.msg}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.StrategyStrip = StrategyStrip;
window.GapViz = GapViz;
window.GapHistory = GapHistory;
window.RaceFeed = RaceFeed;

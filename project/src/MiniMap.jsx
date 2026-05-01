// Persistent top-down mini-map for chase/POV camera modes, where the main
// view loses field context. Pure SVG — track centerline + per-frame driver
// pips. Click a pip to pin the driver, shift-click to compare.

const { TEAMS: MM_TEAMS, CIRCUIT: MM_CIRCUIT } = window.DELTA;
const MM_FALLBACK = "#9AA3B2";

function MiniMap({ standings, pinned, secondary, onPickDriver, width = 168 }) {
  const T = window.THEME;
  const [geomVer, setGeomVer] = React.useState(() => window.DELTA?.geometryVersion || 0);

  React.useEffect(() => {
    const onVer = (e) => setGeomVer(e.detail?.version ?? (window.DELTA?.geometryVersion || 0));
    window.addEventListener("delta:geometry-version", onVer);
    return () => window.removeEventListener("delta:geometry-version", onVer);
  }, []);

  const view = React.useMemo(() => {
    const C = window.DELTA.CIRCUIT;
    if (!C?.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of C) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    const pad = Math.max(w, h) * 0.06;
    return { minX: minX - pad, minY: minY - pad, w: w + pad * 2, h: h + pad * 2 };
  }, [geomVer]);

  const pathD = React.useMemo(() => {
    const C = window.DELTA.CIRCUIT;
    if (!C?.length) return "";
    let d = `M ${C[0].x} ${C[0].y}`;
    for (let i = 1; i < C.length; i++) d += ` L ${C[i].x} ${C[i].y}`;
    return d + " Z";
  }, [geomVer]);

  if (!view) return null;
  const aspect = view.w / Math.max(view.h, 1);
  const innerW = width - 16;
  const svgH = Math.max(60, Math.round(innerW / Math.max(aspect, 0.3)));
  const stroke = view.w / 220;
  const dotR = view.w / 90;
  const dotRBig = view.w / 60;
  const ringW = view.w / 320;

  return (
    <div style={{
      width,
      padding: 8,
      background: "linear-gradient(135deg, rgba(11,11,17,0.6) 0%, rgba(20,22,34,0.5) 50%, rgba(11,11,17,0.6) 100%)",
      backdropFilter: "blur(12px) saturate(1.4)",
      WebkitBackdropFilter: "blur(12px) saturate(1.4)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 6,
      boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
      pointerEvents: "auto",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 4,
      }}>
        <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: T.ls.caps }}>
          FIELD MAP
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 8, color: "rgba(180,180,200,0.4)", letterSpacing: T.ls.caps }}>
          {standings.filter((s) => s.status !== "OUT").length}
        </div>
      </div>
      <svg
        viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`}
        width={innerW} height={svgH}
        style={{ display: "block" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Flip Y so north is up (world coords have +y north; SVG has +y down) */}
        <g transform={`translate(0, ${view.minY * 2 + view.h}) scale(1, -1)`}>
          <path d={pathD} fill="none" stroke="rgba(180,180,200,0.5)" strokeWidth={stroke} strokeLinejoin="round"/>
          {standings.map((s) => {
            if (s.status === "OUT") return null;
            const p = window.DELTA.CIRCUIT[s.trackIdx];
            if (!p) return null;
            const team = MM_TEAMS[s.driver.team];
            const color = team?.color || MM_FALLBACK;
            const isPinned = s.driver.code === pinned;
            const isSec = s.driver.code === secondary;
            const r = (isPinned || isSec) ? dotRBig : dotR;
            const ringColor = isPinned ? "#FF1E00" : isSec ? "#00D9FF" : null;
            return (
              <g
                key={s.driver.code}
                style={{ cursor: "pointer" }}
                onClick={(e) => onPickDriver && onPickDriver(s.driver.code, e)}
              >
                {/* Generous hit target — invisible but clickable */}
                <circle cx={p.x} cy={p.y} r={dotRBig * 1.6} fill="transparent"/>
                {ringColor && (
                  <circle cx={p.x} cy={p.y} r={r * 1.9}
                    fill="none" stroke={ringColor} strokeWidth={ringW * 2}/>
                )}
                <circle cx={p.x} cy={p.y} r={r}
                  fill={color}
                  stroke="#0B0B11" strokeWidth={ringW}/>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

window.MiniMap = MiniMap;

// Leaderboard — left rail. Engineer-dense.

const { TEAMS, COMPOUNDS } = window.DELTA;
const FALLBACK_TEAM_COLOR = "#9AA3B2";
const FALLBACK_COMPOUND = { label: "MEDIUM", color: "#FFD93A" };

function fmtGap(g) {
  if (g === 0) return "LEADER";
  if (g < 60) return `+${g.toFixed(3)}`;
  const m = Math.floor(g / 60);
  const s = (g % 60).toFixed(3);
  return `+${m}:${s.padStart(6, "0")}`;
}
function fmtInterval(g) {
  if (g === 0) return "—";
  return `+${g.toFixed(3)}`;
}
function fmtLap(t) {
  if (!t) return "—";
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(3);
  return `${m}:${s.padStart(6, "0")}`;
}

const SECTOR_COLORS = ["#FF1E00", "#FFD93A", "#00D9FF"];
function outLabelForRow(s) {
  const badge = String(s?.labelStatus || "").trim().toUpperCase();
  if (badge === "RET" || badge === "ACC" || badge === "DNS") return badge;
  return "DNF";
}

function sectorOf(fraction) {
  if (fraction == null) return 0;
  if (fraction < 0.33) return 0;
  if (fraction < 0.66) return 1;
  return 2;
}

function Leaderboard({ standings, pinned, secondary, onPick, onShiftPick, bestLapCode }) {
  const T = window.THEME;
  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
      borderRadius: 2,
      backdropFilter: "blur(8px)",
      display: "flex", flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    }}>
      <PanelHeader
        title="CLASSIFICATION"
        meta={`${standings.filter((s) => s.status !== "OUT").length}/20 CARS`}
      />
      <div style={{
        display: "grid",
        gridTemplateColumns: "24px 26px 1fr 62px 62px 58px 22px",
        gap: 6, padding: "6px 10px",
        fontFamily: T.mono,
        fontSize: T.fs.xs,
        color: T.textDim,
        letterSpacing: T.ls.label,
        borderBottom: T.borderSoft,
      }}>
        <div>P</div><div></div><div>DRIVER</div><div style={{textAlign:"right"}}>GAP</div><div style={{textAlign:"right"}}>INT</div><div style={{textAlign:"right"}}>LAST</div><div></div>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {standings.map((s) => (
          <LeaderboardRow
            key={s.driver.code}
            s={s}
            pinned={pinned}
            secondary={secondary}
            bestLapCode={bestLapCode}
            onPick={onPick}
            onShiftPick={onShiftPick}
          />
        ))}
      </div>
    </div>
  );
}

function LeaderboardRow({ s, pinned, secondary, bestLapCode, onPick, onShiftPick }) {
  const T = window.THEME;
  const team = TEAMS[s.driver.team] || {
    name: s.driver.team || "Unknown",
    color: FALLBACK_TEAM_COLOR,
  };
  const isPinned = pinned === s.driver.code;
  const isSec = secondary === s.driver.code;
  const isOut = s.status === "OUT";
  const outLabel = outLabelForRow(s);
  const isBest = bestLapCode === s.driver.code;

  // Detect sector transitions — pulse the row for pinned driver when they
  // cross a sector boundary. For all rows we keep a cheap ref-compare; pulse
  // is only rendered when the driver is pinned (the one the user is watching).
  const rowRef = React.useRef(null);
  const lastSectorRef = React.useRef(sectorOf(s.fraction));
  React.useEffect(() => {
    const cur = sectorOf(s.fraction);
    if (cur !== lastSectorRef.current) {
      lastSectorRef.current = cur;
      if (isPinned && rowRef.current) {
        const el = rowRef.current;
        el.classList.remove("delta-row-pulse");
        // force reflow so animation restarts
        void el.offsetWidth;
        el.classList.add("delta-row-pulse");
      }
    }
  }, [s.fraction, isPinned]);

  const frac = s.fraction != null ? (s.fraction % 1) : 0;
  const curSector = sectorOf(frac);
  const sectorBarColor = SECTOR_COLORS[curSector];

  return (
    <div
      ref={rowRef}
      className="delta-row"
      onClick={(e) => {
        if (isOut) return;
        if (e.shiftKey) onShiftPick(s.driver.code);
        else onPick(s.driver.code);
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 26px 1fr 62px 62px 58px 22px",
        gap: 6,
        padding: "5px 10px",
        alignItems: "center",
        fontFamily: T.mono,
        fontSize: 11,
        color: isOut ? T.textFaint : T.text,
        cursor: isOut ? "default" : "pointer",
        borderLeft: isPinned ? `2px solid ${T.hot}` : isSec ? `2px solid ${T.cool}` : "2px solid transparent",
        background: isPinned
          ? "linear-gradient(90deg, rgba(255,30,0,0.12), transparent 60%)"
          : isSec
          ? "linear-gradient(90deg, rgba(0,217,255,0.12), transparent 60%)"
          : "transparent",
        borderBottom: T.borderSoft,
      }}
      onMouseEnter={(e) => { if (!isOut && !isPinned && !isSec) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isOut && !isPinned && !isSec) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {isOut ? "--" : String(s.pos).padStart(2, " ")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 3, height: 14, background: team.color }}/>
        <div style={{ fontSize: T.fs.xs, color: "rgba(180,180,200,0.55)" }}>{s.driver.num}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, letterSpacing: T.ls.body }}>{s.driver.code}</div>
        {/* Sector-colored lap-progress bar — 2px, fills with s.fraction */}
        {!isOut && (
          <div style={{
            height: 2, marginTop: 2,
            background: "rgba(255,255,255,0.04)",
            position: "relative",
          }}>
            <div
              className="delta-sector-bar-fill"
              style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
                background: sectorBarColor,
                boxShadow: isPinned ? `0 0 4px ${sectorBarColor}` : "none",
              }}
            />
          </div>
        )}
        <div style={{ fontSize: 8, color: T.textFaint, letterSpacing: T.ls.label, marginTop: isOut ? 0 : 1 }}>{team.name}</div>
      </div>
      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: T.fs.sm, color: isOut ? "inherit" : "rgba(230,230,239,0.85)" }}>
        {isOut ? outLabel : fmtGap(s.gap)}
      </div>
      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: T.fs.sm, color: T.textMuted }}>
        {isOut ? "—" : fmtInterval(s.interval)}
      </div>
      <div style={{
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontSize: T.fs.sm,
        color: (() => {
          if (isBest) return T.purple;
          if (s.lastLap > 0 && s.pbLap > 0 && s.lastLap === s.pbLap) return T.good;
          if (s.lastLap > 0 && s.pbLap > 0 && s.lastLap < s.pbLap + 0.2) return T.warn;
          return "rgba(230,230,239,0.75)";
        })(),
      }}>
        {isOut ? "—" : fmtLap(s.lastLap)}
      </div>
      <TyrePip compound={s.compound} age={s.tyreAge} pit={s.pit} out={isOut}/>
    </div>
  );
}

function TyrePip({ compound, age, pit, out }) {
  if (out) return <div/>;
  const c = COMPOUNDS[compound] || COMPOUNDS.M || FALLBACK_COMPOUND;
  return (
    <div title={`${c.label} · ${age} laps${pit ? " · PIT" : ""}`} style={{
      width: 18, height: 18, position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="7" fill="none" stroke={c.color} strokeWidth="2"/>
        <circle cx="9" cy="9" r="2.5" fill={c.color}/>
      </svg>
      {pit && (
        <div style={{
          position: "absolute", top: -2, right: -2,
          width: 6, height: 6, borderRadius: 3,
          background: "#FF1E00",
          boxShadow: "0 0 4px #FF1E00",
        }}/>
      )}
    </div>
  );
}

function PanelHeader({ title, meta, accent }) {
  const T = window.THEME;
  const a = accent || T.accent;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 12px",
      borderBottom: T.border,
      fontFamily: T.mono,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 6, height: 6, background: a, boxShadow: `0 0 6px ${a}` }}/>
        <div style={{ fontSize: T.fs.sm, fontWeight: 700, letterSpacing: T.ls.wide, color: T.text }}>
          {title}
        </div>
      </div>
      {meta && (
        <div style={{ fontSize: T.fs.xs, color: T.textMuted, letterSpacing: T.ls.label }}>
          {meta}
        </div>
      )}
    </div>
  );
}

window.Leaderboard = Leaderboard;
window.PanelHeader = PanelHeader;

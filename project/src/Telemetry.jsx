// Telemetry panels — right rail + driver card + compare view.

const { TEAMS, COMPOUNDS, DRIVERS, lapTrace } = window.DELTA;
const FALLBACK_TEAM_COLOR = "#9AA3B2";
const FALLBACK_COMPOUND = { label: "MEDIUM", color: "#FFD93A" };

function DriverCard({ code, data, accent, secondary = false, standings = [] }) {
  const T = window.THEME;
  const a = accent || T.accent;
  if (!code) {
    return (
      <div className="delta-panel-mount" style={{
        padding: 16, minHeight: 120,
        fontFamily: T.mono,
        fontSize: T.fs.sm, color: T.textFaint,
        letterSpacing: T.ls.caps,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px dashed rgba(255,255,255,0.08)",
      }}>
        SELECT DRIVER ON TRACK OR LEADERBOARD
      </div>
    );
  }
  const d = DRIVERS.find((x) => x.code === code);
  if (!d) {
    return (
      <div className="delta-panel-mount" style={{
        padding: 16, minHeight: 120,
        fontFamily: T.mono,
        fontSize: T.fs.sm, color: T.textFaint,
        letterSpacing: T.ls.caps,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px dashed rgba(255,255,255,0.08)",
      }}>
        SELECT DRIVER ON TRACK OR LEADERBOARD
      </div>
    );
  }
  const team = TEAMS[d.team] || {
    name: d.team || "Unknown",
    color: FALLBACK_TEAM_COLOR,
  };
  const live = standings.find(s => s.driver.code === code);
  const compoundKey = live?.compound || "M";
  const compound = COMPOUNDS[compoundKey] || COMPOUNDS.M || FALLBACK_COMPOUND;
  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: secondary ? T.borderCool : T.borderHot,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Top accent slab */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: a }}/>

      <div style={{
        display: "grid", gridTemplateColumns: "38px 1fr auto",
        gap: 10, padding: "10px 12px",
        borderBottom: T.borderSoft,
        alignItems: "center",
      }}>
        <div style={{
          width: 38, height: 38,
          background: team.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: T.mono,
          fontSize: T.fs.lg, fontWeight: 800,
          color: team.color === "#FFFFFF" || team.color === "#FFD700" ? "#0B0B11" : "#FFFFFF",
          position: "relative",
        }}>
          {d.num}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.2), transparent 50%)" }}/>
        </div>
        <div style={{ fontFamily: T.mono, lineHeight: 1.2 }}>
          <div style={{ fontSize: T.fs.lg, fontWeight: 700, color: T.text, letterSpacing: T.ls.body }}>
            {d.code} <span style={{ color: T.textFaint, fontWeight: 400, fontSize: T.fs.md }}>· {d.name}</span>
          </div>
          <div style={{ fontSize: T.fs.xs, color: team.color, letterSpacing: T.ls.caps, fontWeight: 700 }}>
            {team.name}
          </div>
        </div>
        <div style={{ fontFamily: T.mono, fontSize: T.fs.xs, color: T.textDim, textAlign: "right", letterSpacing: T.ls.label }}>
          {d.country}
        </div>
      </div>

      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <BigReadout label="SPEED" value={data.speed} unit="kph" accent={a}/>
        <BigReadout label="GEAR"  value={data.gear}  unit="" accent={a}/>
      </div>

      <div style={{ padding: "0 12px 10px" }}>
        <Bar label="THR" value={data.throttle} color={T.good}/>
        <Bar label="BRK" value={data.brake}   color={T.hot}/>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        borderTop: T.borderSoft,
      }}>
        <MicroStat label="RPM" value={data.rpm.toLocaleString()} />
        <MicroStat label="DRS" value={data.drs ? "OPEN" : "CLSD"} strong={data.drs} color={data.drs ? T.good : undefined}/>
        <MicroStat label="TYRE" value={`${compound.label.slice(0,3).toUpperCase()} · ${live?.tyreAge ?? 0}L`} color={compound.color}/>
      </div>
    </div>
  );
}

function BigReadout({ label, value, unit, accent }) {
  const T = window.THEME;
  return (
    <div style={{ fontFamily: T.mono }}>
      <div style={{ fontSize: T.fs.xs, color: T.textDim, letterSpacing: T.ls.caps, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <div style={{
          fontSize: T.fs.xl, fontWeight: 700, color: T.textStrong,
          fontVariantNumeric: "tabular-nums", letterSpacing: T.ls.tight,
          lineHeight: 1,
          textShadow: `0 0 18px ${accent}44`,
        }}>
          {value}
        </div>
        {unit && (
          <div style={{ fontSize: T.fs.sm, color: T.textDim, letterSpacing: T.ls.label }}>
            {unit}
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ label, value, color, max = 100, dim }) {
  const T = window.THEME;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "34px 1fr 32px",
      gap: 8, alignItems: "center",
      fontFamily: T.mono,
      fontSize: T.fs.xs,
      padding: "3px 0",
      opacity: dim ? 0.35 : 1,
    }}>
      <div style={{ color: T.textMuted, letterSpacing: T.ls.label }}>{label}</div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.05)", position: "relative" }}>
        <div style={{
          position: "absolute", inset: 0, width: `${pct}%`,
          background: color,
          boxShadow: `0 0 6px ${color}66`,
        }}/>
        {/* tick marks */}
        {[25, 50, 75].map((t) => (
          <div key={t} style={{ position: "absolute", left: `${t}%`, top: 0, bottom: 0, width: 1, background: "rgba(11,11,17,0.8)" }}/>
        ))}
      </div>
      <div style={{ color: T.text, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {Math.round(value)}
      </div>
    </div>
  );
}

function MicroStat({ label, value, color, strong }) {
  const T = window.THEME;
  return (
    <div style={{
      padding: "8px 10px",
      borderRight: "1px solid rgba(255,255,255,0.04)",
      fontFamily: T.mono,
    }}>
      <div style={{ fontSize: T.fs.xs, color: T.textDim, letterSpacing: T.ls.caps }}>{label}</div>
      <div style={{
        fontSize: T.fs.md, fontWeight: strong ? 700 : 600,
        color: color || T.text,
        fontVariantNumeric: "tabular-nums",
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

// Channel metadata — drives the button row, axis units, and short labels.
const CHANNEL_DEFS = [
  { key: "speed",    label: "SPD",   unit: "kph" },
  { key: "throttle", label: "THR",   unit: "%"   },
  { key: "brake",    label: "BRK",   unit: "%"   },
  { key: "gear",     label: "GEAR",  unit: ""    },
  { key: "rpm",      label: "RPM",   unit: "rpm" },
];
function fmtAxis(v, unit) {
  if (unit === "rpm") {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "k";
    return Math.round(v).toString();
  }
  if (unit === "" || !unit) return Math.round(v).toString();
  return Math.round(v).toString();
}

let _clipSeq = 0;

// Compare lap-distance traces for 1-2 drivers
function CompareTraces({ pinned, secondary, lap, channel = "speed", setChannel, tWithinLap }) {
  const T = window.THEME;
  const clipId = React.useMemo(() => `tr-clip-${++_clipSeq}`, []);
  const deltaClipId = clipId + "-d";
  const codes = React.useMemo(() => [pinned, secondary].filter(Boolean), [pinned, secondary]);
  const channelUnit = (CHANNEL_DEFS.find((c) => c.key === channel) || {}).unit || "";

  // Real sector boundaries from geometry (metres → fraction). Fall back to 1/3, 2/3.
  const sectorFractions = React.useMemo(() => {
    const geo = window.__LIVE_SNAPSHOT?.geometry;
    const total = geo?.total_length_m || 0;
    const bounds = geo?.sector_boundaries_m || [];
    if (total > 0 && bounds.length >= 2) {
      return bounds.slice(0, 2).map((m) => Math.max(0, Math.min(1, m / total)));
    }
    return [1 / 3, 2 / 3];
  }, [window.__LIVE_SNAPSHOT?.geometry?.total_length_m]);

  // Kick off server fetches for any (code, lap) that's not cached yet.
  // On resolve, bump a tick to force recomputation of the memoized traces.
  const [cacheTick, setCacheTick] = React.useState(0);
  const [fetching, setFetching] = React.useState(false);
  React.useEffect(() => {
    const fetchFn = window.DELTA?.fetchLapTrace;
    const getCached = window.DELTA?.getCachedLapTrace;
    if (!fetchFn || !getCached) return;
    let cancelled = false;
    const pending = codes.filter((c) => !getCached(c, lap));
    if (pending.length === 0) { setFetching(false); return; }
    setFetching(true);
    let remaining = pending.length;
    for (const c of pending) {
      fetchFn(c, lap).then((d) => {
        if (cancelled) return;
        if (d) setCacheTick((x) => x + 1);
        remaining--;
        if (remaining === 0) setFetching(false);
      }).catch(() => {
        if (cancelled) return;
        remaining--;
        if (remaining === 0) setFetching(false);
      });
    }
    return () => { cancelled = true; };
  }, [codes, lap]);

  // Memoize traces — previously recomputed (sort + 200-point interp) every paint.
  // Depend on the accumulator bucket length so live growth still shows.
  const liveSig = codes.map((c) =>
    (window.__LAP_TELEMETRY?.[c]?.[lap]?.length) || 0
  ).join(",");
  const traces = React.useMemo(
    () => codes.map((c) => lapTrace(c, lap, channel)),
    [codes, lap, channel, cacheTick, liveSig]
  );
  const hasData = traces.some((t) => t.length > 0);
  const W = 480, H = 140, PAD_L = 30, PAD_B = 18, PAD_T = 10, PAD_R = 8;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;

  // min/max in a single pass; avoids spreading a 400-point array into Math.min.
  let minRaw = Infinity, maxRaw = -Infinity;
  for (const t of traces) for (let i = 0; i < t.length; i++) {
    const v = t[i].value;
    if (v < minRaw) minRaw = v;
    if (v > maxRaw) maxRaw = v;
  }
  if (!isFinite(minRaw)) { minRaw = 0; maxRaw = 100; }
  const padAbs = Math.max(1, (maxRaw - minRaw) * 0.05);
  const min = minRaw - padAbs;
  const max = maxRaw + padAbs;
  const span_y = Math.max(1e-6, max - min);
  const colors = [T.hot, T.cool];

  // Reveal window — how far along the lap to show trace data. Nudge slightly
  // past the playhead so the leading-edge dot isn't clipped mid-stroke.
  const revealFrac = Math.max(0, Math.min(1, (tWithinLap ?? 1) + 0.005));

  const pathFor = (t) => {
    if (!t || t.length === 0) return "";
    let d = "";
    for (let i = 0; i < t.length; i++) {
      const x = PAD_L + t[i].fraction * iw;
      const y = PAD_T + ih - ((t[i].value - min) / span_y) * ih;
      d += (i === 0 ? "M" : "L") + ` ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return d;
  };

  // Delta strip: speed_a − speed_b vs. fraction. Only meaningful with 2 drivers.
  const DELTA_H = 28;
  const deltaData = React.useMemo(() => {
    if (traces.length !== 2 || traces[0].length === 0 || traces[1].length === 0) return null;
    const a = traces[0], b = traces[1];
    const n = Math.min(a.length, b.length);
    const out = new Array(n);
    let dMin = Infinity, dMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = a[i].value - b[i].value;
      out[i] = { fraction: a[i].fraction, value: v };
      if (v < dMin) dMin = v;
      if (v > dMax) dMax = v;
    }
    const absMax = Math.max(1, Math.abs(dMin), Math.abs(dMax));
    return { pts: out, range: absMax };
  }, [traces]);
  const deltaPath = React.useMemo(() => {
    if (!deltaData) return "";
    const { pts, range } = deltaData;
    let d = "";
    for (let i = 0; i < pts.length; i++) {
      const x = PAD_L + pts[i].fraction * iw;
      // Center line is zero; positive (pinned faster) goes up.
      const y = (DELTA_H / 2) - (pts[i].value / range) * (DELTA_H / 2 - 2);
      d += (i === 0 ? "M" : "L") + ` ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return d;
  }, [deltaData, iw]);

  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
      overflow: "hidden",
    }}>
      <PanelHeader title={<>{`TRACE · ${channel.toUpperCase()}`}{codes.map((c, i) => {
            const drv = DRIVERS.find((x) => x.code === c);
            const team = drv ? TEAMS[drv.team] : null;
            const teamColor = team?.color || colors[i];
            return <React.Fragment key={c}>{` · `}<span style={{ color: teamColor }}>{drv?.code || c}</span></React.Fragment>;
          })}</>} meta={`LAP ${lap}`} />
      <div style={{ position: "relative" }}>
        {fetching && !hasData && (
          <div style={{
            position: "absolute", top: 8, right: 10,
            fontFamily: T.mono,
            fontSize: T.fs.xs, fontWeight: 700,
            letterSpacing: T.ls.caps,
            color: T.textFaint,
            padding: "1px 4px",
            border: "1px solid rgba(255,255,255,0.08)",
            zIndex: 2,
          }}>WAIT</div>
        )}
        {!fetching && !hasData && codes.length > 0 && (
          <div style={{
            position: "absolute", top: 8, right: 10,
            fontFamily: T.mono,
            fontSize: T.fs.xs,
            letterSpacing: T.ls.caps,
            color: T.textFaint,
            zIndex: 2,
          }}>NO TELEMETRY FOR LAP {lap}</div>
        )}
        <div style={{
          position: "absolute", top: 6, left: 120,
          display: "flex", gap: 4,
          zIndex: 2,
        }}>
          {CHANNEL_DEFS.map((def) => (
            <button key={def.key} onClick={() => setChannel && setChannel(def.key)} style={{
              padding: "2px 6px",
              background: channel === def.key ? T.hot : "transparent",
              color: channel === def.key ? "#FFFFFF" : T.textMuted,
              border: `1px solid ${channel === def.key ? T.hot : "rgba(255,255,255,0.08)"}`,
              fontFamily: T.mono,
              fontSize: 8, letterSpacing: T.ls.caps, fontWeight: 700,
              cursor: "pointer",
            }}>{def.label}</button>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          <defs>
            <clipPath id={clipId}>
              {/* Reveals only up to the playhead — traces look live even
                  though the full lap data is already loaded. */}
              <rect x={PAD_L} y={0} width={Math.max(0, revealFrac * iw)} height={H}/>
            </clipPath>
          </defs>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
            <line key={i}
              x1={PAD_L} x2={W - PAD_R}
              y1={PAD_T + g * ih} y2={PAD_T + g * ih}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
          ))}
          {/* Sector dividers (real boundaries from geometry if available) */}
          {sectorFractions.map((s, i) => (
            <line key={i}
              x1={PAD_L + iw * s} x2={PAD_L + iw * s}
              y1={PAD_T} y2={PAD_T + ih}
              stroke="rgba(255,255,255,0.08)" strokeDasharray="2 3"/>
          ))}
          {/* Y-axis labels with units */}
          <text x={PAD_L - 4} y={PAD_T + 4} fontFamily={T.mono} fontSize="8" fill="rgba(180,180,200,0.45)" textAnchor="end">{fmtAxis(max, channelUnit)}</text>
          <text x={PAD_L - 4} y={PAD_T + ih} fontFamily={T.mono} fontSize="8" fill="rgba(180,180,200,0.45)" textAnchor="end">{fmtAxis(min, channelUnit)}</text>
          <text x={PAD_L - 4} y={PAD_T - 2} fontFamily={T.mono} fontSize="7" fill="rgba(180,180,200,0.55)" textAnchor="end" letterSpacing={T.ls.label}>{channelUnit}</text>
          {/* Sector markers in footer */}
          <text x={PAD_L} y={H - 4} fontFamily={T.mono} fontSize="8" fill="rgba(180,180,200,0.45)">S1</text>
          {sectorFractions.map((s, i) => (
            <text key={i} x={PAD_L + iw * s + 4} y={H - 4} fontFamily={T.mono} fontSize="8" fill="rgba(180,180,200,0.45)">S{i + 2}</text>
          ))}

          {/* Traces — clipped to the playhead so it looks live */}
          <g clipPath={`url(#${clipId})`}>
            {traces.map((t, i) => (
              <g key={codes[i]}>
                <path d={pathFor(t)} fill="none" stroke={colors[i]} strokeWidth="1.6" strokeLinejoin="round"/>
              </g>
            ))}
          </g>
          {/* Leading-edge dots at playhead — ride the tip of each trace */}
          {tWithinLap != null && traces.map((t, i) => {
            if (!t || t.length < 2) return null;
            if (tWithinLap < t[0].fraction || tWithinLap > t[t.length - 1].fraction) return null;
            let j = 0;
            while (j < t.length - 1 && t[j + 1].fraction <= tWithinLap) j++;
            const sLo = t[j], sHi = t[Math.min(j + 1, t.length - 1)];
            const spanX = sHi.fraction - sLo.fraction;
            const a = spanX > 0 ? Math.max(0, Math.min(1, (tWithinLap - sLo.fraction) / spanX)) : 0;
            const v = sLo.value + a * (sHi.value - sLo.value);
            const x = PAD_L + tWithinLap * iw;
            const y = PAD_T + ih - ((v - min) / span_y) * ih;
            return <circle key={codes[i]} cx={x} cy={y} r="2.4" fill={colors[i]} stroke="#000" strokeWidth="0.5"/>;
          })}
          {/* Playhead */}
          {tWithinLap != null && (
            <line
              x1={PAD_L + tWithinLap * iw}
              x2={PAD_L + tWithinLap * iw}
              y1={PAD_T}
              y2={PAD_T + ih}
              stroke={T.hot}
              strokeWidth="1.5"
              strokeDasharray="3 2"
              opacity="0.85"
            />
          )}
        </svg>
        {deltaData && (
          <svg viewBox={`0 0 ${W} ${DELTA_H}`} width="100%" height={DELTA_H} preserveAspectRatio="none" style={{ display: "block" }}>
            <defs>
              <clipPath id={deltaClipId}>
                <rect x={PAD_L} y={0} width={Math.max(0, revealFrac * iw)} height={DELTA_H}/>
              </clipPath>
            </defs>
            <line
              x1={PAD_L} x2={W - PAD_R}
              y1={DELTA_H / 2} y2={DELTA_H / 2}
              stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
            <g clipPath={`url(#${deltaClipId})`}>
              <path d={deltaPath} fill="none" stroke={T.text} strokeWidth="1.2" strokeLinejoin="round" opacity="0.85"/>
            </g>
            <text x={PAD_L + 2} y={10} fontFamily={T.mono} fontSize="8" fill={T.textFaint} letterSpacing={T.ls.label}>
              Δ {channel.toUpperCase()} ({pinned}−{secondary || "?"}) · ±{deltaData.range.toFixed(1)}
            </text>
            {tWithinLap != null && (
              <line
                x1={PAD_L + tWithinLap * iw}
                x2={PAD_L + tWithinLap * iw}
                y1={0} y2={DELTA_H}
                stroke={T.hot} strokeWidth="1" strokeDasharray="3 2" opacity="0.6"/>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

// Sector mini-table
function SectorTimes({ pinned, secondary, lap, standings }) {
  const T = window.THEME;
  const primary = standings.find(s => s.driver.code === pinned);
  const secondaryEntry = standings.find(s => s.driver.code === secondary);
  const best = window.DELTA.getSessionBest();

  const fmtSector = (val) => {
    if (val == null || val === 0) return "--:---";
    return val.toFixed(3);
  };

  const rows = [
    primary && { code: primary.driver.code, color: T.hot, s1: primary.lastS1, s2: primary.lastS2, s3: primary.lastS3, pbS1: primary.pbS1, pbS2: primary.pbS2, pbS3: primary.pbS3 },
    secondaryEntry && { code: secondaryEntry.driver.code, color: T.cool, s1: secondaryEntry.lastS1, s2: secondaryEntry.lastS2, s3: secondaryEntry.lastS3, pbS1: secondaryEntry.pbS1, pbS2: secondaryEntry.pbS2, pbS3: secondaryEntry.pbS3 },
    best && (best.s1_s != null || best.s2_s != null || best.s3_s != null) && { code: "BEST", color: T.purple, s1: best.s1_s, s2: best.s2_s, s3: best.s3_s },
  ].filter(Boolean);

  const sectorColor = (val, pb, bestVal) => {
    if (val == null || val === 0) return T.text;
    if (pb != null && val === pb && bestVal != null && val === bestVal) return T.purple;
    if (pb != null && val === pb) return T.good;
    return T.text;
  };

  return (
    <div className="delta-panel-mount" style={{
      background: T.surface,
      border: T.border,
    }}>
      <PanelHeader title="SECTOR SPLITS" />
      <div style={{ padding: "8px 12px", fontFamily: T.mono, fontSize: T.fs.sm }}>
        <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr 1fr 1fr", gap: 6, color: T.textDim, fontSize: T.fs.xs, letterSpacing: T.ls.label, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div>DRV</div><div>S1</div><div>S2</div><div>S3</div><div>TOTAL</div>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "14px 0", color: T.textFaint, textAlign: "center", fontSize: T.fs.xs, letterSpacing: T.ls.label }}>
            NO DRIVER PINNED
          </div>
        )}
        {rows.map((r) => {
          const hasAll = r.s1 != null && r.s2 != null && r.s3 != null;
          const total = hasAll ? r.s1 + r.s2 + r.s3 : null;
          return (
            <div key={r.code} style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr 1fr 1fr", gap: 6, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ color: r.color, fontWeight: 700 }}>{r.code}</div>
              <div style={{ color: sectorColor(r.s1, r.pbS1, best?.s1_s) }}>{fmtSector(r.s1)}</div>
              <div style={{ color: sectorColor(r.s2, r.pbS2, best?.s2_s) }}>{fmtSector(r.s2)}</div>
              <div style={{ color: sectorColor(r.s3, r.pbS3, best?.s3_s) }}>{fmtSector(r.s3)}</div>
              <div style={{ color: T.text, fontWeight: 700 }}>{fmtSector(total)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.DriverCard = DriverCard;
window.CompareTraces = CompareTraces;
window.SectorTimes = SectorTimes;

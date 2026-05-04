// Pre-pit-wall screen. Lets the user pick a season → round → session type
// and POSTs /api/session/load. Once loading begins, control hands off to
// loading_gate.jsx which already owns the loading overlay + transition.

const TH = window.THEME;
const CLIENT = window.DELTA_CLIENT;

const SESSION_TYPES = [
  { id: "R",  label: "RACE",         long: "LOAD RACE" },
  { id: "Q",  label: "QUALI",        long: "LOAD QUALI" },
  { id: "S",  label: "SPRINT",       long: "LOAD SPRINT" },
  { id: "SQ", label: "SPRINT QUALI", long: "LOAD SPRINT QUALI" },
];
const SESSION_LABEL = Object.fromEntries(SESSION_TYPES.map((s) => [s.id, s.long]));

// ---------------------------------------------------------------------------
// Country → ISO-2 → emoji flag. Uses Unicode regional indicator characters
// so we don't ship any flag image assets.
// ---------------------------------------------------------------------------

const COUNTRY_TO_ISO2 = {
  "australia": "AU", "austria": "AT", "azerbaijan": "AZ",
  "bahrain": "BH", "belgium": "BE", "brazil": "BR",
  "canada": "CA", "china": "CN",
  "france": "FR",
  "germany": "DE", "great britain": "GB", "united kingdom": "GB", "uk": "GB",
  "hungary": "HU",
  "india": "IN", "italy": "IT",
  "japan": "JP",
  "korea": "KR", "south korea": "KR",
  "malaysia": "MY", "mexico": "MX", "monaco": "MC",
  "netherlands": "NL",
  "portugal": "PT",
  "qatar": "QA",
  "russia": "RU",
  "saudi arabia": "SA", "singapore": "SG", "spain": "ES",
  "turkey": "TR",
  "united states": "US", "usa": "US", "united states of america": "US",
  "vietnam": "VN",
  "abu dhabi": "AE", "uae": "AE", "united arab emirates": "AE",
};

function flagEmoji(country) {
  if (!country) return "";
  const iso = COUNTRY_TO_ISO2[String(country).trim().toLowerCase()];
  if (!iso || iso.length !== 2) return "";
  return String.fromCodePoint(...iso.split("").map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseEventDate(s) {
  if (!s) return null;
  const d = new Date(typeof s === "string" && s.length === 10 ? s + "T00:00:00" : s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function classifyRound(round, today) {
  const sd = round.session_dates || {};
  const candidates = ["Race", "Sprint", "Qualifying", "Sprint Qualifying"]
    .map((k) => sd[k]).filter(Boolean);
  const headlineISO = candidates[0] || round.date;
  const eventDate = parseEventDate(headlineISO) || parseEventDate(round.date);
  if (!eventDate) return { state: "unknown", days: null };
  const days = daysBetween(today, eventDate);
  if (days < -1) return { state: "past", days };
  if (days <= 0) return { state: "live", days };
  return { state: "future", days };
}

function rowAffordance(cls) {
  if (cls.state === "future") return {
    interactive: false,
    hint: `SCHEDULED · IN ${cls.days}D`,
    reasonText: cls.days != null
      ? `Race not yet available — scheduled in ${cls.days} day${cls.days === 1 ? "" : "s"}.`
      : "Race not yet available.",
  };
  if (cls.state === "live") return { interactive: true, hint: "↵ LOAD · LIVE" };
  return { interactive: true, hint: "↵ LOAD" };
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function RacePickerHeader({ onOpenSearch }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "20px 28px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "linear-gradient(180deg, rgba(20,20,30,0.6), rgba(11,11,17,0.2))",
    }}>
      <div style={{
        width: 10, height: 28, background: TH.hot,
        boxShadow: `0 0 12px ${TH.hot}`,
      }}/>
      <div style={{
        fontFamily: TH.mono, fontSize: TH.fs.lg, fontWeight: 800,
        color: TH.textStrong, letterSpacing: TH.ls.wide,
      }}>
        DELTA · PITWALL
      </div>
      <div style={{ flex: 1 }}/>
      <button onClick={onOpenSearch} style={{
        padding: "6px 10px",
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.12)",
        color: TH.textMuted,
        fontFamily: TH.mono, fontSize: TH.fs.xs, fontWeight: 700,
        letterSpacing: TH.ls.caps, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 8,
      }} title="Search races (⌘K or /)">
        <span>⌕  SEARCH ALL YEARS</span>
        <span style={{
          padding: "1px 5px",
          border: "1px solid rgba(255,255,255,0.15)",
          color: TH.textFaint, fontSize: TH.fs.xs,
        }}>⌘K</span>
      </button>
    </div>
  );
}

function YearSelector({ years, selected, onChange, roundCounts }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {years.map((y) => {
        const active = y === selected;
        const count = roundCounts[y];
        return (
          <button key={y} onClick={() => onChange(y)} style={{
            padding: "6px 12px 4px",
            background: active ? TH.hot : "transparent",
            color: active ? "#0B0B11" : TH.text,
            border: active ? `1px solid ${TH.hot}` : "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer",
            fontFamily: TH.mono, fontSize: TH.fs.sm,
            fontWeight: 700, letterSpacing: TH.ls.caps,
            transition: "all 120ms ease",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            minWidth: 56,
          }}>
            <div>{y}</div>
            <div style={{
              fontSize: 8, fontWeight: 600,
              color: active ? "rgba(11,11,17,0.7)" : TH.textFaint,
              letterSpacing: TH.ls.caps,
            }}>
              {count != null ? `${count} RDS` : "—"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SessionTypeToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {SESSION_TYPES.map((st) => {
        const active = st.id === value;
        return (
          <button key={st.id} onClick={() => onChange(st.id)} style={{
            padding: "6px 12px 4px",
            background: active ? TH.hot : "transparent",
            color: active ? "#0B0B11" : TH.text,
            border: active ? `1px solid ${TH.hot}` : "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer",
            fontFamily: TH.mono, fontSize: TH.fs.sm,
            fontWeight: 700, letterSpacing: TH.ls.caps,
            transition: "all 120ms ease",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            justifyContent: "center",
            minHeight: 38,
            minWidth: 56,
          }}>
            <div>{st.label}</div>
            <div style={{
              fontSize: 8,
              fontWeight: 600,
              color: active ? "rgba(11,11,17,0.7)" : "transparent",
              letterSpacing: TH.ls.caps,
              userSelect: "none",
            }}>
              SESSION
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Session-availability pips: small dots showing which sessions have a warm
// cache for this round. Replaces the per-card session toggle.
function SessionPips({ year, round, cacheSet, sessionType, sessionDates }) {
  const isSprintWeekend = !!(sessionDates?.["Sprint"] || sessionDates?.["Sprint Qualifying"]);
  const pips = SESSION_TYPES
    .filter((st) => (st.id !== "S" && st.id !== "SQ") || isSprintWeekend)
    .map((st) => {
      const cached = cacheSet.has(`${year}_${round}_${st.id}`);
      const active = st.id === sessionType;
      return { id: st.id, label: st.id, cached, active };
    });
  const activeCached = pips.find((p) => p.active)?.cached ?? false;
  return (
    <div title="Cached sessions for this round" style={{
      display: "inline-flex", alignItems: "center", gap: 8,
    }}>
      <div style={{
        fontFamily: TH.mono,
        fontSize: 8,
        fontWeight: 800,
        letterSpacing: TH.ls.caps,
        color: activeCached ? TH.good : TH.textFaint,
      }}>
        {activeCached ? "CACHED" : "UNCACHED"}
      </div>
      {pips.map((p) => (
        <div key={p.id} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "1px 5px",
          border: p.active
            ? `1px solid ${p.cached ? TH.good : "rgba(255,255,255,0.18)"}`
            : "1px solid rgba(255,255,255,0.06)",
          background: p.active ? "rgba(255,30,0,0.06)" : "transparent",
          fontFamily: TH.mono, fontSize: 9,
          fontWeight: 700, letterSpacing: TH.ls.caps,
          color: p.cached ? TH.good : TH.textFaint,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: p.cached ? TH.good : "rgba(180,180,200,0.25)",
            boxShadow: p.cached ? `0 0 4px ${TH.good}` : "none",
          }}/>
          {p.label}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ classification, isNext }) {
  if (isNext) {
    return (
      <div style={{
        padding: "2px 6px",
        background: TH.hot,
        color: "#0B0B11",
        fontFamily: TH.mono, fontSize: TH.fs.xs,
        fontWeight: 800, letterSpacing: TH.ls.caps,
      }}>
        NEXT RACE
      </div>
    );
  }
  if (classification.state === "live") {
    return (
      <div style={{
        padding: "2px 6px",
        background: "rgba(30,255,106,0.15)",
        color: TH.good, border: `1px solid ${TH.good}`,
        fontFamily: TH.mono, fontSize: TH.fs.xs,
        fontWeight: 800, letterSpacing: TH.ls.caps,
      }}>
        LIVE
      </div>
    );
  }
  if (classification.state === "past") {
    return (
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 6px",
        background: "rgba(30,255,106,0.08)",
        color: TH.good,
        fontFamily: TH.mono, fontSize: TH.fs.xs,
        fontWeight: 700, letterSpacing: TH.ls.caps,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: TH.good, boxShadow: `0 0 5px ${TH.good}`,
        }}/>
        DATA AVAILABLE
      </div>
    );
  }
  if (classification.state === "future") {
    const days = classification.days;
    return (
      <div style={{
        padding: "2px 6px",
        border: "1px dashed rgba(255,184,0,0.4)",
        color: TH.caution,
        fontFamily: TH.mono, fontSize: TH.fs.xs,
        fontWeight: 700, letterSpacing: TH.ls.caps,
      }}>
        SCHEDULED · {days != null ? `IN ${days}D` : "TBC"}
      </div>
    );
  }
  return null;
}

function RoundCard({
  round, year, sessionType, cacheSet, onPick,
  isSelected, isLoading, isDisabled, isFuture, isNext, classification,
}) {
  const [hover, setHover] = React.useState(false);
  const interactive = !isDisabled && !isFuture;
  const clickable = !isDisabled;

  const accentColor = isNext
    ? TH.hot
    : (isSelected ? TH.hot : (hover && interactive ? "rgba(255,30,0,0.7)" : "transparent"));
  const flag = flagEmoji(round.country);
  const locationLabel = (round.circuit_name || round.location || "").toUpperCase();

  const bgHover = hover && interactive
    ? "linear-gradient(180deg, rgba(36,28,40,0.92) 0%, rgba(20,16,24,0.95) 100%)"
    : TH.surface2;

  // Is the currently-selected session type cached for this round?
  const currentCached = cacheSet.has(`${year}_${round.round_number}_${sessionType}`);

  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => clickable && onPick(round)}
      role="button"
      tabIndex={interactive ? 0 : -1}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(round); }
      }}
      style={{
        position: "relative",
        textAlign: "left",
        padding: "14px 16px 12px 14px",
        background: bgHover,
        border: "1px solid rgba(255,255,255,0.08)",
        borderLeft: `4px solid ${accentColor}`,
        cursor: interactive ? "pointer" : "not-allowed",
        opacity: isFuture ? 0.55 : (isDisabled && !isLoading ? 0.5 : 1),
        fontFamily: TH.mono,
        color: TH.text,
        animation: "delta-panel-in 120ms ease both",
        transition: "border-color 120ms ease, background 120ms ease, transform 120ms ease, box-shadow 120ms ease",
        transform: hover && interactive ? "translateY(-1px)" : "none",
        boxShadow: hover && interactive
          ? "0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,30,0,0.15)"
          : "none",
        display: "flex", flexDirection: "column", gap: 6,
        minHeight: 132,
        outline: "none",
      }}
    >
      {(isSelected || isLoading) && (
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(11,11,17,0.55)",
          pointerEvents: "none",
        }}/>
      )}

      {/* Top row: round + status */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 8,
      }}>
        <div style={{
          fontSize: TH.fs.xs, color: TH.textMuted,
          letterSpacing: TH.ls.caps,
        }}>
          ROUND {String(round.round_number).padStart(2, "0")}
        </div>
        <StatusBadge classification={classification} isNext={isNext}/>
      </div>

      {/* Title */}
      <div style={{
        fontSize: TH.fs.lg, fontWeight: 800, color: TH.textStrong,
        letterSpacing: TH.ls.tight, lineHeight: 1.15,
      }}>
        {(round.event_name || "").toUpperCase()}
      </div>

      {locationLabel && (
        <div style={{
          fontSize: TH.fs.xs,
          color: TH.hot,
          letterSpacing: TH.ls.caps,
          fontWeight: 700,
        }}>
          {locationLabel}
        </div>
      )}

      {/* Country (with flag) + date */}
      <div style={{
        fontSize: TH.fs.sm, color: TH.textMuted,
        letterSpacing: TH.ls.body,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {flag && <span style={{ fontSize: 14, lineHeight: 1 }}>{flag}</span>}
        <span>
          {(round.country || "").toUpperCase()}
          {round.date ? ` · ${round.date}` : ""}
        </span>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Bottom row: session-availability pips + load CTA */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, position: "relative", zIndex: 2,
      }}>
        <SessionPips
          year={year}
          round={round.round_number}
          cacheSet={cacheSet}
          sessionType={sessionType}
          sessionDates={round.session_dates}
        />
        <div style={{
          fontSize: TH.fs.xs, fontWeight: 700,
          color: isLoading ? TH.hot
            : isFuture ? TH.caution
            : (hover ? TH.hot : (currentCached ? TH.good : TH.textFaint)),
          letterSpacing: TH.ls.caps,
          display: "flex", alignItems: "center", gap: 6,
          transition: "color 120ms ease",
        }}>
          {isLoading ? (
            <>
              <span style={{
                display: "inline-block", width: 9, height: 9,
                border: `2px solid ${TH.hot}`, borderRightColor: "transparent",
                borderRadius: "50%",
                animation: "delta-spin 0.7s linear infinite",
              }}/>
              STARTING…
            </>
          ) : isFuture
            ? null
            : `${SESSION_LABEL[sessionType] || "LOAD"} →`}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ children, tone = "muted" }) {
  const color = tone === "error" ? TH.hot : TH.textMuted;
  return (
    <div style={{
      fontFamily: TH.mono, fontSize: TH.fs.sm,
      color, letterSpacing: TH.ls.body, padding: "20px 0",
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command palette — searches across ALL years.
// ---------------------------------------------------------------------------

function CommandPalette({ allRoundsByYear, years, loadingYears, now, message, onClose, onPick }) {
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Flatten { year: [rounds] } → [{ year, ...round }]
  const flat = React.useMemo(() => {
    const out = [];
    for (const y of years) {
      const rs = allRoundsByYear[y] || [];
      for (const r of rs) out.push({ year: y, round: r });
    }
    return out;
  }, [allRoundsByYear, years]);

  const matches = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const haystack = flat;
    if (!needle) {
      // Default: show recent years first, up to 20 entries.
      return haystack.slice(0, 20);
    }
    return haystack.filter(({ year, round }) => {
      const hay = `${round.event_name || ""} ${round.country || ""} ${round.location || ""} ${round.circuit_name || ""} round ${round.round_number} ${year}`.toLowerCase();
      return hay.includes(needle);
    }).slice(0, 30);
  }, [q, flat]);

  const rows = React.useMemo(() => (
    matches.map((m) => {
      const cls = classifyRound(m.round, now);
      return { ...m, cls, aff: rowAffordance(cls) };
    })
  ), [matches, now]);

  React.useEffect(() => {
    setIdx((current) => {
      if (rows.length === 0) return 0;
      const clamped = Math.max(0, Math.min(rows.length - 1, current));
      if (rows[clamped]?.aff.interactive) return clamped;
      const firstInteractive = rows.findIndex((row) => row.aff.interactive);
      return firstInteractive >= 0 ? firstInteractive : 0;
    });
  }, [rows]);

  const findNextInteractiveIndex = React.useCallback((start, delta) => {
    for (let i = start + delta; i >= 0 && i < rows.length; i += delta) {
      if (rows[i]?.aff.interactive) return i;
    }
    return start;
  }, [rows]);

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => findNextInteractiveIndex(i, 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx((i) => findNextInteractiveIndex(i, -1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const m = rows[idx];
      if (m) onPick(m);
    }
  };

  const stillLoading = loadingYears.size > 0;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 2000, display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "10vh",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(620px, 92vw)",
        background: TH.surface3,
        border: "1px solid rgba(255,30,0,0.4)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        fontFamily: TH.mono, color: TH.text,
      }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Search every year — try "italy 2023", "monaco", "round 5"`}
          style={{
            width: "100%", padding: "14px 16px",
            background: "transparent", border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            color: TH.textStrong, fontFamily: TH.mono,
            fontSize: TH.fs.md, outline: "none",
            letterSpacing: TH.ls.body,
          }}
        />
        {stillLoading && (
          <div style={{
            padding: "6px 16px",
            fontSize: TH.fs.xs, color: TH.textFaint,
            letterSpacing: TH.ls.caps,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            INDEXING {loadingYears.size} MORE YEAR{loadingYears.size === 1 ? "" : "S"}…
          </div>
        )}
        <div style={{ maxHeight: "55vh", overflow: "auto" }}>
          {rows.length === 0 && !stillLoading && (
            <div style={{ padding: 16, color: TH.textFaint, fontSize: TH.fs.sm }}>
              NO MATCHES.
            </div>
          )}
          {rows.map((m, i) => {
            const { year, round, aff } = m;
            const active = i === idx;
            const flag = flagEmoji(round.country);
            return (
              <div key={`${year}-${round.round_number}`}
                onClick={aff.interactive ? () => onPick(m) : undefined}
                onMouseEnter={aff.interactive ? () => setIdx(i) : undefined}
                style={{
                padding: "10px 16px",
                background: active ? "rgba(255,30,0,0.12)" : "transparent",
                borderLeft: active ? `3px solid ${TH.hot}` : "3px solid transparent",
                cursor: aff.interactive ? "pointer" : "not-allowed",
                opacity: aff.interactive ? 1 : 0.45,
                display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
              }}>
                <div>
                  <div style={{
                    fontSize: TH.fs.sm, color: TH.textStrong, fontWeight: 700,
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {flag && <span style={{ fontSize: 14 }}>{flag}</span>}
                    {(round.event_name || "").toUpperCase()}
                  </div>
                  <div style={{ fontSize: TH.fs.xs, color: TH.textMuted, letterSpacing: TH.ls.body }}>
                    {year} · R{String(round.round_number).padStart(2, "0")}
                    {round.location ? ` · ${(round.location || "").toUpperCase()}` : ""}
                    {round.country ? ` · ${(round.country || "").toUpperCase()}` : ""}
                    {round.date ? ` · ${round.date}` : ""}
                  </div>
                </div>
                {active && (
                  <div style={{
                    fontSize: TH.fs.xs,
                    color: aff.interactive ? TH.hot : TH.caution,
                    fontWeight: 700,
                    letterSpacing: TH.ls.caps,
                  }}>
                    {aff.hint}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{
          padding: "8px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: TH.fs.xs, color: TH.textFaint,
          letterSpacing: TH.ls.caps,
          display: "flex", gap: 14,
        }}>
          {message ? (
            <span style={{ color: TH.caution, letterSpacing: TH.ls.body }}>
              {message}
            </span>
          ) : (
            <>
              <span>↑↓ NAVIGATE</span>
              <span>↵ LOAD</span>
              <span>ESC CLOSE</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function RacePicker({ onLoadStarted }) {
  const [seasonsState, setSeasonsState] = React.useState({
    loading: true,
    error: null,
    years: [],
    roundCounts: {},
  });
  const [year, setYear] = React.useState(null);
  const [sessionType, setSessionType] = React.useState("R");
  const [allRoundsByYear, setAllRoundsByYear] = React.useState({}); // year -> rounds[]
  const [yearError, setYearError] = React.useState({});             // year -> err string
  const [loadingYears, setLoadingYears] = React.useState(() => new Set());
  const [cacheSet, setCacheSet] = React.useState(() => new Set());
  const [selecting, setSelecting] = React.useState(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [paletteMessage, setPaletteMessage] = React.useState(null);
  const allRoundsByYearRef = React.useRef({});
  const inflightYearLoadsRef = React.useRef(new Map());

  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    allRoundsByYearRef.current = allRoundsByYear;
  }, [allRoundsByYear]);

  // Seasons
  React.useEffect(() => {
    let alive = true;
    CLIENT.get("/api/seasons").then((res) => {
      if (!alive) return;
      const ys = (res?.seasons || []).slice().sort((a, b) => b - a);
      const metaCounts = {};
      const rawCounts = res?.round_counts || {};
      for (const [key, value] of Object.entries(rawCounts)) {
        const y = Number(key);
        if (!Number.isFinite(y) || value == null) continue;
        metaCounts[y] = value;
      }
      setSeasonsState({ loading: false, error: null, years: ys, roundCounts: metaCounts });
      if (ys.length) setYear(ys[0]);
    }).catch((e) => {
      if (!alive) return;
      setSeasonsState({ loading: false, error: String(e?.message || e), years: [], roundCounts: {} });
    });
    return () => { alive = false; };
  }, []);

  // Cache index — single fetch
  React.useEffect(() => {
    let alive = true;
    CLIENT.get("/api/web_cache/index").then((res) => {
      if (!alive) return;
      const set = new Set();
      for (const e of (res?.entries || [])) {
        set.add(`${e.year}_${e.round}_${e.session_type}`);
      }
      setCacheSet(set);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Lazy-load rounds for any year on demand. Used by both the visible grid
  // (single year) and the command palette (all years).
  const ensureYearLoaded = React.useCallback((y) => {
    if (y == null) return Promise.resolve(null);
    const cached = allRoundsByYearRef.current[y];
    if (cached != null) return Promise.resolve(cached);
    const inflight = inflightYearLoadsRef.current.get(y);
    if (inflight) return inflight;
    setLoadingYears((prev) => {
      if (prev.has(y)) return prev;
      const next = new Set(prev); next.add(y); return next;
    });
    const request = CLIENT.get(`/api/seasons/${y}/rounds`).then((res) => {
      const list = res && res.error
        ? []
        : (Array.isArray(res) ? res : (res?.rounds || []));
      setAllRoundsByYear((prev) => {
        const next = { ...prev, [y]: list };
        allRoundsByYearRef.current = next;
        return next;
      });
      if (res && res.error) {
        setYearError((prev) => ({ ...prev, [y]: String(res.error) }));
      }
      return list;
    }).catch((e) => {
      setAllRoundsByYear((prev) => {
        const next = { ...prev, [y]: [] };
        allRoundsByYearRef.current = next;
        return next;
      });
      setYearError((prev) => ({ ...prev, [y]: String(e?.message || e) }));
      return [];
    }).finally(() => {
      inflightYearLoadsRef.current.delete(y);
      setLoadingYears((prev) => {
        const next = new Set(prev); next.delete(y); return next;
      });
    });
    inflightYearLoadsRef.current.set(y, request);
    return request;
  }, []);

  // Selected-year rounds
  React.useEffect(() => {
    if (year != null) ensureYearLoaded(year);
  }, [year, ensureYearLoaded]);

  // Palette open → fetch every year in the background.
  React.useEffect(() => {
    if (!paletteOpen) return;
    for (const y of seasonsState.years) ensureYearLoaded(y);
  }, [paletteOpen, seasonsState.years, ensureYearLoaded]);

  React.useEffect(() => {
    if (!paletteOpen) setPaletteMessage(null);
  }, [paletteOpen]);

  React.useEffect(() => {
    if (!paletteMessage) return;
    const id = setTimeout(() => setPaletteMessage(null), 3500);
    return () => clearTimeout(id);
  }, [paletteMessage]);

  const roundCounts = React.useMemo(() => {
    const out = { ...(seasonsState.roundCounts || {}) };
    for (const y of Object.keys(allRoundsByYear)) {
      const arr = allRoundsByYear[y];
      if (Array.isArray(arr)) out[y] = arr.length;
    }
    return out;
  }, [allRoundsByYear, seasonsState.roundCounts]);

  const currentRounds = year != null ? (allRoundsByYear[year] || null) : null;
  const currentLoading = year != null && currentRounds == null && loadingYears.has(year);
  const currentError = year != null ? yearError[year] : null;

  const { classifiedRounds, nextRoundNumber } = React.useMemo(() => {
    if (!currentRounds) return { classifiedRounds: [], nextRoundNumber: null };
    const list = currentRounds.map((r) => ({
      round: r,
      classification: classifyRound(r, now),
    }));
    let nextRoundNum = null;
    let nextDays = Infinity;
    for (const item of list) {
      if (item.classification.state === "future" && item.classification.days != null && item.classification.days < nextDays) {
        nextDays = item.classification.days;
        nextRoundNum = item.round.round_number;
      }
    }
    if (nextRoundNum == null) {
      const live = list.find((it) => it.classification.state === "live");
      if (live) nextRoundNum = live.round.round_number;
    }
    return { classifiedRounds: list, nextRoundNumber: nextRoundNum };
  }, [currentRounds, now]);

  const handlePickFromGrid = async (round) => {
    if (selecting != null) return;
    const cls = classifyRound(round, now);
    if (cls.state === "future") {
      setYearError((prev) => ({ ...prev, [year]: rowAffordance(cls).reasonText }));
      return;
    }
    setSelecting(round.round_number);
    try {
      await CLIENT.post("/api/session/load", {
        year, round: round.round_number, session_type: sessionType,
      });
      if (onLoadStarted) onLoadStarted({ year, round: round.round_number, session_type: sessionType });
    } catch (e) {
      setSelecting(null);
      setYearError((prev) => ({ ...prev, [year]: `Load failed: ${e?.message || e}` }));
    }
  };

  // From the palette: pick may target any year. Switch active year first
  // for context, then dispatch the load.
  const handlePickFromPalette = async ({ year: pickYear, round }) => {
    const cls = classifyRound(round, now);
    if (cls.state === "future") {
      setPaletteMessage(rowAffordance(cls).reasonText);
      return;
    }
    if (selecting != null) return;
    setPaletteMessage(null);
    setPaletteOpen(false);
    setYear(pickYear);
    setSelecting(round.round_number);
    try {
      await CLIENT.post("/api/session/load", {
        year: pickYear, round: round.round_number, session_type: sessionType,
      });
      if (onLoadStarted) onLoadStarted({ year: pickYear, round: round.round_number, session_type: sessionType });
    } catch (e) {
      setSelecting(null);
      setYearError((prev) => ({ ...prev, [pickYear]: `Load failed: ${e?.message || e}` }));
    }
  };

  // Hotkeys
  React.useEffect(() => {
    const onKey = (e) => {
      if (paletteOpen) return;
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey
        && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName));
      if (isCmdK || isSlash) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "radial-gradient(ellipse at 50% 30%, rgba(40,12,12,0.6) 0%, rgba(11,11,17,1) 55%, #05050A 100%)",
      color: TH.text, fontFamily: TH.mono,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }} className="scanline">
      <RacePickerHeader
        onOpenSearch={() => setPaletteOpen(true)}
      />

      <div style={{
        padding: "22px 28px 14px",
        display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            fontSize: TH.fs.xs, color: TH.textFaint, letterSpacing: TH.ls.wide,
          }}>SEASON</div>
          {seasonsState.loading
            ? <div style={{ color: TH.textMuted, fontSize: TH.fs.sm }}>LOADING SEASONS…</div>
            : seasonsState.error
              ? <div style={{ color: TH.hot, fontSize: TH.fs.sm }}>FAILED · {seasonsState.error}</div>
              : <YearSelector years={seasonsState.years} selected={year} onChange={setYear} roundCounts={roundCounts}/>
          }
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            fontSize: TH.fs.xs, color: TH.textFaint, letterSpacing: TH.ls.wide,
          }}>SESSION</div>
          <SessionTypeToggle value={sessionType} onChange={setSessionType}/>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 32px" }}>
        {currentLoading && <StatusLine>LOADING ROUNDS FOR {year}…</StatusLine>}
        {currentError && <StatusLine tone="error">{currentError}</StatusLine>}
        {!currentLoading && !currentError && currentRounds && classifiedRounds.length === 0 && year != null && (
          <StatusLine>NO ROUNDS AVAILABLE FOR {year}.</StatusLine>
        )}

        {!currentLoading && classifiedRounds.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}>
            {classifiedRounds.map(({ round, classification }) => {
              const isFuture = classification.state === "future";
              return (
                <RoundCard
                  key={round.round_number}
                  round={round}
                  year={year}
                  sessionType={sessionType}
                  cacheSet={cacheSet}
                  onPick={handlePickFromGrid}
                  isSelected={selecting === round.round_number}
                  isLoading={selecting === round.round_number}
                  isDisabled={selecting != null && selecting !== round.round_number}
                  isFuture={isFuture}
                  isNext={nextRoundNumber === round.round_number}
                  classification={classification}
                />
              );
            })}
          </div>
        )}
      </div>

      {paletteOpen && (
        <CommandPalette
          allRoundsByYear={allRoundsByYear}
          years={seasonsState.years}
          loadingYears={loadingYears}
          now={now}
          message={paletteMessage}
          onClose={() => setPaletteOpen(false)}
          onPick={handlePickFromPalette}
        />
      )}

      <style>{`
        @keyframes delta-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

window.RacePicker = RacePicker;

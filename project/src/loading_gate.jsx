// Stage thresholds mirror progress values set in src/web/session_manager.py.
// Keep in sync if backend stages change.
const LOAD_STAGES = [
  { key: "cache",     label: "Checking local cache",     threshold: 5 },
  { key: "download",  label: "Downloading from FastF1",  threshold: 15 },
  { key: "telemetry", label: "Processing telemetry",     threshold: 30 },
  { key: "geometry",  label: "Building track geometry",  threshold: 55 },
  { key: "laps",      label: "Building lap data",        threshold: 65 },
  { key: "hydrate",   label: "Hydrating replay",         threshold: 80 },
];

function LoadingGate({ children }) {
  const { loading } = window.LIVE.useLive();
  const [poll, setPoll] = React.useState(null);
  const [dataReady, setDataReady] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [dot, setDot] = React.useState(0);
  const startRef = React.useRef(Date.now());

  React.useEffect(() => {
    const dataReadyPromise = window.DELTA_DATA_READY || window.APEX_DATA_READY;
    if (dataReadyPromise) {
      dataReadyPromise.then(() => setDataReady(true));
    } else {
      setDataReady(true);
    }
  }, []);

  // Poll /api/session/status as belt-and-braces for the WS loading pings.
  React.useEffect(() => {
    if (loading?.status === "ready") return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const s = await window.DELTA_CLIENT.get("/api/session/status");
        if (alive) setPoll(s);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [loading?.status]);

  // Elapsed seconds timer + pulsing dot — only while loading
  const status = loading?.status || poll?.status || "loading";
  React.useEffect(() => {
    if (status === "ready") return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      setDot(d => (d + 1) % 4);
    }, 500);
    return () => clearInterval(id);
  }, [status]);

  const progress = Math.max(loading?.progress || 0, poll?.progress || 0);
  if (status === "ready" && dataReady) return children;

  const message = loading?.message || poll?.message || "Connecting";
  const dots = ".".repeat(dot);
  const isSlow = elapsed >= 15;

  // The "active" stage is the latest one whose threshold has been reached but
  // whose successor hasn't. Earlier stages render done, later render pending.
  // Warm-cache loads jump from 5% → 80%, which collapses skipped stages into
  // "done" — visually conveys "we didn't need that step".
  let activeIdx = -1;
  for (let i = LOAD_STAGES.length - 1; i >= 0; i--) {
    if (progress >= LOAD_STAGES[i].threshold) { activeIdx = i; break; }
  }

  return (
    <>
      {children}
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
        color: "#fff", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", zIndex: 9999,
        fontFamily: "monospace", gap: 0,
      }}>
        <div style={{ fontSize: 11, letterSpacing: 4, opacity: 0.45, marginBottom: 18, textTransform: "uppercase" }}>
          Delta Pitwall
        </div>

        <div style={{ fontSize: 13, letterSpacing: 2, marginBottom: 14, minWidth: 260, textAlign: "center" }}>
          {message}{dots}
        </div>

        <div style={{ width: 300, height: 3, background: "#222", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${progress}%`, height: "100%",
            background: "linear-gradient(90deg, #cc1000, #FF1E00)",
            transition: "width 0.4s ease",
            borderRadius: 2,
          }} />
        </div>

        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.4, display: "flex", gap: 16 }}>
          <span>{progress}%</span>
          <span>{elapsed}s</span>
        </div>

        <div style={{
          marginTop: 22, width: 300, display: "flex",
          flexDirection: "column", gap: 6,
        }}>
          {LOAD_STAGES.map((stage, i) => {
            const state = i < activeIdx ? "done"
                        : i === activeIdx ? "active"
                        : "pending";
            const color = state === "done"   ? "rgba(255,255,255,0.55)"
                        : state === "active" ? "#FF6A4A"
                        : "rgba(255,255,255,0.25)";
            const marker = state === "done"   ? "✓"
                        : state === "active" ? "▸"
                        : "○";
            return (
              <div key={stage.key} style={{
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 11, letterSpacing: 1, color,
                fontWeight: state === "active" ? 700 : 400,
              }}>
                <span style={{
                  width: 14, textAlign: "center",
                  fontFamily: "monospace",
                }}>{marker}</span>
                <span>{stage.label}{state === "active" ? dots : ""}</span>
              </div>
            );
          })}
        </div>

        {isSlow && activeIdx <= 4 && (
          <div style={{
            marginTop: 18, fontSize: 10, opacity: 0.35, maxWidth: 300,
            textAlign: "center", lineHeight: 1.6,
          }}>
            First run builds a local cache from FastF1 data — this takes a minute or two.
            Subsequent loads are fast.
          </div>
        )}
      </div>
    </>
  );
}
window.LOADING_GATE = LoadingGate;

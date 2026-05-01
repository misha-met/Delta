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

  return (
    <>
      {children}
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
        color: "#fff", display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", zIndex: 9999,
        fontFamily: "monospace", gap: 0,
      }}>
        {/* Title */}
        <div style={{ fontSize: 11, letterSpacing: 4, opacity: 0.45, marginBottom: 18, textTransform: "uppercase" }}>
          Delta Pitwall
        </div>

        {/* Stage label + animated dots */}
        <div style={{ fontSize: 13, letterSpacing: 2, marginBottom: 14, minWidth: 260, textAlign: "center" }}>
          {message}{dots}
        </div>

        {/* Progress bar */}
        <div style={{ width: 300, height: 3, background: "#222", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${progress}%`, height: "100%",
            background: "linear-gradient(90deg, #cc1000, #FF1E00)",
            transition: "width 0.4s ease",
            borderRadius: 2,
          }} />
        </div>

        {/* Progress % + elapsed */}
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.4, display: "flex", gap: 16 }}>
          <span>{progress}%</span>
          <span>{elapsed}s</span>
        </div>

        {/* Slow-load hint — only shown after 15 s (cold cache / first run) */}
        {isSlow && (
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

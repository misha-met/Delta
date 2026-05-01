const LiveCtx = React.createContext(null);
function LiveProvider({ children }) {
  const [snapshot, setSnap] = React.useState(null);
  const [frame, setFrame]   = React.useState(null);
  // Full, time-sorted race control history. The visible `rc` feed is derived
  // from this by filtering against current playback time — so seeking works
  // both directions and messages appear in sync with the timeline.
  const [rcHistory, setRcHistory] = React.useState([]);
  const [playback, setPb]   = React.useState({ speed: 1, is_paused: false });
  const [loading, setLoading] = React.useState({ status: "loading", progress: 0 });
  const [trackStatuses, setTrackStatuses] = React.useState([]);

  React.useEffect(() => {
    let lastFrameT = null;
    let wasPaused = true;
    let lastReactUpdateT = 0;
    const REACT_FRAME_THROTTLE_MS = 50;

    const h = window.DELTA_CLIENT.openSocket((msg) => {
      if (msg.type === "loading") {
        setLoading({ status: msg.status || "loading", progress: msg.progress || 0, message: msg.message });
      } else if (msg.type === "snapshot" || msg.type === "reset") {
        setLoading({ status: "ready", progress: 100 });
        if (window.DELTA?.clearLapTelemetry) window.DELTA.clearLapTelemetry();
        window.__LIVE_BUFFER?.clear?.();
        lastFrameT = null;
        setSnap(msg);
        window.__LIVE_SNAPSHOT = msg;
        setRcHistory([...(msg.race_control_history || [])].sort((a, b) => (a.time || 0) - (b.time || 0)));
        if (msg.track_statuses) setTrackStatuses(msg.track_statuses);
        if (msg.playback) setPb(msg.playback);
        // Install snapshot data into the DELTA shim (colors, driver meta)
        if (window.DELTA?._installSnapshot) window.DELTA._installSnapshot(msg);
        // Also treat snapshot as first frame
        if (msg.standings?.length) {
          const snapT = msg.t_seconds ?? (msg.frame_index || 0);
          const snapClockH = Math.floor(snapT / 3600);
          const snapClockM = Math.floor((snapT % 3600) / 60);
          const snapClockS = Math.floor(snapT % 60);
          const snapClock = `${String(snapClockH).padStart(2,"0")}:${String(snapClockM).padStart(2,"0")}:${String(snapClockS).padStart(2,"0")}`;
          const snapFrame = {
            type: "frame",
            frame_index: msg.frame_index || 0,
            total_frames: msg.total_frames || 1,
            t: 0,
            t_seconds: snapT,
            lap: msg.standings[0]?.lap || 1,
            total_laps: msg.total_laps || 1,
            clock: snapClock,
            track_status: "1",
            flag_state: msg.flag_state || "green",
            playback_speed: msg.playback?.speed || 1,
            is_paused: msg.playback?.is_paused ?? true,
            weather: msg.weather ?? {},
            safety_car: null,
            standings: msg.standings,
            new_rc_events: [],
          };
          window.__LIVE_FRAME = snapFrame;
          window.__LIVE_BUFFER?.push?.(snapFrame);
          if (window.DELTA?._accumulateFrame) window.DELTA._accumulateFrame(snapFrame);
          lastFrameT = snapT;
          wasPaused = true;
          setFrame(snapFrame);
        }
      } else if (msg.type === "frame") {
        const currentT = msg.t_seconds ?? msg.t ?? 0;
        const isPaused = msg.is_paused ?? false;
        const timeDelta = lastFrameT != null ? Math.abs(currentT - lastFrameT) : 0;
        const shouldResetBuffer = isPaused !== wasPaused || timeDelta > 0.5;

        if (shouldResetBuffer) {
          window.__LIVE_BUFFER?.clear?.();
        }

        window.__LIVE_FRAME = msg;
        window.__LIVE_BUFFER?.push?.(msg);
        if (window.DELTA?._accumulateFrame) window.DELTA._accumulateFrame(msg);

        // Throttle React updates to ~20Hz except on pause/seek transitions
        const now = performance.now();
        if (shouldResetBuffer || now - lastReactUpdateT >= REACT_FRAME_THROTTLE_MS) {
          setFrame(msg);
          lastReactUpdateT = now;
        }

        setPb((p) => ({ ...p, speed: msg.playback_speed, is_paused: msg.is_paused }));
        lastFrameT = currentT;
        wasPaused = isPaused;
      }
    });
    return () => h.close();
  }, []);

  // Derive visible RC feed: everything up to the current playback time,
  // newest first. Seeking backward hides future messages; seeking forward
  // reveals them in order — matches the timeline.
  // Memoize on the index of the *last visible message*, so the feed only
  // rebuilds when a new message crosses the playhead (not every frame).
  const tSec = frame?.t_seconds ?? frame?.t ?? 0;
  const visibleCount = React.useMemo(() => {
    if (!rcHistory.length) return 0;
    let lo = 0, hi = rcHistory.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((rcHistory[mid].time || 0) <= tSec) lo = mid + 1; else hi = mid;
    }
    return lo;
  }, [rcHistory, tSec]);
  const rc = React.useMemo(
    () => rcHistory.slice(0, visibleCount).reverse(),
    [rcHistory, visibleCount]
  );

  return <LiveCtx.Provider value={{ snapshot, frame, rc, playback, setPb, loading, trackStatuses }}>{children}</LiveCtx.Provider>;
}
const useLive = () => React.useContext(LiveCtx);
window.LIVE = { LiveProvider, useLive };

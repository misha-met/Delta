// Thin HTTP + WS client. Exposes window.DELTA_CLIENT.
const BASE = `${location.protocol}//${location.host}`;
const WS_BASE = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;

async function get(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function openSocket(onMessage) {
  let ws;
  let retry = 0;
  const decoder = new TextDecoder();
  const parsePayload = async (raw) => {
    if (typeof raw === "string") return JSON.parse(raw);
    if (raw instanceof ArrayBuffer) return JSON.parse(decoder.decode(raw));
    if (ArrayBuffer.isView(raw)) return JSON.parse(decoder.decode(raw));
    if (raw && typeof raw.text === "function") return JSON.parse(await raw.text());
    return null;
  };
  const connect = () => {
    ws = new WebSocket(WS_BASE + "/ws/telemetry");
    ws.binaryType = "arraybuffer";
    ws.onmessage = async (ev) => {
      try {
        const parsed = await parsePayload(ev.data);
        if (parsed) onMessage(parsed);
      } catch {}
    };
    ws.onclose = () => {
      const delay = Math.min(1000 * (2 ** retry), 10000);
      retry = Math.min(retry + 1, 4);
      setTimeout(connect, delay);
    };
    ws.onopen = () => { retry = 0; };
  };
  connect();
  return { close: () => ws && ws.close() };
}

window.DELTA_CLIENT = { get, post, openSocket };
window.APEX_CLIENT = window.DELTA_CLIENT;

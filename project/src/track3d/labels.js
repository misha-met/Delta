function makeLabelLayer(mount) {
  const layer = document.createElement("div");
  Object.assign(layer.style, {
    position: "absolute", inset: "0", pointerEvents: "none",
    fontFamily: "JetBrains Mono, monospace",
  });
  mount.appendChild(layer);
  return layer;
}

function makeLabel(code, teamColor) {
  const el = document.createElement("div");
  const codeEl = document.createElement("span");
  codeEl.textContent = code;
  const statusEl = document.createElement("span");
  statusEl.style.display = "none";
  statusEl.style.padding = "0 4px";
  statusEl.style.borderRadius = "999px";
  statusEl.style.fontSize = "9px";
  statusEl.style.fontWeight = "800";
  statusEl.style.letterSpacing = "0.1em";
  statusEl.style.textTransform = "uppercase";
  el.appendChild(codeEl);
  el.appendChild(statusEl);
  el._codeEl = codeEl;
  el._statusEl = statusEl;
  Object.assign(el.style, {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em",
    color: "#f4f4f8",
    background: "rgba(11,11,17,0.85)",
    border: `1px solid ${teamColor}`,
    padding: "1px 4px",
    transform: "translate(-50%, -130%)",
    whiteSpace: "nowrap",
  });
  return el;
}

function setLabelStatus(label, status, reason) {
  if (!label?._statusEl) return;
  const badge = String(status || "").trim().toUpperCase();
  label.title = reason || label._codeEl?.textContent || "";
  if (!badge) {
    label._statusEl.style.display = "none";
    label._statusEl.textContent = "";
    return;
  }

  label._statusEl.textContent = badge;
  label._statusEl.style.display = "inline-flex";
  label._statusEl.style.alignItems = "center";
  label._statusEl.style.background = "rgba(11,11,17,0.92)";

  if (badge === "DNS") {
    label._statusEl.style.color = "#d7dbe6";
    label._statusEl.style.border = "1px solid rgba(215,219,230,0.24)";
    return;
  }

  label._statusEl.style.color = badge === "ACC" ? "#ffd6d1" : "#ffd9c2";
  label._statusEl.style.border = badge === "ACC"
    ? "1px solid rgba(255,30,0,0.45)"
    : "1px solid rgba(255,122,26,0.4)";
}

export { makeLabelLayer, makeLabel, setLabelStatus };

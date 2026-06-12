// debugOverlay.js — renderer.info debug panel, toggled by backquote (~).
const SAMPLE_WINDOW = 30;
const DOM_THROTTLE_MS = 250;

export function installDebugOverlay(renderer) {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    top: "8px",
    right: "8px",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.65)",
    color: "#c8e6ff",
    fontFamily: "ui-monospace, monospace",
    fontSize: "11px",
    lineHeight: "1.6",
    whiteSpace: "pre",
    pointerEvents: "none",
    zIndex: "9999",
    borderRadius: "4px",
    display: "none",
  });
  document.body.appendChild(panel);

  let visible = false;
  const frameTimes = [];
  let lastDomWrite = 0;

  document.addEventListener("keydown", (e) => {
    if (e.key === "`" || e.code === "Backquote") {
      const tag = document.activeElement?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      visible = !visible;
      panel.style.display = visible ? "block" : "none";
    }
  });

  function update() {
    const now = performance.now();
    frameTimes.push(now);
    if (frameTimes.length > SAMPLE_WINDOW) frameTimes.shift();

    if (!visible) return;

    if (now - lastDomWrite < DOM_THROTTLE_MS) return;
    lastDomWrite = now;

    let fps = 0;
    if (frameTimes.length >= 2) {
      const span = frameTimes[frameTimes.length - 1] - frameTimes[0];
      fps = ((frameTimes.length - 1) / (span / 1000));
    }

    const ri = renderer.info;
    panel.textContent = [
      `FPS      ${fps.toFixed(1)}`,
      `calls    ${ri.render.calls}`,
      `tris     ${ri.render.triangles}`,
      `geoms    ${ri.memory.geometries}`,
      `textures ${ri.memory.textures}`,
      `programs ${(ri.programs?.length ?? 0)}`,
    ].join("\n");
  }

  return { update };
}
